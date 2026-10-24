import { CONFIG, mapIndex, tierFor } from "@splash/shared";
import type { GameEvent, GameState } from "@splash/shared";
import { STR, themeName } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { announce, drawHud, drawKillFeed, drawTierBadge } from "../render/hud.js";
import { drawAnimal, drawArenaTile, drawBalloon, drawPowerup, drawRevengeDuck, drawSplashCell } from "../render/sprites.js";
import { background, button, centered, panel, text } from "./ui.js";

const TILE_SIZE = 14;
const EMOTES = ["QUACK", "RIBBIT", "SQUEAK", "HONK"];
let lastInputAt = 0;
let lastFrameAt = 0;
let shake = 0;
let lastPhase: GameState["phase"] | null = null;
let splashUntil = 0;
let announcement = { text: "", until: 0, color: "#f9dc5c" };
let hitStopUntil = 0;
let sampledDirection: "up" | "down" | "left" | "right" | "none" = "none";
let sampledBalloon = false;

function layout(state: GameState) {
  return {
    x: Math.round((256 - state.map.width * TILE_SIZE) / 2),
    y: 37 + Math.round((182 - state.map.height * TILE_SIZE) / 2)
  };
}

function eventPoint(app: App, x: number, y: number) {
  const state = app.prediction.state;
  if (!state) return { x: 128, y: 112 };
  const origin = layout(state);
  return { x: origin.x + x * TILE_SIZE + TILE_SIZE / 2, y: origin.y + y * TILE_SIZE + TILE_SIZE / 2 };
}

function pop(text: string, color = "#f9dc5c", duration = 850): void {
  announcement = { text, color, until: performance.now() + duration };
}

export function handleGameEvent(app: App, event: GameEvent): void {
  app.tutorial.event(app, event);
  if (event.type === "balloon_dropped" || event.type === "revenge_lob") app.audio.play("drop");
  if (event.type === "balloon_kicked") app.audio.play("kick");
  if (event.type === "balloon_burst") {
    app.audio.play("burst");
    const point = eventPoint(app, event.x, event.y);
    app.particles.splash(point.x, point.y, app.settings.colorblind);
    shake = Math.max(shake, 2);
  }
  if (event.type === "castle_washed") {
    const point = eventPoint(app, event.x, event.y);
    app.particles.castle(point.x, point.y);
  }
  if (event.type === "powerup_collected") {
    const player = app.prediction.state?.players.find((candidate) => candidate.id === event.playerId);
    if (player) {
      const point = eventPoint(app, player.x, player.y);
      app.particles.pickup(point.x, point.y);
    }
    app.audio.play("pickup");
  }
  if (event.type === "chain_burst") {
    app.audio.play("chain", event.count);
    pop(event.count === 2 ? STR.doubleSplash : event.count === 3 ? STR.tripleSplash : `${STR.megaChain} ×${event.count}`, "#8be9fd", 1000);
    shake = Math.max(shake, 3);
  }
  if (event.type === "tide_advance") {
    app.audio.play("tide");
    pop(STR.risingTide, "#ff858d", 1000);
  }
  if (event.type === "emote") app.audio.play(`emote${event.emote}` as "emote1" | "emote2" | "emote3" | "emote4");
  if (event.type === "player_soaked") {
    const state = app.prediction.state;
    const victim = state?.players.find((player) => player.id === event.playerId);
    const attacker = state?.players.find((player) => player.id === event.by);
    if (victim) {
      const point = eventPoint(app, victim.x, victim.y);
      app.particles.soak(point.x, point.y);
      app.feed.push({ text: `${attacker?.nickname ?? STR.risingTide} soaked ${victim.nickname}!`, until: performance.now() + 4500, color: "#8be9fd" });
    }
    app.audio.play("soak");
    hitStopUntil = performance.now() + 2000 / CONFIG.TICK_RATE;
    shake = Math.max(shake, 4);
  }
}

