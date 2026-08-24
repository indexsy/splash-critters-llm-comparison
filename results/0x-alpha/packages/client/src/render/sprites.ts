/** Procedural 8-bit sprite drawing on the arena canvas. */

export type AnimalId =
  | "frog"
  | "duck"
  | "otter"
  | "penguin"
  | "cat"
  | "raccoon"
  | "turtle"
  | "capybara";
export type HatId = "bucket_hat" | "snorkel" | "tiny_crown" | "pirate_bandana" | "propeller_cap";

const P = {
  k: "#0b0d1a",
  w: "#f4f4f4",
  frog: "#38b764",
  frog2: "#257953",
  duck: "#ffcd75",
  duck2: "#e08c3a",
  otter: "#a0643a",
  otter2: "#6e431f",
  penguin: "#29366f",
  penguin2: "#141b33",
  cat: "#94a1b2",
  cat2: "#5a6988",
  raccoon: "#7b8bbd",
  raccoon2: "#414869",
  turtle: "#63c74d",
  turtle2: "#3e8948",
  capy: "#b86f50",
  capy2: "#8a4b32",
  beak: "#fe7b1f",
  pink: "#e889a0",
};

// 8x8 critter frames; '.' transparent
const FRAMES: Record<AnimalId, [string[], string[]]> = {
  frog: [
    ["..kkkk..", ".kffffk.", "kwffffwk", "kffffffk", "kfkkkkfk", "kffffffk", ".kfkkfk.", "..kkkk.."],
    ["..kkkk..", ".kffffk.", "kwffffwk", "kffffffk", "kfkkkkfk", "kffffffk", ".kfffk..", ".kk..kk."],
  ],
  duck: [
    ["..kkkk..", ".kddddk.", "kdwdwddk", "kddddddk", "kddbbddk", ".kddddbk", ".kdddk.b", "..kkkk.."],
    ["..kkkk..", ".kddddk.", "kdwdwddk", "kddddddk", "kddbbddk", ".kddddbk", "..kdddbk", "..kkkk.."],
  ],
  otter: [
    ["..kkkk..", ".kooook.", "kowookok", "kooooook", "kokkkkok", "koooookk", ".kookook", "..kkkk.."],
    ["..kkkk..", ".kooook.", "kowookok", "kooooook", "kokkkkok", "koooookk", ".kooko..", ".kkkkk.."],
  ],
  penguin: [
    ["..kkkk..", ".kppppk.", "kpwppwpk", "kppwwppk", "kpwbwppk", "kpwwwwpk", ".kppppk.", "..kkkk.."],
    ["..kkkk..", ".kppppk.", "kpwppwpk", "kppwwppk", "kpwbwppk", "kpwwwwpk", ".kpppk..", ".kkkkk.."],
  ],
  cat: [
    ["k.kkkk.k", "kgccccgk", "kwcwcwck", "kcccccck", "kcckkcck", "kcccccck", ".kcccck.", "..kkkk.."],
    ["..kkkk..", "kgccccgk", "kwcwcwck", "kcccccck", "kcckkcck", "kcccccck", ".kcccck.", ".kk..kk."],
  ],
  raccoon: [
    ["..kkkk..", ".krrrrk.", "kwrkkrwk", "krkkkkkk", "krkwwrkk", "krrrrrrk", ".krrrrk.", "..kkkk.."],
    ["..kkkk..", ".krrrrk.", "kwrkkrwk", "krkkkkkk", "krkwwrkk", "krrrrrrk", ".krrrk..", ".kkkkk.."],
  ],
  turtle: [
    ["..kkkk..", ".kggggk.", "kwgtggwk", "kggttggk", "kggttggk", "kggggggk", ".kggggk.", "..kkkk.."],
    ["..kkkk..", ".kggggk.", "kwgtggwk", "kggttggk", "kggttggk", "kggggggk", ".kgggk..", ".kkkkk.."],
  ],
  capybara: [
    ["..kkkk..", ".kcccck.", "kwcccwck", "kcccccck", "kcnncnck", "kcccccck", ".kcccck.", "..kkkk.."],
    ["..kkkk..", ".kcccck.", "kwcccwck", "kcccccck", "kcnncnck", "kcccccck", ".kccck..", ".kkkkk.."],
  ],
}

const ANIMAL_COLORS: Record<AnimalId, { a: string; b: string }> = {
  frog: { a: P.frog, b: P.frog2 },
  duck: { a: P.duck, b: P.duck2 },
  otter: { a: P.otter, b: P.otter2 },
  penguin: { a: P.penguin, b: P.penguin2 },
  cat: { a: P.cat, b: P.cat2 },
  raccoon: { a: P.raccoon, b: P.raccoon2 },
  turtle: { a: P.turtle, b: P.turtle2 },
  capybara: { a: P.capy, b: P.capy2 },
};

// letter → role mapping used by all frames:
// k outline, w eye-white, b beak, n nose; species letters → animal colors
function drawFrame(
  ctx: CanvasRenderingContext2D,
  animal: AnimalId,
  frame: 0 | 1,
  x: number,
  y: number,
  scale: number,
): void {
  const rows = FRAMES[animal][frame];
  const colors = ANIMAL_COLORS[animal];
  for (let ry = 0; ry < rows.length; ry++) {
    const row = rows[ry]!;
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx]!;
      if (ch === ".") continue;
      let color: string;
      if (ch === "k") color = P.k;
      else if (ch === "w") color = P.w;
      else if (ch === "b") color = P.beak;
      else if (ch === "n") color = P.pink;
      else if ((ch === "g" || ch === "t") && animal === "turtle") color = colors.b;
      else color = colors.a;
      ctx.fillStyle = color;
      ctx.fillRect(x + rx * scale, y + ry * scale, scale, scale);
    }
  }
}

