import { CONFIG, type Direction, type GameState, type LobbyView, type Mode, type SimEvent, type SimPlayer, type Theme } from "@splash/shared";
import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { HUD_H, STAGE_H, STAGE_W, paletteFor, renderArena, renderBalloons, renderPlayers, renderPowerups, renderSplashes } from "../render/sprites.js";
import { Prediction } from "../prediction.js";
import { el } from "../ui.js";
import { type HudEntry } from "../render/hud.js";
import type { Settings } from "./state.js";

interface MatchConfig { mode: Mode; ranked: boolean; roundsToWin: number; theme: Theme }

export function createGameScreen(): Screen {
  return {
    id: "game",
    mount(ctx: AppCtx, params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const settings = ctx.settings.get();

      const lobby = params["lobby"] as LobbyView | undefined;
      const config = (params["match_start"] as MatchConfig | undefined) ?? null;
      const lobbyTheme = lobby?.opts.theme;
      const theme: Theme = config?.theme ?? (lobbyTheme && lobbyTheme !== "random" ? lobbyTheme : "backyard");
      const roundsToWin = config?.roundsToWin ?? lobby?.opts.roundsToWin ?? 3;
      const mode: Mode = config?.mode ?? (lobby && lobby.opts.size === 2 ? "duel" : "ffa");
      const ranked = config?.ranked ?? false;

      let roundNo = 1;
      let scores: Record<string, number> = {};
      let snapshotState: GameState | null = null;
      const prediction = new Prediction();
      const keys = new Set<string>();
      let tickAcc = 0;
      let balloonHeld = false;
      let lastLocalId: string | null = null;
      const seenBalloons = new Set<number>();
      const seenSplashes = new Set<string>();
      let lastTick = -1;
      let themeEffective: Theme = theme;

      const root = el("div", { class: ["sc-stack"], style: { height: "100%", width: "100%" } });
      const leaveBtn = el("button", { class: ["sc-btn", "ghost", "tiny"], style: { position: "absolute", top: "32px", left: "8px", zIndex: "60" }, text: "CONCEDE" });
      leaveBtn.addEventListener("click", () => {
        ctx.net.send({ type: "leave_room" });
        audio.play("back");
        ctx.go("menu");
      });
      root.append(leaveBtn);

      function resolveLocalId(): string | null {
        const p = ctx.profile();
        if (!p) return null;
        if (lastLocalId !== p.id) {
          lastLocalId = p.id;
          prediction.setLocalId(p.id);
        }
        return p.id;
      }

      function recomputeScores(players: SimPlayer[]): void {
        for (const p of players) scores[p.id] = p.roundsWon;
      }

      function applyEvent(e: SimEvent, state: GameState): void {
        const tile = computeTile(state);
        const offX = computeOffX(state, tile);
        const offY = computeOffY(state, tile);
        switch (e.type) {
          case "balloon_dropped": {
            const cx = offX + e.balloon.x * tile + tile / 2;
            const cy = offY + e.balloon.y * tile + tile / 2;
            ctx.particles.dust(cx, cy, "#ffd83d");
            audio.play("drop");
            seenBalloons.add(e.balloon.id);
            break;
          }
          case "castle_washed": {
            const cx = offX + e.x * tile + tile / 2;
            const cy = offY + e.y * tile + tile / 2;
            ctx.particles.dust(cx, cy, "#f3d68e");
            ctx.particles.sparkle(cx, cy, "#ffd83d");
            audio.play("splash", { gain: 0.4 });
            break;
          }
          case "powerup_revealed":
            ctx.particles.sparkle(offX + e.powerup.x * tile + tile / 2, offY + e.powerup.y * tile + tile / 2, "#7ee4ff");
            audio.play("tab");
            break;
          case "powerup_collected": {
            const player = state.players.find((p) => p.id === e.playerId);
            if (player) {
              const cx = offX + Math.floor(player.x * tile) + tile / 2;
              const cy = offY + Math.floor(player.y * tile) + tile / 2;
              ctx.particles.sparkle(cx, cy, "#66e08f");
              ctx.particles.ring(cx, cy, "#66e08f");
            }
            audio.play("powerup");
            break;
          }
          case "player_soaked": {
            const player = state.players.find((p) => p.id === e.playerId);
            if (player) {
              const cx = offX + Math.floor(player.x * tile) + tile / 2;
              const cy = offY + Math.floor(player.y * tile) + tile / 2;
              ctx.particles.splash(cx, cy, "#7ee4ff");
              ctx.shake(6);
              ctx.flash("#7ee4ff", 0.3);
              if (e.playerId === lastLocalId) {
                audio.play("lose");
                ctx.announce("SOAKED!", "#ff5d5d", "SPECTATING", 1500);
              } else {
                audio.play("soaked");
              }
              const killText = killTextFromEvent(player, e.ownerId, state.players);
              ctx.pushKill(killText, e.ownerId === lastLocalId ? "#66e08f" : "#ff5d5d");
            }
            break;
          }
          case "chain_burst": {
            const cx = offX + e.x * tile + tile / 2;
            const cy = offY + e.y * tile + tile / 2;
            ctx.particles.pop(cx, cy, "#ffd83d");
            ctx.shake(3);
            audio.play("chain");
            break;
          }
          case "balloon_kicked":
            audio.play("kick");
            break;
          case "tide_advance":
            audio.play("tide");
            ctx.flash("#7ee4ff", 0.4);
            ctx.shake(4);
            ctx.announce("TIDE RISES!", "#7ee4ff", `RING ${e.ring}`, 1500);
            break;
          case "revenge_lob": {
            const player = state.players.find((p) => p.id === e.playerId);
            if (player) {
              const cx = offX + Math.floor(player.x * tile) + tile / 2;
              const cy = offY + Math.floor(player.y * tile) + tile / 2;
              ctx.particles.pop(cx, cy, "#ff4fa3");
            }
            audio.play("drop");
            break;
          }
          case "round_end": {
            const winner = e.winnerIds[0] ?? null;
            const youWon = winner === lastLocalId;
            ctx.announce(youWon ? "ROUND WON!" : winner ? "ROUND LOST!" : "DRAW", youWon ? "#66e08f" : "#ff5d5d", undefined, 1800);
            audio.play(youWon ? "win" : "lose");
            ctx.shake(5);
            break;
          }
          default:
            break;
        }
      }

      function handleBurstEvents(state: GameState, prev: GameState): void {
        for (const b of state.balloons) {
          if (!seenBalloons.has(b.id)) seenBalloons.add(b.id);
        }
        const removed = prev.balloons.filter((b) => !state.balloons.some((nb) => nb.id === b.id));
        const tile = computeTile(state);
        const offX = computeOffX(state, tile);
        const offY = computeOffY(state, tile);
        for (const b of removed) {
          const cx = offX + b.x * tile + tile / 2;
          const cy = offY + b.y * tile + tile / 2;
          ctx.particles.pop(cx, cy, "#ff4fa3");
        }
        const newSplashKeys: string[] = [];
        for (const sp of state.splashes) {
          const key = `${sp.x},${sp.y},${sp.expiresAt}`;
          if (!seenSplashes.has(key)) {
            newSplashKeys.push(key);
            const cx = offX + sp.x * tile + tile / 2;
            const cy = offY + sp.y * tile + tile / 2;
            ctx.particles.splash(cx, cy, sp.chain > 1 ? "#ffd83d" : "#7ee4ff");
          }
        }
        for (const k of newSplashKeys) seenSplashes.add(k);
        const seenSet = new Set(state.splashes.map((s) => `${s.x},${s.y},${s.expiresAt}`));
        for (const k of [...seenSplashes]) if (!seenSet.has(k)) seenSplashes.delete(k);
      }

      function computeTile(state: GameState): number {
        const playH = STAGE_H - HUD_H;
        return Math.floor(Math.min(STAGE_W / state.map.width, playH / state.map.height));
      }
      function computeOffX(state: GameState, tile: number): number {
        return Math.floor((STAGE_W - tile * state.map.width) / 2);
      }
      function computeOffY(_state: GameState, tile: number): number {
        return HUD_H + Math.floor((STAGE_H - HUD_H - tile * _state.map.height) / 2);
      }

      const settingsUnsub = ctx.settings.subscribe((s) => {
        for (const k of [...keys]) {
          if (!Object.values(s.keybinds).includes(k)) keys.delete(k);
        }
      });

      function readInput(s: Settings): { dir: Direction; balloon: boolean; revenge: boolean } {
        const up = keys.has(s.keybinds.up) || keys.has("ArrowUp");
        const down = keys.has(s.keybinds.down) || keys.has("ArrowDown");
        const leftL = keys.has(s.keybinds.left) || keys.has("ArrowLeft");
        const right = keys.has(s.keybinds.right) || keys.has("ArrowRight");
        let dir: Direction = "none";
        if (up && !down) dir = "up";
        else if (down && !up) dir = "down";
        else if (leftL && !right) dir = "left";
        else if (right && !leftL) dir = "right";
        const balloon = keys.has(s.keybinds.balloon);
        const revenge = keys.has(s.keybinds.revenge);
        return { dir, balloon, revenge };
      }

      const handle: ScreenHandle = {
        root,
        onTick(dt) {
          tickAcc += dt;
          const localId = resolveLocalId();
          const s = ctx.settings.get();
          while (tickAcc >= 1 / CONFIG.TICK_RATE) {
            tickAcc -= 1 / CONFIG.TICK_RATE;
            const { dir, balloon, revenge } = readInput(s);
            const balloonEdge = balloon && !balloonHeld;
            balloonHeld = balloon;
            if (localId && prediction.hasState()) {
              const fr = prediction.frame(dir, balloonEdge, revenge);
              if (fr) ctx.net.send({ type: "input", seq: fr.msg.seq, tick: fr.msg.tick, dir: fr.msg.dir, balloonPressed: fr.msg.balloonPressed, ...(fr.msg.revengePressed ? { revengePressed: true } : {}) });
            }
          }
          void lastTick;
        },
        onRender(rc) {
          const c = rc.ctx;
          const state = prediction.renderState(performance.now()) ?? snapshotState;
          if (!state) {
            c.fillStyle = "#06122a";
            c.fillRect(0, 0, STAGE_W, STAGE_H);
            c.fillStyle = "#7ee4ff";
            c.font = "bold 10px 'Courier New', monospace";
            c.textAlign = "center";
            c.fillText("WAITING FOR ROUND…", STAGE_W / 2, STAGE_H / 2);
            c.textAlign = "left";
            return;
          }
          const prevClone = snapshotState ?? state;
          handleBurstEvents(state, prevClone);
          const pal = paletteFor(themeEffective);
          const playH = STAGE_H - HUD_H;
          const tile = Math.floor(Math.min(STAGE_W / state.map.width, playH / state.map.height));
          const arenaW = tile * state.map.width;
          const arenaH = tile * state.map.height;
          const offX = Math.floor((STAGE_W - arenaW) / 2);
          const offY = HUD_H + Math.floor((playH - arenaH) / 2);

          const grad = c.createLinearGradient(0, 0, 0, STAGE_H);
          grad.addColorStop(0, pal.skyTop);
          grad.addColorStop(1, pal.skyBot);
          c.fillStyle = grad;
          c.fillRect(0, 0, STAGE_W, STAGE_H);

          renderArena(c, state.map.tiles, state.map.width, state.map.height, tile, offX, offY, pal, state.tideRing, rc.t);
          renderSplashes(c, state.splashes, tile, offX, offY, state.tick, rc.t);
          renderPowerups(c, state.powerups, tile, offX, offY, rc.t);
          renderBalloons(c, state.balloons, tile, offX, offY, rc.t, state.tick);
          renderPlayers(c, state.players, tile, offX, offY, rc.t, lastLocalId, 0, state.tick);

          const entries: HudEntry[] = state.players.map((p) => ({
            player: p,
            score: scores[p.id] ?? 0,
            isLocal: p.id === lastLocalId
          }));
          ctx.hud.draw(c, {
            entries,
            roundNo,
            roundsToWin,
            tick: state.tick,
            tideRing: state.tideRing,
            ranked,
            mode
          });
        },
        onKey(ev, down) {
          const s = ctx.settings.get();
          const norm = ev.key === " " ? "Space" : ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
          const isBind = (Object.values(s.keybinds) as string[]).includes(norm) || ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "W", "A", "S", "D"].includes(norm);
          if (isBind) {
            if (down) keys.add(norm);
            else keys.delete(norm);
            ev.preventDefault();
            return true;
          }
          if (down && norm === "Escape") {
            ctx.net.send({ type: "leave_room" });
            ctx.go("menu");
            return true;
          }
          if (down && (norm === "1" || norm === "2" || norm === "3" || norm === "4")) {
            const id = (Number(norm) as 1 | 2 | 3 | 4);
            ctx.net.send({ type: "emote", id });
            return true;
          }
          return false;
        },
        onMessage(msg) {
          switch (msg.type) {
            case "round_start": {
              roundNo = msg.roundNo;
              themeEffective = msg.theme;
              scores = scores ?? {};
              prediction.reset();
              seenBalloons.clear();
              seenSplashes.clear();
              const secs = 3;
              ctx.announce(`ROUND ${roundNo}`, "#ffd83d", "GET READY", 1800);
              for (let i = 0; i < secs; i++) {
                window.setTimeout(() => audio.play("tick"), i * 1000);
              }
              ctx.particles.clear();
              break;
            }
            case "snapshot": {
              const prev = snapshotState;
              snapshotState = msg.state;
              void prev;
              lastTick = msg.state.tick;
              resolveLocalId();
              prediction.applyAuthoritative(msg.state, msg.ackSeq, msg.serverTime);
              recomputeScores(msg.state.players);
              break;
            }
            case "event": {
              if (snapshotState) applyEvent(msg.event, snapshotState);
              break;
            }
            case "round_end": {
              for (const [pid, s] of Object.entries(msg.scores)) scores[pid] = s;
              break;
            }
            case "match_end": {
              ctx.go("results", { match_end: msg, lobby });
              break;
            }
            case "emote": {
              const p = snapshotState?.players.find((pl) => pl.id === msg.playerId);
              if (p) ctx.pushKill(`${p.name}: EMOTE ${msg.id}`, "#ffd83d");
              break;
            }
            default:
              break;
          }
        },
        unmount() {
          settingsUnsub();
        }
      };

      void settings;
      return handle;
    }
  };
}

function killTextFromEvent(player: SimPlayer, ownerId: string, players: SimPlayer[]): string {
  if (ownerId === "tide") return `${player.name} DRIFTED OUT`;
  const owner = players.find((p) => p.id === ownerId);
  return owner ? `${owner.name} SOAKED ${player.name}` : `${player.name} SOAKED`;
}
