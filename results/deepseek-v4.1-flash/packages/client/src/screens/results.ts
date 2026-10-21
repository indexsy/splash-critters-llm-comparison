import {
  levelProgress,
  type MatchEndPayload,
  type MatchPlacement,
  type PlayerProfile,
} from "@splash/shared";
import type { App } from "../main.js";
import {
  COLORS,
  Screen,
  contains,
  drawButton,
  drawOcean,
  drawPanel,
  drawProgress,
  drawTierBadge,
  type Button,
} from "../ui.js";
import { drawText, drawTextCentered, textWidth } from "../render/font.js";
import { drawAnimal } from "../render/sprites.js";

export class ResultsScreen extends Screen {
  private time = 0;
  private xpAnim = 0;
  private revealed = 0;
  private confettiDone = false;
  private buttons: Button[] = [];
  private rematch: Button = { x: 132, y: 190, w: 112, h: 20, label: "REMATCH", action: "rematch" };
  private cont: Button = { x: 14, y: 190, w: 112, h: 20, label: "CONTINUE", action: "continue" };

  constructor(
    app: App,
    readonly data: MatchEndPayload,
  ) {
    super(app);
  }

  enter(): void {
    this.app.audio.setMusic("results");
    this.app.audio.setShowdown(false);
    const placement = this.localPlacement();
    if (placement?.placement === 1) this.app.audio.victory();
    else this.app.audio.defeat();
    this.buttons = [this.cont];
    if (this.data.rematchAllowed) this.buttons.push(this.rematch);
  }

  update(dt: number): void {
    this.time += dt;
    this.xpAnim = Math.min(1, this.xpAnim + dt * 0.7);
    this.revealed = Math.min(this.data.placements.length, Math.floor(this.time * 5));
    if (!this.confettiDone && this.localPlacement()?.placement === 1 && this.time > 0.25) {
      this.confettiDone = true;
      this.app.audio.levelUp();
    }
  }

  private localPlacement(): MatchPlacement | undefined {
    return this.data.placements.find((entry) => entry.playerId === this.app.playerId) ?? this.data.placements[0];
  }

  private xpLine(): { from: number; to: number; earned: number; level: number; levelBefore: number } | null {
    const xp = this.data.xp[this.app.playerId];
    if (!xp) return null;
    return {
      from: xp.total - xp.earned,
      to: xp.total,
      earned: xp.earned,
      level: xp.level,
      levelBefore: xp.levelBefore,
    };
  }

