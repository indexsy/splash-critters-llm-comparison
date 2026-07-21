import type { LobbyView, SimPlayer } from "@splash/shared";
import { STAGE_W, HUD_H, balloonColor } from "./sprites.js";

export interface HudEntry {
  player: SimPlayer;
  score: number;
  isLocal: boolean;
}

export interface HudState {
  entries: HudEntry[];
  roundNo: number;
  roundsToWin: number;
  tick: number;
  tideRing: number;
  ranked: boolean;
  mode: "duel" | "ffa";
}

export interface KillFeedItem { id: number; text: string; life: number; color: string; }

export interface AnnouncerState { text: string; sub?: string; until: number; color: string; }

export class Hud {
  killFeed: KillFeedItem[] = [];
  announcer: AnnouncerState | null = null;
  private nextKillId = 1;

  setAnnounce(text: string, color = "#ffd83d", sub?: string, ms = 1800): void {
    this.announcer = { text, color, until: performance.now() + ms, ...(sub !== undefined ? { sub } : {}) };
  }

  pushKill(text: string, color = "#ffffff"): void {
    this.killFeed.unshift({ id: this.nextKillId++, text, life: 1, color });
    if (this.killFeed.length > 4) this.killFeed.length = 4;
  }

  update(dt: number): void {
    for (const k of this.killFeed) k.life -= dt * 0.6;
    this.killFeed = this.killFeed.filter((k) => k.life > 0);
    if (this.announcer && performance.now() > this.announcer.until) this.announcer = null;
  }

  draw(ctx: CanvasRenderingContext2D, state: HudState): void {
    ctx.save();
    ctx.fillStyle = "rgba(6, 18, 42, 0.85)";
    ctx.fillRect(0, 0, STAGE_W, HUD_H);
    ctx.fillStyle = "#1d3a72";
    ctx.fillRect(0, HUD_H - 2, STAGE_W, 2);
    ctx.fillStyle = "#ffd83d";
    ctx.fillRect(0, HUD_H - 1, STAGE_W, 1);

    ctx.font = "bold 8px 'Courier New', monospace";
    ctx.textBaseline = "top";

    const label = `${state.ranked ? "RANKED" : "CASUAL"} · ${state.mode.toUpperCase()} · R${state.roundNo}`;
    ctx.fillStyle = "#ffd83d";
    ctx.fillText(label, 4, 3);

    const targetText = `FIRST TO ${state.roundsToWin}`;
    ctx.fillStyle = "#b8d2f3";
    ctx.fillText(targetText, 4, 13);

    const tideText = state.tideRing > 0 ? `TIDE ${state.tideRing}` : "";
    if (tideText) {
      ctx.fillStyle = "#7ee4ff";
      ctx.fillText(tideText, 80, 13);
    }

    const entries = state.entries.slice(0, 4);
    let x = STAGE_W - 4;
    for (const e of entries) {
      const text = `${e.player.name.slice(0, 8)} ${e.score}`;
      ctx.font = "bold 8px 'Courier New', monospace";
      const w = ctx.measureText(text).width + 18;
      const px0 = x - w;
      ctx.fillStyle = e.isLocal ? "rgba(255, 216, 61, 0.18)" : "rgba(126, 228, 255, 0.10)";
      ctx.fillRect(px0, 3, w, HUD_H - 6);
      ctx.fillStyle = e.isLocal ? "#ffd83d" : "#f4faff";
      ctx.fillText(text, px0 + 14, 6);
      const bx = px0 + 2;
      ctx.fillStyle = balloonColor(Math.max(0, Math.floor(e.player.stats.balloonCount)) + 1);
      ctx.fillRect(bx, 6, 8, 8);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(bx + 6, 7, 1, 6);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(bx + 1, 7, 2, 2);
      ctx.fillStyle = "#fff";
      const balText = `${e.player.stats.balloonCount}`;
      ctx.font = "bold 6px 'Courier New', monospace";
      ctx.fillText(balText, bx + 2, 16);
      ctx.font = "bold 8px 'Courier New', monospace";
      ctx.fillStyle = "#b8d2f3";
      ctx.fillText(`R${e.player.stats.splashRange}`, px0 + w - 16, 16);
      x = px0 - 2;
    }

    this.drawKill(ctx);
    this.drawAnnouncer(ctx);
    ctx.restore();
  }

  private drawKill(ctx: CanvasRenderingContext2D): void {
    if (!this.killFeed.length) return;
    ctx.font = "bold 7px 'Courier New', monospace";
    ctx.textBaseline = "top";
    let y = HUD_H + 4;
    for (const k of this.killFeed) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, k.life));
      ctx.fillStyle = "rgba(6, 18, 42, 0.7)";
      const w = ctx.measureText(k.text).width + 8;
      ctx.fillRect(STAGE_W - w - 2, y, w, 9);
      ctx.fillStyle = k.color;
      ctx.fillText(k.text, STAGE_W - w + 2, y + 1);
      ctx.restore();
      y += 11;
    }
  }

  private drawAnnouncer(ctx: CanvasRenderingContext2D): void {
    if (!this.announcer) return;
    const now = performance.now();
    const remaining = Math.max(0, this.announcer.until - now);
    const a = Math.min(1, remaining / 200);
    const t = Math.max(0, 1 - remaining / 1800);
    const scale = 1 + Math.max(0, (1 - t * 4)) * 0.3;
    ctx.save();
    ctx.globalAlpha = a;
    const cx = STAGE_W / 2;
    const cy = 100;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 14px 'Courier New', monospace";
    const tw = ctx.measureText(this.announcer.text).width;
    ctx.fillStyle = "rgba(6, 18, 42, 0.85)";
    ctx.fillRect(-tw / 2 - 8, -10, tw + 16, 20);
    ctx.fillStyle = this.announcer.color;
    ctx.fillText(this.announcer.text, 0, 0);
    if (this.announcer.sub) {
      ctx.font = "bold 8px 'Courier New', monospace";
      ctx.fillStyle = "#f4faff";
      ctx.fillText(this.announcer.sub, 0, 14);
    }
    ctx.restore();
  }
}

export function drawLobbyPreview(_ctx: CanvasRenderingContext2D, _lobby: LobbyView, _t: number, _portrait: (ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, t: number) => void): void {
  void _ctx; void _lobby; void _t; void _portrait;
}

export function killTextFromEvent(player: SimPlayer, ownerId: string, players: SimPlayer[]): string {
  const owner = players.find((p) => p.id === ownerId);
  if (!owner || ownerId === "tide") return `${player.name} DRIFTED OUT`;
  return `${owner.name} SOAKED ${player.name}`;
}