export const gameScreen: Screen = {
  enter(app) {
    app.audio.setTrack("match");
    app.clearInputs();
    lastInputAt = performance.now();
    lastFrameAt = lastInputAt;
    sampledDirection = "none";
    sampledBalloon = false;
    lastPhase = app.prediction.state?.phase ?? null;
  },
  exit(app) {
    app.clearInputs();
    app.audio.setShowdown(false);
  },
  key(app, code) {
    if (code === "Escape") {
      app.openPause();
      return true;
    }
    if (/^Digit[1-4]$/.test(code)) {
      app.net.send({ type: "emote", id: Number(code.slice(-1)) });
      return true;
    }
    return false;
  },
  render(app, time) {
    const state = app.prediction.state;
    if (!state) {
      background(app, time);
      centered(app, STR.waiting, 128, 100, "#8be9fd", 9);
      return;
    }
    background(app, time, state.config.theme === "beach");
    const origin = layout(state);
    const ctx = app.canvas;
    ctx.save();
    if (shake > 0.2 && !app.settings.reducedShake) ctx.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake));
    panel(app, origin.x - 3, origin.y - 3, state.map.width * TILE_SIZE + 6, state.map.height * TILE_SIZE + 6, "#10162f");
    for (let y = 0; y < state.map.height; y += 1) {
      for (let x = 0; x < state.map.width; x += 1) {
        const index = mapIndex(state.map, x, y);
        drawArenaTile(ctx, state.config.theme, state.map.tiles[index], x, y, origin.x + x * TILE_SIZE, origin.y + y * TILE_SIZE, TILE_SIZE, state.map.flooded[index], time);
      }
    }
    for (const powerup of state.powerups) drawPowerup(ctx, powerup.kind, origin.x + powerup.x * TILE_SIZE, origin.y + powerup.y * TILE_SIZE, TILE_SIZE, time);
    for (const balloon of state.balloons) {
      const position = app.prediction.balloonPosition(balloon, app.net.serverNow());
      drawBalloon(ctx, balloon, origin.x + position.x * TILE_SIZE, origin.y + position.y * TILE_SIZE, TILE_SIZE, time);
    }
    for (const splash of state.splashes) drawSplashCell(ctx, origin.x + splash.x * TILE_SIZE, origin.y + splash.y * TILE_SIZE, TILE_SIZE, splash.id, app.settings.colorblind, time);
    state.players.forEach((player, index) => {
      const position = app.prediction.positionFor(player, app.net.serverNow());
      const x = origin.x + position.x * TILE_SIZE + TILE_SIZE / 2;
      const y = origin.y + position.y * TILE_SIZE + TILE_SIZE / 2;
      const frame = player.dir === "none" ? 0 : Math.floor(time / 150 + index) % 2;
      if (!player.alive && state.config.revengeDucks) drawRevengeDuck(ctx, player.animal, x, y, frame, time);
      else drawAnimal(ctx, player.animal, x, y, frame, player.hat, player.dir, !player.alive, TILE_SIZE);
      if (state.tick - player.emoteTick < 45 && player.emote > 0) {
        panel(app, x - 22, y - 27, 44, 12, "#f7f3d5");
        centered(app, EMOTES[player.emote - 1], x, y - 24, "#10162f", 6);
      }
    });
    app.particles.render(ctx);
    ctx.restore();
    drawHud(app, state);
    drawKillFeed(app);
    app.tutorial.render(app);
    if (announcement.until > time) announce(app, announcement.text, "", announcement.color);
    if (state.phase === "countdown") {
      if (state.round === 1 && state.phaseTicks > 45) {
        panel(app, 19, 60, 218, 96, "#182142f2");
        centered(app, themeName(state.config.theme), 128, 66, "#8be9fd", 7);
        state.players.forEach((player, index) => {
          const x = 128 + (index - (state.players.length - 1) / 2) * Math.min(76, 220 / state.players.length);
          drawAnimal(ctx, player.animal, x, 91, Math.floor(time / 170 + index) % 2, player.hat, "down", false, 28);
          centered(app, player.nickname.split("#")[0], x, 110, "#f7f3d5", 6);
          const rating = app.matchRatings[player.id];
          if (rating !== null && rating !== undefined) drawTierBadge(app, tierFor(rating), x - 21, 121, 42);
        });
        centered(app, STR.versus, 128, 137, "#f9dc5c", 11);
      } else {
        announce(app, String(Math.max(1, Math.ceil(state.phaseTicks / CONFIG.TICK_RATE))), `${STR.round} ${state.round}`);
      }
    }
    if (splashUntil > time) announce(app, STR.splash);
    if (state.phase === "round_end") {
      const winner = state.players.find((player) => player.id === state.roundWinnerId);
      announce(app, winner ? STR.roundWinner : STR.roundDraw, winner?.nickname ?? "", winner ? "#56e39f" : "#f9dc5c");
    }
  }
};

export function updateGame(app: App, now: number): void {
  const delta = Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1000));
  lastFrameAt = now;
  if (now >= hitStopUntil) {
    app.particles.update(delta);
    shake *= 0.88;
  }
  app.tutorial.update(app);
  const state = app.prediction.state;
  if (state) {
    app.audio.setShowdown(state.phase === "playing" && state.players.filter((player) => player.alive).length === 2);
    if (lastPhase === "countdown" && state.phase === "playing") {
      splashUntil = now + 500;
      app.audio.play("chain", 1);
    }
    lastPhase = state.phase;
  }
  sampledDirection = app.currentDirection();
  if (app.consumeBalloon()) sampledBalloon = true;
  if (now - lastInputAt < 1000 / CONFIG.INPUT_SEND_RATE) return;
  const steps = Math.min(2, Math.floor((now - lastInputAt) / (1000 / CONFIG.INPUT_SEND_RATE)));
  for (let index = 0; index < steps; index += 1) {
    const input = app.prediction.step(sampledDirection, sampledBalloon);
    sampledBalloon = false;
    if (input) app.net.send(input);
    lastInputAt += 1000 / CONFIG.INPUT_SEND_RATE;
  }
  if (now - lastInputAt > 250) lastInputAt = now;
}
