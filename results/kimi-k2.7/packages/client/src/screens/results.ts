import type { App, Screen } from "../main.js";

export class ResultsScreen implements Screen {
  app: App;
  result: any;

  constructor(app: App, data: any) {
    this.app = app;
    this.result = data.result;
  }

  update() {}

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 224);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("MATCH RESULTS", 128, 24);

    ctx.font = "8px monospace";
    ctx.textAlign = "left";
    let y = 48;
    for (const p of this.result.placements) {
      const stat = this.result.stats[p.playerId] || { soaks: 0, castles: 0, roundsWon: 0 };
      const delta = this.result.ratingDeltas[p.playerId];
      ctx.fillStyle = p.placement === 1 ? "#facc15" : "#e2e8f0";
      ctx.fillText(
        `#${p.placement} ${p.playerId.slice(0, 8)} S:${stat.soaks} R:${stat.roundsWon}${delta !== undefined ? ` ${delta > 0 ? "+" : ""}${delta}` : ""}`,
        20,
        y
      );
      y += 16;
    }

    ctx.fillStyle = "#94a3b8";
    ctx.fillText("SPACE / CLICK to continue", 20, 200);
  }

  onKey(_e: KeyboardEvent, down: boolean) {
    if (down) this.app.setScreen("menu");
  }

  onMouse(_x: number, _y: number, down: boolean) {
    if (down) this.app.setScreen("menu");
  }
}