  private act(action: string): void {
    this.app.audio.unlock();
    this.app.audio.click();
    if (action === "continue") {
      this.app.net.leaveRoom();
      this.app.showMenu();
    } else if (action === "rematch") {
      this.app.net.rematchVote();
    }
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.code === "Enter" || event.code === "Escape") {
      this.act("continue");
      return true;
    }
    if (event.code === "KeyR" && this.data.rematchAllowed) {
      this.act("rematch");
      return true;
    }
    return false;
  }

  onClick(x: number, y: number): void {
    for (const button of this.buttons) {
      if (contains(button, x, y)) {
        this.act(button.action);
        return;
      }
    }
  }

  onMouseMove(_x: number, _y: number): void {}

  cursorAt(x: number, y: number): string {
    return this.buttons.some((button) => contains(button, x, y)) ? "pointer" : "default";
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawOcean(ctx, this.time, true);
    const profile = this.app.profile;
    const local = this.localPlacement();
    drawText(ctx, "MATCH RESULTS", 12, 7, COLORS.mint);
    const meta = `${this.data.mode === "duel" ? "DUEL" : "FFA"} ${this.data.ranked ? "RANKED" : "CASUAL"} ${this.data.roomCode}`;
    drawText(ctx, meta, 248 - textWidth(meta), 7, "#5f929d");
    drawPanel(ctx, 8, 22, 152, 85);
    drawText(ctx, "PLACEMENTS", 14, 27, "#6da0ab");
    drawText(ctx, "W", 124, 27, "#4f7f8a");
    drawText(ctx, "S", 142, 27, "#4f7f8a");
    this.data.placements.forEach((entry, index) => {
      if (index >= this.revealed) return;
      const y = 39 + index * 16;
      const isLocal = entry.playerId === this.app.playerId;
      if (isLocal) {
        ctx.fillStyle = "rgba(46, 196, 182, 0.15)";
        ctx.fillRect(10, y - 2, 148, 15);
      }
      drawText(ctx, `${entry.placement}`, 15, y + 2, entry.placement === 1 ? COLORS.yellow : "#7ea9b3");
      drawAnimal(ctx, {
        animal: entry.animal,
        hat: entry.hat,
        x: 26,
        y: y - 1,
        scale: 0.85,
        time: this.time + index,
      });
      drawText(ctx, entry.name.split("#")[0]!.toUpperCase().slice(0, 12), 42, y, isLocal ? COLORS.mint : COLORS.foam);
      drawText(ctx, `${entry.roundsWon}W`, 124, y, COLORS.yellow);
      drawText(ctx, `${entry.soaks}S`, 142, y, "#7db5c0");
    });
    drawPanel(ctx, 164, 22, 84, 85);
    drawText(ctx, "MATCH AWARDS", 170, 27, "#6da0ab");
    const awards: Array<[string, string | null]> = [
      ["MOST SOAKS", this.data.awards.mostSoaks],
      ["CASTLE CRUSH", this.data.awards.castleCrusher],
      ["SURVIVOR", this.data.awards.longestSurvivor],
      ["BEST CHAIN", this.data.awards.biggestChain],
    ];
    awards.forEach(([label, id], index) => {
      const y = 36 + index * 18;
      drawText(ctx, label, 170, y, "#6f9faa");
      const entry = this.data.placements.find((row) => row.playerId === id);
      drawText(ctx, entry ? entry.name.split("#")[0]!.toUpperCase().slice(0, 10) : "NONE", 170, y + 8, entry ? COLORS.yellow : "#496f79");
    });

    drawPanel(ctx, 8, 112, 240, 75);
    const xp = this.xpLine();
    if (xp) {
      const fromProgress = levelProgress(xp.from);
      const toProgress = levelProgress(xp.to);
      const start = xp.levelBefore === xp.level ? fromProgress.ratio : 0;
      const end = toProgress.ratio;
      const animated = start + (end - start) * this.xpAnim + (xp.level > xp.levelBefore ? this.xpAnim * 1.1 : 0);
      drawText(ctx, `LEVEL ${xp.level}`, 15, 119, COLORS.mint);
      drawText(ctx, `+${xp.earned} XP`, 92, 119, COLORS.yellow);
      if (xp.level > xp.levelBefore) drawText(ctx, "LEVEL UP!", 171, 119, COLORS.orange);
      drawProgress(ctx, 15, 131, 226, 7, animated % 1.1, COLORS.teal);
      drawText(ctx, `${toProgress.intoLevel}/${toProgress.needed} XP TO NEXT`, 15, 142, "#6898a3");
    } else {
      drawText(ctx, "PRACTICE / BOT MATCH", 15, 120, COLORS.mint);
      drawText(ctx, "NO RANKED RATING CHANGE", 15, 134, "#6f9da7");
    }
    if (this.data.ranked && local) {
      const delta = this.data.ratingDeltas[this.app.playerId] ?? 0;
      const before = local.ratingBefore ?? 1000;
      const after = local.ratingAfter ?? before;
      drawText(ctx, "RATING", 15, 154, "#7caab5");
      drawText(ctx, `${Math.round(before)}`, 84, 149, COLORS.foam, 2);
      drawText(ctx, ">", 134, 153, "#5c8e99", 1);
      drawText(ctx, `${Math.round(after)}`, 150, 149, COLORS.foam, 2);
      drawText(ctx, `${delta >= 0 ? "+" : ""}${delta}`, 204, 153, delta >= 0 ? COLORS.green : COLORS.coral);
      const tier = this.tierFor(after);
      drawTierBadge(ctx, tier, 244 - 7 - textWidth(tier), 165, 1);
      const placementLine = local.placement === 1 ? "VICTORY!" : `PLACED #${local.placement}`;
      drawText(ctx, placementLine, 15, 169, local.placement === 1 ? COLORS.yellow : COLORS.foam);
      drawText(ctx, `${local.castles} CASTLES  ${local.biggestChain} CHAIN  ${local.survivedTicks}T`, 15, 178, "#5f8e99");
    } else if (local) {
      drawText(ctx, local.placement === 1 ? "VICTORY!" : `PLACED #${local.placement}`, 15, 152, local.placement === 1 ? COLORS.yellow : COLORS.foam, 2);
      drawText(ctx, `SOAKS ${local.soaks}   CASTLES ${local.castles}   CHAIN ${local.biggestChain}`, 15, 174, "#6a9aa4");
    }
    drawButton(ctx, this.cont, false);
    if (this.data.rematchAllowed) {
      const votes = this.app.rematchVotes;
      drawButton(
        ctx,
        { ...this.rematch, label: votes > 0 ? `REMATCH ${votes}/${this.app.rematchNeeded}` : "REMATCH" },
        false,
      );
      drawText(ctx, "ROOM STAYS OPEN", 159, 215, "#477a85");
    }
    drawText(ctx, profile ? `GG, ${profile.nickname.toUpperCase()}!` : "GG!", 14, 215, "#4f7e89");
  }

  private tierFor(rating: number): string {
    if (rating >= 1750) return "Tsunami";
    if (rating >= 1500) return "Ocean";
    if (rating >= 1300) return "Lake";
    if (rating >= 1150) return "River";
    if (rating >= 1000) return "Pond";
    return "Puddle";
  }

  getProfile(): PlayerProfile | null {
    return this.app.profile;
  }
}
