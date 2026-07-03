import type { GameMode, S2C } from "@splash/shared";
import { app, type Screen } from "../app.js";
import { drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { critterSprite } from "../render/sprites.js";
import { button } from "../render/ui.js";

export class QueueScreen implements Screen {
  private mode: GameMode = "duel";
  private waitingMs = 0;
  private searchRange = 100;
  private etaMs = 30000;
  private t = 0;
  private found = false;

  enter(params?: unknown): void {
    const p = params as { mode: GameMode };
    this.mode = p.mode;
    this.waitingMs = 0;
    this.found = false;
  }

  onMessage(msg: S2C): void {
    if (msg.t === "queue_status" && msg.mode === this.mode) {
      this.waitingMs = msg.waitingMs;
      this.searchRange = msg.searchRange;
      this.etaMs = msg.etaMs;
    }
    if (msg.t === "match_found") {
      this.found = true;
      app.audio.sfx("go");
    }
  }

  update(dt: number): void {
    this.t += dt;
    this.waitingMs += dt * 1000;
  }

  onKeyDown(code: string): boolean | void {
    if (code === "Escape") {
      this.cancel();
      return true;
    }
  }

  private cancel(): void {
    app.net.send({ t: "queue_leave" });
    app.go("menu");
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.uiBg;
    g.fillRect(0, 0, 256, 224);
    drawTextCentered(g, this.mode === "duel" ? "RANKED DUEL" : "RANKED FREE-FOR-ALL", 128, 30, PAL.gold, 2);

    // swimming critter
    const x = 96 + Math.round(Math.sin(this.t * 1.5) * 60);
    g.drawImage(
      critterSprite(app.profile?.selectedAnimal ?? "frog", app.profile?.selectedHat ?? "none", Math.floor(this.t * 5) % 2, Math.sin(this.t * 1.5 + 0.2) > Math.sin(this.t * 1.5) ? 2 : 4),
      0, 0, 16, 16, x, 84, 32, 32
    );
    g.fillStyle = PAL.waterDeep;
    g.fillRect(0, 116, 256, 4);

    if (this.found) {
      drawTextCentered(g, "MATCH FOUND!", 128, 140, PAL.green, 2);
    } else {
      const secs = Math.floor(this.waitingMs / 1000);
      drawTextCentered(g, `SEARCHING... ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, 128, 136, PAL.white);
      drawTextCentered(g, `RATING RANGE: +/-${this.searchRange}`, 128, 148, PAL.gray);
      drawTextCentered(g, `EST. WAIT: ${Math.ceil(this.etaMs / 1000)}S`, 128, 158, PAL.darkgray);
      const rating = app.profile?.ratings[this.mode]?.rating ?? 1000;
      drawTextCentered(g, `YOUR RATING: ${rating}`, 128, 170, PAL.waterLight);
      if (button(g, 103, 190, 50, 13, "CANCEL")) this.cancel();
    }
  }
}
