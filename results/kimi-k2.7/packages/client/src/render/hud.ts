import type { RoundState } from "@splash/shared";

export function drawHUD(ctx: CanvasRenderingContext2D, state: RoundState, localId?: string) {
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "8px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`Round ${state.roundNo}`, 4, 10);

  let x = 4;
  for (const p of state.players) {
    const color = p.alive ? "#e2e8f0" : "#94a3b8";
    ctx.fillStyle = color;
    ctx.fillText(`${p.nickname} ${p.activeBalloons}/${p.stats.balloonCount}`, x, 22);
    x += 70;
  }

  if (localId) {
    const local = state.players.find((p) => p.id === localId);
    if (local) {
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(`Spd:${local.stats.speed.toFixed(1)} Rng:${local.stats.splashRange}`, 4, 30);
    }
  }
}

export function drawAnnounce(ctx: CanvasRenderingContext2D, text: string, y = 120) {
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, y - 8, 256, 16);
  ctx.fillStyle = "#facc15";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText(text, 128, y + 3);
}
