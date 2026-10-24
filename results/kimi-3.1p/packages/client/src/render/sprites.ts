import { TILE } from "@splash/shared";
import type { Animal, BalloonState, Direction, Hat, PowerUpType, Theme, TileValue } from "@splash/shared";

export const THEME_COLORS = {
  backyard: { groundA: "#4b9b62", groundB: "#438b58", border: "#8b5a3c", boulder: "#607d72", detail: "#a4d65e", castle: "#e7bd68", castleDark: "#a8743c" },
  beach: { groundA: "#e7bd68", groundB: "#dcae5d", border: "#8be9fd", boulder: "#8a96bd", detail: "#f7f3d5", castle: "#f3cf7d", castleDark: "#b87943" },
  pool: { groundA: "#70c9d4", groundB: "#62bcc9", border: "#f7f3d5", boulder: "#3867d6", detail: "#f9dc5c", castle: "#f0c979", castleDark: "#b87551" }
} as const;

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, width: number, height: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

export function drawArenaTile(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  tile: TileValue,
  tileX: number,
  tileY: number,
  x: number,
  y: number,
  size: number,
  flooded: boolean,
  time: number
): void {
  const colors = THEME_COLORS[theme];
  rect(ctx, (tileX + tileY) % 2 ? colors.groundA : colors.groundB, x, y, size, size);
  if (theme === "backyard") {
    rect(ctx, colors.detail, x + 3 + (tileX * 5 + tileY * 3) % 7, y + 4 + (tileX + tileY * 7) % 6, 1, 3);
  } else if (theme === "beach") {
    rect(ctx, colors.detail, x + 3 + (tileX * 7) % 8, y + 3 + (tileY * 5) % 8, 1, 1);
    if ((tileX * 11 + tileY * 7) % 13 === 0) rect(ctx, "#f78c4b", x + 9, y + 10, 2, 1);
  } else {
    ctx.strokeStyle = "#f7f3d533";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, size - 1, size - 1);
  }
  if (tile === TILE.BOULDER) {
    rect(ctx, "#10162f", x, y + size - 3, size, 3);
    rect(ctx, colors.border, x, y, size, size - 2);
    rect(ctx, colors.boulder, x + 2, y + 2, size - 4, size - 5);
    rect(ctx, "#ffffff44", x + 3, y + 3, size - 7, 2);
    rect(ctx, "#10162f44", x + size - 4, y + 4, 2, size - 7);
  }
  if (tile === TILE.CASTLE) {
    rect(ctx, "#10162f55", x + 2, y + size - 3, size - 2, 2);
    rect(ctx, colors.castleDark, x + 2, y + 5, size - 4, size - 7);
    rect(ctx, colors.castle, x + 3, y + 4, size - 6, size - 7);
    rect(ctx, colors.castle, x + 1, y + 2, 4, 5);
    rect(ctx, colors.castle, x + size - 5, y + 2, 4, 5);
    rect(ctx, colors.castleDark, x + 5, y + 7, size - 10, size - 9);
    rect(ctx, "#10162f", x + 6, y + size - 6, 3, 4);
  }
  if (flooded) {
    rect(ctx, "#38bdf8bb", x, y, size, size);
    rect(ctx, "#f7f3d5aa", x + (Math.floor(time / 150) + tileX * 3) % 8, y + 3 + tileY % 7, 5, 1);
    rect(ctx, "#3867d688", x + 2, y + size - 4, size - 4, 2);
  }
}