export function drawAnimal(
  ctx: CanvasRenderingContext2D,
  animal: string,
  hat: string | null,
  x: number,
  y: number,
  scale: number,
  walkFrame: 0 | 1,
  soaked = false,
): void {
  const id = (ANIMAL_COLORS[animal as AnimalId] ? animal : "frog") as AnimalId;
  if (soaked) ctx.globalAlpha = 0.45;
  drawFrame(ctx, id, walkFrame, x, y, scale);
  ctx.globalAlpha = 1;
  if (hat) drawHat(ctx, hat as HatId, x, y, scale);
  if (soaked) {
    // droopy water drops
    ctx.fillStyle = "#41a6f6";
    ctx.fillRect(x + scale, y - scale * 1.5, scale, scale * 1.5);
    ctx.fillRect(x + scale * 5, y - scale * 2, scale, scale * 2);
  }
}

function drawHat(ctx: CanvasRenderingContext2D, hat: HatId, x: number, y: number, s: number): void {
  ctx.fillStyle = P.k;
  switch (hat) {
    case "bucket_hat":
      ctx.fillStyle = "#41a6f6";
      ctx.fillRect(x + s, y - s * 1.2, s * 6, s * 1.2);
      ctx.fillRect(x + s * 2, y - s * 2.2, s * 4, s);
      break;
    case "snorkel":
      ctx.fillStyle = "#ffcd75";
      ctx.fillRect(x + s * 2, y - s * 1.5, s * 4, s * 1.5);
      ctx.fillStyle = P.k;
      ctx.fillRect(x + s * 5.5, y - s * 3, s, s * 2);
      break;
    case "tiny_crown":
      ctx.fillStyle = "#fecd3c";
      ctx.fillRect(x + s * 2, y - s * 1.5, s * 4, s * 1.5);
      ctx.fillRect(x + s * 2, y - s * 2.5, s, s);
      ctx.fillRect(x + s * 3.5, y - s * 2.8, s, s * 1.3);
      ctx.fillRect(x + s * 5, y - s * 2.5, s, s);
      break;
    case "pirate_bandana":
      ctx.fillStyle = "#b13e53";
      ctx.fillRect(x + s, y - s * 1.4, s * 6, s * 1.4);
      ctx.fillRect(x + s * 6.5, y - s * 0.6, s * 1.5, s);
      break;
    case "propeller_cap":
      ctx.fillStyle = "#b13e53";
      ctx.fillRect(x + s * 2, y - s * 1.6, s * 4, s * 1.6);
      ctx.fillStyle = "#38b764";
      ctx.fillRect(x + s * 1.5, y - s * 2.4, s * 5, s * 0.8);
      break;
  }
}

export function drawBalloon(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  fuseTicks: number,
  timeMs: number,
): void {
  // wobble/inflate as fuse runs down
  const t = 1 - fuseTicks / 90;
  const r = 5 + t * 3 + Math.sin(timeMs / 90) * t * 1.5;
  ctx.fillStyle = P.k;
  ctx.beginPath();
  ctx.arc(px, py, r + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = t > 0.75 ? "#e84a5f" : "#41a6f6";
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.w;
  ctx.fillRect(px - r * 0.4, py - r * 0.5, 2, 2);
}

export function drawSplashCell(ctx: CanvasRenderingContext2D, px: number, py: number, age: number, maxAge: number, colorblind: boolean): void {
  const life = 1 - age / maxAge;
  const size = 26 * life + 6;
  ctx.globalAlpha = Math.min(1, life * 1.4);
  ctx.fillStyle = colorblind ? "#fecd3c" : "#41a6f6";
  ctx.fillRect(px - size / 2, py - 4, size, 8);
  ctx.fillRect(px - 4, py - size / 2, 8, size);
  ctx.globalAlpha = 1;
}

export function drawPowerupIcon(ctx: CanvasRenderingContext2D, type: string, px: number, py: number, timeMs: number): void {
  const bob = Math.sin(timeMs / 200) * 2;
  ctx.fillStyle = P.k;
  ctx.fillRect(px - 6, py - 6 + bob, 13, 13);
  ctx.fillStyle = "#29366f";
  ctx.fillRect(px - 5, py - 5 + bob, 11, 11);
  ctx.fillStyle = P.w;
  switch (type) {
    case "balloon":
      ctx.fillRect(px - 2, py - 3 + bob, 5, 6);
      ctx.fillRect(px - 1, py + 3 + bob, 2, 2);
      break;
    case "range":
      ctx.fillRect(px - 4, py - 1 + bob, 9, 2);
      ctx.fillRect(px - 1, py - 4 + bob, 2, 9);
      break;
    case "speed":
      ctx.fillRect(px - 3, py - 3 + bob, 3, 2);
      ctx.fillRect(px - 1, py - 1 + bob, 3, 2);
      ctx.fillRect(px - 3, py + 1 + bob, 3, 2);
      break;
    case "boots":
      ctx.fillRect(px - 4, py - 2 + bob, 3, 5);
      ctx.fillRect(px + 1, py - 2 + bob, 3, 5);
      break;
  }
}
