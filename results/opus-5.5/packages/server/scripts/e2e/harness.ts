// E2E harness: boots the real game server in-process (createGameServer with the real bots, a
// fresh DATA_DIR, an ephemeral port), gives flows a way to open clients, sleep in game time,
// call the REST API and read the SQLite file, and runs each flow with timing and cleanup.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { CONFIG } from '@splash/shared';
import { createBot } from '../../src/bots/bot';
import { DB_FILE_NAME } from '../../src/db/connection';
import { createGameServer, type GameServer } from '../../src/net/gameServer';
import { serverClock } from '../../src/ticker';
import { Autopilot, type PilotKind } from './autopilot';
import { WsClient } from './client';

export interface ServerEnv {
  readonly name: string;
  readonly server: GameServer;
  readonly port: number;
  /** How many times faster than real time the server clock runs (1 = real time). */
  readonly speed: number;
  /** DEV_LAG_MS of this server: artificial latency per direction. */
  readonly lagMs: number;
  /** The server clock (game time, ms). */
  now(): number;
  /** Waits `gameMs` of server (game) time. */
  sleep(gameMs: number): Promise<void>;
  /** GET a JSON endpoint of the server. */
  getJson<T>(path: string): Promise<{ status: number; body: T }>;
  /** Runs a read-only SQL query against the server's SQLite FILE through a separate connection. */
  query<T>(sql: string, ...params: unknown[]): T[];
  close(): Promise<void>;
}

/**
 * Boots one server. `speed` > 1 runs its clock faster than real time (createGameServer's `clock`
 * option): every timer (intros, grace, rematch, tide) scales, the protocol does not change.
 */
export async function bootServer(opts: { name: string; root: string; clientDist: string; speed: number; lagMs?: number }): Promise<ServerEnv> {
  const lagMs = opts.lagMs ?? 0;
  const dataDir = join(opts.root, `data-${opts.name}`);
  mkdirSync(dataDir, { recursive: true });
  const origin = serverClock();
  const clock = opts.speed === 1 ? serverClock : () => origin + (serverClock() - origin) * opts.speed;
  const server = createGameServer({ dataDir, clientDist: opts.clientDist, lagMs, createBot, clock });
  const port = await server.listen(0, '127.0.0.1');
  const reader = new Database(join(dataDir, DB_FILE_NAME), { readonly: true, fileMustExist: true });
  return {
    name: opts.name,
    server,
    port,
    speed: opts.speed,
    lagMs,
    now: clock,
    sleep: (gameMs) => new Promise((resolve) => setTimeout(resolve, gameMs / opts.speed)),
    async getJson<T>(path: string) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      return { status: res.status, body: (await res.json()) as T };
    },
    query: <T>(sql: string, ...params: unknown[]) => reader.prepare(sql).all(...params) as T[],
    async close() {
      reader.close();
      await server.close();
    },
  };
}

export class CheckFailed extends Error {}

/** What a flow body gets: its server, client factory, autopilots, checks and notes. */
export class FlowContext {
  readonly notes: string[] = [];
  private readonly clients: WsClient[] = [];
  private readonly pilots: { label: string; kind: PilotKind; pilot: Autopilot }[] = [];
  private seedCounter = 0;

  constructor(
    readonly name: string,
    readonly env: ServerEnv,
    private readonly flowSeed: number,
  ) {}

  /**
   * Inputs an autopilot keeps ahead of the server: one snapshot period (2 ticks) in real time; a
   * k-times faster clock ticks in bursts of about k ticks per timer wake-up, so one more than that;
   * plus whatever is in flight during one round trip of artificial latency.
   */
  get lead(): number {
    const inFlight = Math.ceil((2 * this.env.lagMs * this.env.speed) / CONFIG.TICK_MS);
    return Math.max(2, Math.ceil(this.env.speed) + 1) + inFlight;
  }

  /** Opens a socket (not yet said hello). */
  async open(label: string): Promise<WsClient> {
    const client = await WsClient.open(`ws://127.0.0.1:${this.env.port}/ws`, `${this.name}/${label}`);
    this.clients.push(client);
    return client;
  }

  /** Opens a socket and says hello (a fresh guest unless a token is given). */
  async connect(label: string, token?: string): Promise<WsClient> {
    const client = await this.open(label);
    await client.hello(token);
    return client;
  }

  /** A fresh guest with a claimed nickname (ranked needs one). */
  async connectNamed(label: string, nickname: string): Promise<WsClient> {
    const client = await this.connect(label);
    client.send({ type: 'set_nickname', nickname });
    const { profile } = await client.take('profile', (m) => m.profile.hasNickname);
    this.check(profile.nickname === nickname, `${label}: nickname claimed as ${profile.nickname}#${profile.tag}`);
    return client;
  }

  pilot(client: WsClient, kind: PilotKind): Autopilot {
    const pilot = new Autopilot(client, kind, this.flowSeed * 101 + ++this.seedCounter, this.lead);
    this.pilots.push({ label: client.label, kind, pilot });
    return pilot;
  }

  /** One line per autopilot that played: inputs sent and how often the server disagreed with its prediction. */
  pilotSummary(): string[] {
    return this.pilots
      .filter(({ pilot }) => pilot.stats.inputsSent > 0)
      .map(({ label, kind, pilot }) => {
        const { inputsSent, rounds, predictionsChecked: checked, predictionsOff: off } = pilot.stats;
        const pct = checked > 0 ? ((100 * off) / checked).toFixed(1) : '0.0';
        return `autopilot ${label} (${kind}): ${inputsSent} inputs over ${rounds} round(s); own position off the prediction ${off}/${checked} (${pct}%)`;
      });
  }

  /** Records a fact for the report. */
  note(text: string): void {
    this.notes.push(text);
  }

  /** Fails the flow unless `ok`; passing checks are kept as evidence. */
  check(ok: boolean, what: string): void {
    if (!ok) throw new CheckFailed(what);
    this.notes.push(`ok: ${what}`);
  }

  equal<T>(actual: T, expected: T, what: string): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new CheckFailed(`${what}: expected ${e}, got ${a}`);
    this.notes.push(`ok: ${what} = ${a}`);
  }

  dispose(): void {
    for (const { pilot } of this.pilots) pilot.stop();
    for (const client of this.clients) client.terminate();
  }
}

export interface FlowSpec {
  name: string;
  /** Wall-clock budget (ms) before the flow is failed as hung. */
  timeoutMs: number;
  run(ctx: FlowContext): Promise<void>;
}

export interface FlowResult {
  name: string;
  server: string;
  ok: boolean;
  wallMs: number;
  gameMs: number;
  notes: string[];
  error: string | null;
}

export async function runFlow(spec: FlowSpec, env: ServerEnv, seed: number): Promise<FlowResult> {
  const ctx = new FlowContext(spec.name, env, seed);
  const wall0 = performance.now();
  const game0 = env.now();
  let error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`flow timed out after ${Math.round(spec.timeoutMs / 1000)} s (wall)`)), spec.timeoutMs);
  });
  try {
    await Promise.race([spec.run(ctx), timeout]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
    for (const line of ctx.pilotSummary()) ctx.note(line);
    ctx.dispose();
  }
  return {
    name: spec.name,
    server: env.name,
    ok: error === null,
    wallMs: performance.now() - wall0,
    gameMs: env.now() - game0,
    notes: ctx.notes,
    error,
  };
}