export function drawAnimal(
  ctx: CanvasRenderingContext2D,
  animal: Animal,
  centerX: number,
  centerY: number,
  frame: number,
  hat: Hat = "none",
  direction: Direction = "down",
  soaked = false,
  size = 14
): void {
  const x = Math.round(centerX - size / 2);
  const y = Math.round(centerY - size / 2 + 1);
  const u = size / 14;
  const r = (color: string, rx: number, ry: number, rw: number, rh: number) => rect(ctx, color, x + rx * u, y + ry * u, rw * u, rh * u);
  const step = frame % 2;
  const colors: Record<Animal, [string, string]> = {
    frog: ["#56e39f", "#237a55"],
    duck: ["#f9dc5c", "#d78c3c"],
    otter: ["#b9825a", "#70452f"],
    penguin: ["#29345d", "#f7f3d5"],
    cat: ["#b9b7c9", "#6f6a85"],
    raccoon: ["#8a96bd", "#454b67"],
    turtle: ["#6fa65b", "#386744"],
    capybara: ["#b98a62", "#76523c"]
  };
  const [main, dark] = colors[animal];
  if (animal === "turtle") r(dark, 1, 6 + step, 3, 5);
  if (animal === "otter") r(dark, 10, 8 + step, 4, 3);
  if (animal === "raccoon") {
    r(dark, 10, 7 + step, 4, 5);
    r("#f7f3d5", 11, 8 + step, 2, 1);
  }
  r("#10162f", 3, 11 - step, 3, 3);
  r("#10162f", 8, 11 + step, 3, 3);
  r(main, 3, 10 - step, 3, 3);
  r(main, 8, 10 + step, 3, 3);
  r("#10162f", 2, 4, 10, 8);
  r(main, 3, 5, 8, 7);
  if (animal === "penguin") r("#f7f3d5", 5, 6, 4, 6);
  if (animal === "turtle") {
    r("#386744", 3, 6, 8, 5);
    r("#a4d65e", 6, 7, 2, 2);
  }
  if (animal === "cat" || animal === "raccoon") {
    r(main, 2, 1, 3, 4);
    r(main, 9, 1, 3, 4);
    r(dark, 3, 2, 1, 2);
    r(dark, 10, 2, 1, 2);
  }
  if (animal === "frog") {
    r(main, 2, 2, 4, 4);
    r(main, 8, 2, 4, 4);
    r("#f7f3d5", 3, 2, 2, 2);
    r("#f7f3d5", 9, 2, 2, 2);
    r("#10162f", 4, 3, 1, 1);
    r("#10162f", 9, 3, 1, 1);
  } else {
    r(main, 3, 2, 8, 5);
    if (animal !== "duck" && animal !== "capybara") {
      r("#10162f", 4, 4, 1, 1);
      r("#10162f", 9, 4, 1, 1);
    }
  }
  if (animal === "duck") {
    r("#f78c4b", 5, 5, 5, 2);
    r("#10162f", 4, 4, 1, 1);
    r("#10162f", 9, 4, 1, 1);
  } else if (animal === "capybara") {
    r(dark, 4, 5, 7, 4);
    r("#10162f", 4, 3, 1, 1);
    r("#10162f", 9, 3, 1, 1);
    r("#10162f", 7, 6, 2, 1);
  } else if (animal === "raccoon") {
    r("#29345d", 3, 4, 8, 2);
    r("#f7f3d5", 5, 4, 1, 1);
    r("#f7f3d5", 9, 4, 1, 1);
  } else if (animal !== "frog") {
    r(dark, 6, 6, 2, 1);
  }
  if (direction === "left") r("#ffffff55", 2, 6, 1, 3);
  if (direction === "right") r("#ffffff55", 11, 6, 1, 3);
  if (hat === "bucket") {
    r("#3867d6", 2, 1, 10, 2);
    r("#8be9fd", 4, 0, 6, 2);
  }
  if (hat === "snorkel") {
    r("#f9dc5c", 2, 3, 10, 2);
    r("#8be9fd", 3, 3, 3, 2);
    r("#8be9fd", 8, 3, 3, 2);
    r("#f78c4b", 11, 0, 2, 4);
  }
  if (hat === "crown") {
    r("#f9dc5c", 3, 0, 8, 2);
    r("#f9dc5c", 3, -1, 1, 2);
    r("#f9dc5c", 7, -2, 1, 3);
    r("#f9dc5c", 10, -1, 1, 2);
  }
  if (hat === "bandana") {
    r("#d64550", 2, 2, 10, 2);
    r("#d64550", 10, 3, 3, 3);
  }
  if (hat === "propeller") {
    r("#9b7ede", 3, 1, 8, 2);
    r("#f9dc5c", 6, -1, 2, 2);
    r(step ? "#8be9fd" : "#f78c4b", 2, -2, 10, 1);
  }
  if (soaked) {
    r("#38bdf899", 2, 2, 10, 10);
    r("#f7f3d5", 4, 4, 2, 1);
    r("#f7f3d5", 8, 4, 2, 1);
    if (animal === "cat") {
      r("#f9dc5c", 0, 0, 2, 2);
      r("#f9dc5c", 12, 0, 2, 2);
      r("#f9dc5c", 0, 8, 2, 2);
      r("#f9dc5c", 12, 8, 2, 2);
    }
  }
}

