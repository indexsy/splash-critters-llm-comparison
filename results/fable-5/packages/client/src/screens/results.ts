import { xpProgress, type MatchPlayerInfo, type S2C } from "@splash/shared";
import { app, type Screen } from "../app.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { critterSprite } from "../render/sprites.js";
import { button, panel } from "../render/ui.js";

type MatchEnd = Extract<S2C, { t: "match_end" }>;

interface ResultsParams {
  end: MatchEnd;
  players: MatchPlayerInfo[];
}

export class ResultsScreen implements Screen {
  private end: MatchEnd | null = null;
  private infos: MatchPlayerInfo[] = [];
  private t = 0;
  private votes = 0;
  private needed = 0;
  private voted = false;

  enter(params?: unknown): void {
    const p = params as ResultsParams;
    this.end = p.end;
    this.infos = p.players;
    this.t = 0;
    this.votes = 0;
    this.needed = 0;
    this.voted = false;
    const me = this.end.players.find((x) => x.playerId === app.profile?.playerId);
    if (me?.placement === 1) app.audio.sfx("victory");
    app.audio.music("menu");
  }

  onMessage(msg: S2C): void {
    if (msg.t === "rematch_state") {
      this.votes = msg.votes;
      this.needed = msg.needed;
    }
    // match_start (rematch) routes to the game screen globally
  }

  update(dt: number): void {
    this.t += dt;
  }

  private info(slot: number): MatchPlayerInfo | undefined {
    return this.infos.find((i) => i.slot === slot);
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.uiBg;
    g.fillRect(0, 0, 256, 224);
    const end = this.end;
    if (!end) return;

    const sorted = [...end.players].sort((a, b) => a.placement - b.placement);
    const winner = sorted[0];
    const isMeWinner = winner.playerId === app.profile?.playerId;
    drawTextCentered(g, isMeWinner ? "VICTORY!" : "MATCH OVER", 128, 6, isMeWinner ? PAL.gold : PAL.waterLight, 2);

    // placement table
    panel(g, 8, 22, 240, 76);
    sorted.forEach((p, i) => {
      const y = 27 + i * 17;
      const info = this.info(p.slot);
      const isMe = p.playerId === app.profile?.playerId;
      drawText(g, `${p.placement}`, 14, y + 3, p.placement === 1 ? PAL.gold : PAL.gray);
      if (info) g.drawImage(critterSprite(info.animal, info.hat, 0, 3), 0, 0, 16, 16, 22, y, 14, 14);
      drawText(g, p.nickname.split("#")[0].slice(0, 11), 40, y + 3, isMe ? PAL.gold : PAL.white);
      drawText(g, `W${p.roundsWon}`, 92, y + 3, PAL.waterLight);
      drawText(g, `SOAKS ${p.soaks}`, 110, y + 3, PAL.white);
      drawText(g, `CASTLES ${p.castles}`, 152, y + 3, PAL.sand);
      if (end.ranked && p.ratingBefore !== undefined && p.ratingAfter !== undefined) {
        const delta = p.ratingAfter - p.ratingBefore;
        drawText(g, `${p.ratingAfter}(${delta >= 0 ? "+" : ""}${delta})`, 202, y + 3, delta >= 0 ? PAL.green : PAL.red);
      } else if (p.xpEarned > 0) {
        drawText(g, `+${p.xpEarned}XP`, 208, y + 3, PAL.green);
      }
    });

    // awards
    panel(g, 8, 102, 240, 46, "FUN STATS");
    const awardLines: string[] = [];
    const name = (slot?: number) => (slot !== undefined ? this.end!.players.find((p) => p.slot === slot)?.nickname.split("#")[0] : undefined);
    if (name(end.awards.mostSoaks)) awardLines.push(`MOST SOAKS: ${name(end.awards.mostSoaks)}`);
    if (name(end.awards.castleCrusher)) awardLines.push(`CASTLE CRUSHER: ${name(end.awards.castleCrusher)}`);
    if (name(end.awards.longestSurvivor)) awardLines.push(`LONGEST SURVIVOR: ${name(end.awards.longestSurvivor)}`);
    if (name(end.awards.biggestChain)) awardLines.push(`BIGGEST CHAIN: ${name(end.awards.biggestChain)}`);
    awardLines.slice(0, 4).forEach((line, i) => {
      drawText(g, line.toUpperCase(), 14 + (i % 2) * 120, 116 + Math.floor(i / 2) * 12, i % 2 ? PAL.waterLight : PAL.gold);
    });

    // XP bar (animated toward current profile progress)
    const prof = app.profile;
    if (prof) {
      const [have, need] = xpProgress(prof.xp);
      const frac = Math.min(1, this.t / 1.2) * (have / need);
      drawText(g, `LEVEL ${prof.level}`, 14, 154, PAL.gold);
      g.fillStyle = PAL.darkgray;
      g.fillRect(60, 154, 140, 6);
      g.fillStyle = PAL.green;
      g.fillRect(60, 154, Math.round(140 * frac), 6);
      drawText(g, `${have}/${need}`, 206, 154, PAL.gray);
    }

    // actions
    if (end.rematchAvailable) {
      const label = this.voted ? `WAITING ${this.votes}/${this.needed || "?"}` : "REMATCH VOTE";
      if (button(g, 24, 176, 96, 16, label, { selected: this.voted })) {
        if (!this.voted) {
          this.voted = true;
          app.net.send({ t: "rematch_vote" });
        }
      }
    }
    if (button(g, end.rematchAvailable ? 136 : 80, 176, 96, 16, "BACK TO MENU")) {
      app.net.send({ t: "leave_room" });
      app.go("menu");
    }
    drawTextCentered(g, end.ranked ? "RANKED MATCH" : "CASUAL MATCH", 128, 204, PAL.darkgray);
  }
}
