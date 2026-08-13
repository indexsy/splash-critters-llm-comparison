import {
  CONFIG,
  createRound,
  defaultPlayer,
  type Dir,
  type PlayerInput,
  type RoundState,
  type ServerMsg,
  type SnapshotPayload,
  type TileKind,
} from "@splash/shared";
import { audio } from "../audio.js";
import { net } from "../net.js";
import { predictor } from "../prediction.js";
import { burst, drawParticles, tickParticles } from "../render/particles.js";
import { drawAnnouncer, drawHud, drawKillFeed } from "../render/hud.js";
import {
  drawAnimal,
  drawBalloon,
  drawBoulder,
  drawCastle,
  drawDuck,
  drawPowerup,
  PAL,
  themeColors,
} from "../render/sprites.js";
import { app, settings } from "../state.js";
import { centerText } from "../ui.js";
import type { Screen } from "./types.js";

export function gameScreen(go: (name: string, data?: unknown) => void, intro?: Extract<ServerMsg, { type: "match_start" }>): Screen {
  let match = intro ?? null;
  let round: RoundState | null = null;
  let snapBase: RoundState | null = null;
  let scores: Record<string, number> = {};
  let countdown: number | "SPLASH" | null = 3;
  let announcer = "";
  let announcerLife = 0;
  let feed: { text: string; life: number }[] = [];
  let shake = 0;
  let keys = new Set<string>();
  let seqAcc = 0;
  let sendAcc = 0;
  let lastDir: Dir = "none";
  let balloonLatch = false;
  let ping = 40;
  let showdown = false;
  let emotes: { id: string; emote: number; life: number }[] = [];
  let lastSnap: SnapshotPayload | null = null;
  let revenge = match?.config.enableRevengeDucks ?? true;

  const unsub = net.on((msg) => {
    if (msg.type === "match_start") {
      match = msg;
      revenge = msg.config.enableRevengeDucks;
      scores = {};
    }
    if (msg.type === "round_start") {
      const plist = (match?.players ?? []).map((p) =>
        defaultPlayer(p.id, p.slot, p.nickname, { animal: p.animal, hat: p.hat, tag: p.tag }),
      );
      if (!plist.length) {
        plist.push(defaultPlayer(app.playerId, 0, "You"));
      }
      round = createRound(msg.mapSeed, msg.width, msg.height, msg.theme, plist);
      round.arena.tiles = msg.castleGrid.slice() as TileKind[];
      snapBase = round;
      predictor.reset(round, app.playerId);
      countdown = 3;
      audio.startMusic("battle");
      showdown = false;
    }
    if (msg.type === "snapshot" && round) {
      lastSnap = msg.snap;
      applySnap(round, msg.snap);
      if (snapBase) {
        snapBase.arena.tiles = round.arena.tiles.slice();
        predictor.reconcile(msg.snap, snapBase, revenge);
      }
    }
    if (msg.type === "event") {
      const ev = msg.event;
      if (ev.type === "castle_washed" && round) {
        const i = (ev.ty as number) * round.arena.width + (ev.tx as number);
        round.arena.tiles[i] = "empty";
        burst(ev.tx as number, ev.ty as number, PAL.castle, 6);
      }
      if (ev.type === "balloon_placed") audio.drop();
      if (ev.type === "balloon_burst") {
        audio.burst();
        if (!settings.reduceShake) shake = 4;
      }
      if (ev.type === "chain_burst") {
        const n = (ev.count as number) ?? 2;
        audio.chain(n);
        announcer = n >= 3 ? "TRIPLE SPLASH!+" : "DOUBLE SPLASH!";
        announcerLife = 50;
      }
      if (ev.type === "powerup_collected") audio.pickup();
      if (ev.type === "player_soaked") {
        audio.soak();
        const victim = nameOf(ev.playerId as string);
        const by = ev.by ? nameOf(ev.by as string) : "?";
        feed.unshift({ text: `${by} soaked ${victim}!`, life: 90 });
        feed = feed.slice(0, 4);
        if (!settings.reduceShake) shake = 6;
      }
      if (ev.type === "tide_advance") {
        audio.tide();
        announcer = "RISING TIDE!";
        announcerLife = 40;
      }
    }
    if (msg.type === "countdown") countdown = msg.value;
    if (msg.type === "round_end") {
      scores = msg.scores;
      announcer = msg.draw ? "DRAW!" : "ROUND OVER";
      announcerLife = 70;
    }
    if (msg.type === "match_end") go("results", msg);
    if (msg.type === "emote_fx") {
      audio.emote(msg.emoteId);
      emotes.push({ id: msg.playerId, emote: msg.emoteId, life: 40 });
    }
  });

  function nameOf(id: string): string {
    return match?.players.find((p) => p.id === id)?.nickname ?? id.slice(0, 6);
  }

  function applySnap(r: RoundState, s: SnapshotPayload): void {
    r.tick = s.tick;
    r.players = s.players.map((p) => ({ ...p }));
    r.balloons = s.balloons.map((b) => ({ ...b }));
    r.splashes = s.splashes.map((sp) => ({ ...sp }));
    r.exposed = s.exposed.map((e) => ({ ...e }));
    r.tideRing = s.tideRing;
    r.hitstop = s.hitstop;
    const alive = s.players.filter((p) => p.status === "alive").length;
    if (alive === 2 && !showdown) {
      showdown = true;
      audio.startMusic("showdown");
    }
  }

  function currentDir(): Dir {
    const b = settings.binds;
    if (keys.has(b.up ?? "KeyW") || keys.has("ArrowUp")) return "up";
    if (keys.has(b.down ?? "KeyS") || keys.has("ArrowDown")) return "down";
    if (keys.has(b.left ?? "KeyA") || keys.has("ArrowLeft")) return "left";
    if (keys.has(b.right ?? "KeyD") || keys.has("ArrowRight")) return "right";
    return "none";
  }

  let acc = 0;

  return {
    name: "game",
    update(dt) {
      acc += dt;
      sendAcc += dt;
      seqAcc += dt;
      if (shake > 0) shake *= 0.85;
      if (announcerLife > 0) announcerLife--;
      feed.forEach((f) => f.life--);
      feed = feed.filter((f) => f.life > 0);
      emotes.forEach((e) => e.life--);
      emotes = emotes.filter((e) => e.life > 0);
      tickParticles();
      predictor.interpRemotes(dt);
      ping = Math.max(8, Math.min(300, ping * 0.95 + 40 * 0.05));

      const step = 1 / 60;
      while (acc >= step) {
        acc -= step;
        lastDir = currentDir();
        if (keys.has(settings.binds.balloon ?? "Space") || keys.has(settings.binds.balloon2 ?? "KeyE") || keys.has("Space")) {
          balloonLatch = true;
        }
      }
      if (sendAcc >= 1 / CONFIG.INPUT_SEND_RATE) {
        sendAcc = 0;
        const input: PlayerInput = predictor.sample(lastDir, balloonLatch, round?.tick ?? 0);
        balloonLatch = false;
        const send = () => net.send({ type: "input", ...input });
        if (app.latencyFlag > 0) setTimeout(send, app.latencyFlag);
        else send();
        if (predictor.predicted) predictor.applyLocal(input, revenge);
      }
    },
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);

      if (match && (!round || countdown !== null) && countdown !== "SPLASH") {
        ctx.fillStyle = PAL.ui;
        ctx.fillRect(20, 40, 216, 140);
        centerText(ctx, match.config.ranked ? "RANKED" : "CASUAL", 58, PAL.gold, 8);
        match.players.forEach((p, i) => {
          drawAnimal(ctx, 30 + (i % 2) * 110, 70 + Math.floor(i / 2) * 40, p.animal, p.hat, 0);
          ctx.fillStyle = PAL.paper;
          ctx.font = "7px monospace";
          ctx.fillText(`${p.nickname}#${p.tag}`, 50 + (i % 2) * 110, 86 + Math.floor(i / 2) * 40);
          if (p.rating) ctx.fillText(`${p.rating}`, 50 + (i % 2) * 110, 96 + Math.floor(i / 2) * 40);
        });
        if (countdown !== null) centerText(ctx, String(countdown), 200, PAL.gold, 16);
        return;
      }

      const src = predictor.predicted ?? round;
      if (!src) {
        centerText(ctx, "Waiting for round…", 110, PAL.paper, 8);
        return;
      }

      const sx = settings.reduceShake ? 0 : (Math.random() - 0.5) * shake;
      const sy = settings.reduceShake ? 0 : (Math.random() - 0.5) * shake;
      ctx.save();
      ctx.translate(sx, sy);

      const theme = themeColors(src.arena.theme);
      const tile = 14;
      const ox = Math.floor((CONFIG.INTERNAL_W - src.arena.width * tile) / 2);
      const oy = 20;
      const water = settings.colorblind ? PAL.waterCb : PAL.water;
      const water2 = settings.colorblind ? PAL.waterCb2 : PAL.water2;

      for (let y = 0; y < src.arena.height; y++) {
        for (let x = 0; x < src.arena.width; x++) {
          const ring = Math.min(x, y, src.arena.width - 1 - x, src.arena.height - 1 - y);
          const flooded = src.tideRing > 0 && ring <= src.tideRing;
          const px = ox + x * tile;
          const py = oy + y * tile;
          ctx.fillStyle = flooded ? water : (x + y) % 2 ? theme.floor : theme.floor2;
          ctx.fillRect(px, py, tile, tile);
          const kind = src.arena.tiles[y * src.arena.width + x];
          if (kind === "boulder") drawBoulder(ctx, px - 1, py - 1);
          if (kind === "castle") drawCastle(ctx, px - 1, py - 1);
        }
      }
      for (const e of src.exposed) drawPowerup(ctx, ox + e.tx * tile, oy + e.ty * tile, e.kind, src.tick);
      for (const b of src.balloons) {
        drawBalloon(ctx, ox + b.tx * tile, oy + b.ty * tile, b.fuseLeft, src.tick / 5);
      }
      ctx.fillStyle = water2;
      for (const s of src.splashes) {
        ctx.globalAlpha = 0.75;
        ctx.fillRect(ox + s.tx * tile + 1, oy + s.ty * tile + 1, tile - 2, tile - 2);
      }
      ctx.globalAlpha = 1;

      const players = lastSnap?.players ?? src.players;
      for (const p of players) {
        let x = p.x;
        let y = p.y;
        if (p.id === app.playerId && predictor.predicted) {
          const lp = predictor.predicted.players.find((q) => q.id === p.id);
          if (lp) {
            x = lp.x;
            y = lp.y;
          }
        } else {
          const r = predictor.remotes.get(p.id);
          if (r) {
            x = r.x;
            y = r.y;
          }
        }
        if (p.status === "revenge") {
          drawDuck(ctx, ox + x * tile, oy + y * tile);
        } else {
          drawAnimal(
            ctx,
            ox + x * tile,
            oy + y * tile,
            p.animal,
            p.hat,
            Math.floor(src.tick / 8),
            p.status !== "alive",
          );
        }
        const em = emotes.find((e) => e.id === p.id);
        if (em) {
          ctx.fillStyle = PAL.paper;
          ctx.fillRect(ox + x * tile + 10, oy + y * tile - 8, 16, 10);
          const glyphs = ["♫", "!", "?", "★"];
          ctx.fillStyle = PAL.ink;
          ctx.font = "7px monospace";
          ctx.fillText(glyphs[em.emote - 1] ?? "!", ox + x * tile + 14, oy + y * tile);
        }
      }
      drawParticles(ctx, ox, oy, tile);
      ctx.restore();

      drawHud(ctx, players, scores, ping, 1, match?.config.roundsToWin ?? 3, app.playerId);
      drawKillFeed(ctx, feed);
      if (announcerLife > 0) drawAnnouncer(ctx, announcer, announcerLife);
      if (countdown === "SPLASH") {
        centerText(ctx, "3-2-1-SPLASH!", 110, PAL.gold, 14);
      }
    },
    key(e) {
      keys.add(e.code);
      if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3" || e.code === "Digit4") {
        net.send({ type: "emote", id: Number(e.code.replace("Digit", "")) });
      }
      if (e.code === "KeyM") audio.toggleMute();
    },
    keyup(e) {
      keys.delete(e.code);
    },
    leave() {
      unsub();
    },
  };
}