export function drawBalloon(ctx: CanvasRenderingContext2D, balloon: BalloonState, x: number, y: number, size: number, time: number): void {
  const urgency = 1 - Math.max(0, balloon.fuse) / 90;
  const wobble = Math.round(Math.sin(time / (130 - urgency * 90) + balloon.id) * (1 + urgency));
  const inflate = urgency > 0.75 && Math.floor(time / 100) % 2 ? 1 : 0;
  const color = balloon.revenge ? "#f9dc5c" : balloon.fuse < 20 && Math.floor(time / 90) % 2 ? "#f7f3d5" : "#38bdf8";
  rect(ctx, "#10162f", x + 4 - inflate + wobble, y + 2 - inflate, 7 + inflate * 2, 9 + inflate * 2);
  rect(ctx, color, x + 3 + wobble, y + 3, 8, 7);
  rect(ctx, color, x + 4 + wobble, y + 2, 6, 9);
  rect(ctx, "#f7f3d5", x + 5 + wobble, y + 3, 2, 2);
  rect(ctx, "#10162f", x + 7 + wobble, y + 11, 2, 2);
  if (balloon.kickDir) {
    rect(ctx, "#f7f3d5", x - 3, y + 5, 3, 1);
    rect(ctx, "#f7f3d5", x - 5, y + 8, 3, 1);
  }
}

export function drawSplashCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, id: number, colorblind: boolean, time: number): void {
  const main = colorblind ? "#f9dc5c" : "#8be9fd";
  const accent = colorblind ? "#f7f3d5" : "#3867d6";
  const wobble = (id + Math.floor(time / 80)) % 3;
  rect(ctx, `${accent}aa`, x + 1, y + 4, size - 2, size - 8);
  rect(ctx, main, x + 2, y + 2 + wobble, size - 4, size - 4 - wobble * 2);
  rect(ctx, "#f7f3d5", x + 4, y + 4, size - 8, 2);
  rect(ctx, main, x + (id * 5) % (size - 3), y - 2, 2, 2);
  rect(ctx, main, x + (id * 7) % (size - 3), y + size, 2, 2);
}

export function drawPowerup(ctx: CanvasRenderingContext2D, kind: PowerUpType, x: number, y: number, size: number, time: number): void {
  const bob = Math.floor(time / 250) % 2;
  rect(ctx, "#10162f", x + 1, y + 1 - bob, size - 2, size - 2);
  rect(ctx, "#f9dc5c", x + 2, y + 2 - bob, size - 4, size - 4);
  if (kind === "balloon") {
    rect(ctx, "#38bdf8", x + 5, y + 3 - bob, 5, 6);
    rect(ctx, "#10162f", x + 7, y + 9 - bob, 1, 2);
  }
  if (kind === "range") {
    rect(ctx, "#3867d6", x + 3, y + 6 - bob, size - 6, 2);
    rect(ctx, "#3867d6", x + 6, y + 3 - bob, 2, size - 6);
    rect(ctx, "#3867d6", x + 3, y + 4 - bob, 2, 2);
    rect(ctx, "#3867d6", x + size - 5, y + 4 - bob, 2, 2);
  }
  if (kind === "speed") {
    rect(ctx, "#56e39f", x + 3, y + 4 - bob, 4, 7);
    rect(ctx, "#56e39f", x + 7, y + 3 - bob, 4, 7);
    rect(ctx, "#f7f3d5", x + 3, y + 10 - bob, 4, 1);
  }
  if (kind === "kick") {
    rect(ctx, "#f78c4b", x + 4, y + 3 - bob, 4, 6);
    rect(ctx, "#f78c4b", x + 4, y + 8 - bob, 7, 3);
    rect(ctx, "#10162f", x + 3, y + 11 - bob, 8, 1);
  }
}

export function drawRevengeDuck(ctx: CanvasRenderingContext2D, animal: Animal, x: number, y: number, frame: number, time: number): void {
  const bob = Math.sin(time / 160) > 0 ? 0 : 1;
  rect(ctx, "#10162f", x - 7, y - 3 + bob, 14, 8);
  rect(ctx, "#f9dc5c", x - 6, y - 2 + bob, 12, 6);
  rect(ctx, "#f78c4b", x + 3, y - 5 + bob, 5, 3);
  drawAnimal(ctx, animal, x, y - 5 + bob, frame, "none", "down", false, 10);
}
