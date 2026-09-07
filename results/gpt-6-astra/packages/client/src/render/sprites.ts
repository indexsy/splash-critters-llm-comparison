import {
  CONFIG,
  Tile,
  duckPosition,
  type Animal,
  type GameState,
  type Hat,
  type PowerupKind,
  type Theme,
} from "@splash/shared";

const INK = "#253e3b";
const rect = (
  c: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), w, h);
};
const bodies: Record<Animal, string[]> = {
  frog: [
    "................",
    "...##....##.....",
    "..#gg#..#gg#....",
    "..#gw####wg#....",
    "..#gkggggkg#....",
    ".##gggggggg##...",
    ".#gggggggggg#...",
    ".#gggggggggg#...",
    "..#gccccccg#....",
    "..#gcmmmccg#....",
    "...#gccccg#.....",
    "..#gggggggg#....",
    "..#gg#..#gg#....",
    "...##....##.....",
    "................",
    "................",
  ],
  duck: [
    "................",
    ".....####.......",
    "....#gggg#......",
    "...#gggggg#.....",
    "...#ggkwgg#.....",
    "...#ggggooo#....",
    "....#ggoooo#....",
    "..###gggg##.....",
    ".#ggggggggg#....",
    ".#gggcggggg#....",
    "..#ggccggg#.....",
    "...#ggggg#......",
    "....#ooo#.......",
    "...oo..oo.......",
    "................",
    "................",
  ],
  otter: [
    "................",
    "...##....##.....",
    "..#gg####gg#....",
    "..#gggggggg#....",
    "..#gkwggwkg#....",
    "..#ggccccgg#....",
    "...#cckkcc#.....",
    "....#cmmc#......",
    "...#ggccgg#.....",
    "..#ggccccgg#....",
    "..#ggccccgg#....",
    "...#gccccg#.....",
    "...#gggggg#.....",
    "...##...###.....",
    "................",
    "................",
  ],
  penguin: [
    "................",
    ".....####.......",
    "....#gggg#......",
    "...#gggggg#.....",
    "...#gwggwg#.....",
    "...#wkwwkw#.....",
    "...#wwoo ww#....",
    "..#ggwwwwgg#....",
    ".#ggwwwwwwgg#...",
    ".#ggwwwwwwgg#...",
    "..#gwwwwwwg#....",
    "...#wwwwww#.....",
    "....#gggg#......",
    "...oo....oo.....",
    "................",
    "................",
  ],
  cat: [
    "................",
    "..##......##....",
    "..#g#....#g#....",
    "..#gg####gg#....",
    "..#gggggggg#....",
    "..#gkwggwkg#....",
    ".##gggppggg##...",
    "..#gcmmmmcg#....",
    "...#ggccgg#.....",
    "..#gggcccgg#....",
    "..#gggcccgg#..#.",
    "...#gggggg#..g#.",
    "...#gggggg###g#.",
    "....##..##......",
    "................",
    "................",
  ],
  raccoon: [
    "................",
    "...##....##.....",
    "..#gg####gg#....",
    "..#gggggggg#....",
    "..#kkkkkkkk#....",
    "..#kwkggkwk#....",
    "...#gccccg#.....",
    "....#ckkc#......",
    "...#ggccgg#.....",
    "..#ggccccgg#....",
    "..#ggccccgg#....",
    "...#gccccg#.##..",
    "...#gggggg#kg#..",
    "...##....###g#..",
    "................",
    "................",
  ],
  turtle: [
    "................",
    ".....####.......",
    "....#gggg#......",
    "....#kw wk#.....",
    "....#gggg#......",
    "...##gmmg##.....",
    "..#ggccccgg#....",
    ".#ggcckkccgg#...",
    ".#gcckcckccg#...",
    ".#gcckcckccg#...",
    "..#gcckkccg#....",
    "..#ggccccgg#....",
    "...#gg##gg#.....",
    "....##..##......",
    "................",
    "................",
  ],
  capybara: [
    "................",
    "...##.....##....",
    "..#gg#####gg#...",
    "..#ggggggggg#...",
    "..#ggggggggg#...",
    "..#gkgggggkg#...",
    "..#gggcccccc#...",
    "..#gggckkkcc#...",
    "...#ggcmmccc#...",
    "...#ggggggg#....",
    "..#ggggggggg#...",
    "..#ggggggggg#...",
    "...#gg#.#gg#....",
    "....##...##.....",
    "................",
    "................",
  ],
};
export function drawAnimal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  animal: Animal,
  hat: Hat = "none",
  frame = 0,
  scale = 1,
  soaked = false,
): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  const color = CONFIG.ANIMALS.find((a) => a.id === animal)!.color;
  const palette: Record<string, string> = {
    "#": INK,
    g: soaked ? "#75b5ce" : color,
    w: "#fffce8",
    k: "#263a36",
    c: animal === "turtle" ? "#c3b667" : "#f5deb0",
    m: "#6f6852",
    p: "#e78381",
    o: "#ed9c40",
  };
  rect(ctx, "#1d53422b", 3, 13, 10, 2);
  const pattern = bodies[animal];
  const bounce = frame % 2;
  for (let py = 0; py < pattern.length; py++)
    for (let px = 0; px < pattern[py].length; px++) {
      const value = palette[pattern[py][px]];
      if (value) rect(ctx, value, px, py - (py < 12 ? bounce : 0), 1, 1);
    }
  if (frame % 2) {
    rect(ctx, INK, 3, 14, 3, 1);
    rect(ctx, INK, 10, 13, 3, 1);
  }
  if (hat === "bucket") {
    rect(ctx, INK, 3, 0, 10, 4);
    rect(ctx, "#77c6d1", 4, 0, 8, 3);
    rect(ctx, INK, 2, 3, 12, 2);
    rect(ctx, "#93e1dc", 3, 3, 10, 1);
  }
  if (hat === "crown") {
    rect(ctx, INK, 4, -1, 9, 4);
    rect(ctx, "#ffd36e", 5, -2, 1, 3);
    rect(ctx, "#ffd36e", 8, -3, 1, 4);
    rect(ctx, "#ffd36e", 11, -2, 1, 3);
    rect(ctx, "#ffd36e", 5, 0, 7, 2);
    rect(ctx, "#f28678", 8, 0, 1, 1);
  }
  if (hat === "bandana") {
    rect(ctx, "#ce6664", 3, 1, 10, 2);
    rect(ctx, "#fff5d4", 7, 1, 2, 1);
    rect(ctx, "#ce6664", 12, 3, 3, 3);
  }
  if (hat === "propeller") {
    rect(ctx, "#f48670", 4, 0, 5, 2);
    rect(ctx, "#77c6d1", 9, 0, 4, 2);
    rect(ctx, INK, 8, -3, 1, 3);
    rect(ctx, "#f4c455", bounce ? 5 : 7, -3, bounce ? 7 : 3, 1);
  }
  if (hat === "snorkel") {
    rect(ctx, INK, 3, 4, 10, 3);
    rect(ctx, "#9ae7e5", 4, 4, 8, 2);
    rect(ctx, "#f4c455", 13, 0, 2, 7);
    rect(ctx, "#f4c455", 12, 6, 2, 2);
  }
  ctx.restore();
}
const portraits = new Map<string, string>();
export function animalDataUrl(animal: Animal, hat: Hat = "none"): string {
  const key = `${animal}:${hat}`;
  const cached = portraits.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 24;
  drawAnimal(canvas.getContext("2d")!, 4, 6, animal, hat);
  const url = canvas.toDataURL();
  portraits.set(key, url);
  return url;
}
function castle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  rect(ctx, "#73775455", x + 2, y + 13, 13, 3);
  rect(ctx, "#846b48", x + 1, y + 7, 14, 8);
  rect(ctx, "#e9bf73", x + 2, y + 5, 12, 9);
  rect(ctx, "#f8d995", x + 3, y + 4, 3, 4);
  rect(ctx, "#f8d995", x + 10, y + 4, 3, 4);
  rect(ctx, "#f8d995", x + 6, y + 6, 4, 3);
  rect(ctx, "#bf934f", x + 7, y + 10, 3, 4);
  rect(ctx, "#ffeba9", x + 2, y + 8, 11, 1);
  rect(ctx, "#735e45", x + 8, y, 1, 5);
  rect(ctx, "#f28678", x + 9, y, 4, 3);
  rect(ctx, "#c69b55", x + 3, y + 11, 2, 1);
}
function rock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  theme: Theme,
): void {
  if (theme === "pool") {
    rect(ctx, "#4f8e99", x + 1, y + 1, 14, 14);
    rect(ctx, "#c3e3d9", x + 2, y + 1, 12, 11);
    rect(ctx, "#f1f7df", x + 3, y + 2, 10, 2);
    rect(ctx, "#9cbfba", x + 5, y + 5, 7, 4);
    return;
  }
  rect(ctx, "#61736b", x + 2, y + 5, 13, 10);
  rect(ctx, "#61736b", x + 4, y + 2, 8, 3);
  rect(ctx, "#93a596", x + 3, y + 5, 11, 7);
  rect(ctx, "#aebdaf", x + 4, y + 3, 8, 5);
  rect(ctx, "#c4cdb7", x + 5, y + 3, 6, 2);
  rect(ctx, "#7b9281", x + 10, y + 8, 3, 4);
  rect(ctx, "#576f50", x, y + 13, 5, 2);
}
function water(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
  colorblind = false,
): void {
  rect(ctx, colorblind ? "#837cd8" : "#58b4d9", x, y, 16, 16);
  const phase = Math.floor(time / 200 + x / 16 + y / 16) % 4;
  rect(ctx, colorblind ? "#d4cdf6" : "#ade7e8", x + 2 + phase, y + 4, 5, 1);
  rect(ctx, colorblind ? "#d4cdf6" : "#91d7e5", x + 7 - phase, y + 11, 6, 1);
}
export function drawPowerup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: PowerupKind,
  time = 0,
): void {
  const bob = Math.floor(Math.sin(time / 180) * 1);
  y += bob;
  rect(ctx, INK, x + 2, y + 2, 12, 12);
  rect(ctx, "#ffe49b", x + 3, y + 3, 10, 10);
  rect(ctx, "#fff5cb", x + 4, y + 4, 8, 8);
  if (kind === "balloon") {
    rect(ctx, "#e88780", x + 6, y + 5, 5, 5);
    rect(ctx, "#fff9e9", x + 7, y + 5, 1, 2);
    rect(ctx, INK, x + 8, y + 10, 1, 2);
  }
  if (kind === "range") {
    rect(ctx, "#398ec4", x + 7, y + 4, 3, 9);
    rect(ctx, "#398ec4", x + 4, y + 7, 9, 3);
    rect(ctx, "#a1e7ed", x + 7, y + 7, 3, 3);
  }
  if (kind === "speed") {
    rect(ctx, "#52a98c", x + 5, y + 5, 2, 6);
    rect(ctx, "#52a98c", x + 9, y + 5, 2, 6);
    rect(ctx, "#367e6f", x + 4, y + 10, 4, 2);
    rect(ctx, "#367e6f", x + 9, y + 10, 4, 2);
  }
  if (kind === "kick") {
    rect(ctx, "#bf843f", x + 5, y + 5, 3, 6);
    rect(ctx, "#bf843f", x + 9, y + 5, 3, 6);
    rect(ctx, "#e9ad47", x + 4, y + 9, 4, 3);
    rect(ctx, "#e9ad47", x + 9, y + 9, 4, 3);
  }
}
function drawBalloon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
  progress: number,
  color = "#ee91a2",
): void {
  const pulse =
    progress > 0.66 ? Math.floor(time / 90) % 2 : Math.floor(time / 300) % 2;
  rect(ctx, "#294b4833", x + 3, y + 13, 11, 2);
  rect(ctx, INK, x + 4 - pulse, y + 2, 8 + pulse * 2, 11);
  rect(ctx, INK, x + 2, y + 5, 12, 6);
  rect(ctx, color, x + 4 - pulse, y + 3, 8 + pulse * 2, 8);
  rect(ctx, color, x + 3, y + 5, 10, 5);
  rect(ctx, "#fff5df", x + 5, y + 4, 2, 3);
  rect(ctx, "#cc677f", x + 9, y + 9, 2, 2);
  rect(ctx, INK, x + 7, y + 13, 3, 2);
}
export function drawArena(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  theme: Theme,
  localId: string,
  time: number,
  options: { colorblind?: boolean; reducedShake?: boolean } = {},
): void {
  const ox = (256 - state.width * 16) / 2;
  const oy = (224 - state.height * 16) / 2;
  rect(
    ctx,
    theme === "beach" ? "#d4b778" : theme === "pool" ? "#78afad" : "#7b9c70",
    0,
    0,
    256,
    224,
  );
  ctx.save();
  ctx.translate(ox, oy);
  for (let y = 0; y < state.height; y++)
    for (let x = 0; x < state.width; x++) {
      const px = x * 16;
      const py = y * 16;
      const tile = state.tiles[y * state.width + x];
      const shade = (x + y) % 2;
      rect(
        ctx,
        theme === "beach"
          ? shade
            ? "#edce8f"
            : "#f1d79c"
          : theme === "pool"
            ? shade
              ? "#b2dacf"
              : "#baddd4"
            : shade
              ? "#b5cb89"
              : "#bdd28f",
        px,
        py,
        16,
        16,
      );
      const noise = ((x * 313 + y * 757 + state.mapSeed) >>> 0) % 11;
      if (theme === "pool") {
        rect(ctx, "#9fc9be", px, py, 16, 1);
        rect(ctx, "#9fc9be", px, py, 1, 16);
      } else {
        rect(
          ctx,
          theme === "beach" ? "#d5b57d" : "#96b777",
          px + noise + 2,
          py + 9,
          2,
          1,
        );
        if (noise < 3) rect(ctx, "#e8e5b1", px + 5, py + 4, 1, 1);
      }
      if (tile === Tile.Boulder) rock(ctx, px, py, theme);
      if (tile === Tile.Castle) castle(ctx, px, py);
      if (tile === Tile.Flood) water(ctx, px, py, time, options.colorblind);
    }
  for (const p of state.powerups)
    drawPowerup(ctx, p.x * 16, p.y * 16, p.kind, time);
  for (const b of state.balloons)
    drawBalloon(
      ctx,
      b.x * 16,
      b.y * 16,
      time,
      1 - (b.burstTick - state.tick) / CONFIG.FUSE_TICKS,
      b.revenge ? "#ffc75f" : "#f1a2b1",
    );
  for (const s of state.splashes) {
    const x = s.x * 16;
    const y = s.y * 16;
    const shrink = s.expiresTick - state.tick < 3 ? 2 : 0;
    rect(
      ctx,
      options.colorblind ? "#9990ea" : "#55b9e3",
      x + shrink,
      y + 4,
      16 - shrink * 2,
      8,
    );
    rect(
      ctx,
      options.colorblind ? "#b4a8f3" : "#8ee6ed",
      x + 4,
      y + shrink,
      8,
      16 - shrink * 2,
    );
    rect(ctx, "#f1ffeb", x + 6, y + 6, 4, 4);
    rect(ctx, "#d0fff4", x + 1 + (Math.floor(time / 50) % 3), y + 2, 2, 2);
  }
  for (const p of state.players) {
    if (!p.alive) {
      if (state.revengeEnabled) {
        const d = duckPosition(state, p.duckPos);
        drawAnimal(
          ctx,
          d.x * 16 - 8,
          d.y * 16 - 7,
          "duck",
          "none",
          Math.floor(time / 200) % 2,
          1,
          false,
        );
      }
      continue;
    }
    const px = p.x * 16 - 8;
    const py = p.y * 16 - 9;
    drawAnimal(
      ctx,
      px,
      py,
      p.animal,
      p.hat,
      Math.floor(time / 160 + p.slot) % 2,
    );
    rect(
      ctx,
      ["#efffcd", "#f99083", "#aab3ff", "#ffd96e"][p.slot],
      px + 4,
      py + 15,
      8,
      1,
    );
    if (p.id === localId) {
      rect(ctx, INK, px + 6, py - 5, 5, 2);
      rect(ctx, "#fff9e9", px + 7, py - 5, 3, 1);
      rect(ctx, INK, px + 7, py - 3, 3, 1);
      rect(ctx, INK, px + 8, py - 2, 1, 1);
    }
  }
  ctx.restore();
}
function palm(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  rect(ctx, "#7e7650", x + 14, y + 18, 5, 29);
  rect(ctx, "#ba9460", x + 13, y + 18, 3, 28);
  for (let i = 0; i < 4; i++)
    rect(ctx, "#726b48", x + 14, y + 24 + i * 6, 4, 1);
  rect(ctx, "#487d58", x + 1, y + 12, 30, 7);
  rect(ctx, "#487d58", x + 7, y + 5, 19, 7);
  rect(ctx, "#487d58", x - 3, y + 18, 12, 6);
  rect(ctx, "#487d58", x + 27, y + 17, 9, 7);
  rect(ctx, "#76a966", x + 2, y + 12, 12, 3);
  rect(ctx, "#86b86a", x + 8, y + 6, 9, 6);
  rect(ctx, "#699956", x + 19, y + 11, 11, 5);
  rect(ctx, "#9fbf69", x + 12, y + 1, 5, 6);
  rect(ctx, "#a68b59", x + 12, y + 18, 7, 5);
}
export function drawMenuScene(
  ctx: CanvasRenderingContext2D,
  time: number,
): void {
  ctx.clearRect(0, 0, 256, 224);
  const wave = Math.floor(time / 300) % 3;
  rect(ctx, "#d8ece0", 9, 34, 238, 170);
  rect(ctx, "#d8ece0", 22, 20, 211, 195);
  rect(ctx, "#76c8d3", 16, 43, 224, 153);
  rect(ctx, "#76c8d3", 29, 30, 198, 177);
  for (let y = 36; y < 205; y += 16)
    for (let x = 20; x < 239; x += 23)
      if ((x + y) % 3)
        rect(ctx, "#ade3db", x + wave * 2, y + ((x * 3) % 7), 7, 1);
  rect(ctx, "#4b94a8", 42, 68, 179, 123);
  rect(ctx, "#4b94a8", 53, 57, 157, 145);
  rect(ctx, "#eed69e", 36, 56, 181, 124);
  rect(ctx, "#eed69e", 48, 43, 156, 149);
  rect(ctx, "#fff0bc", 41, 55, 169, 121);
  rect(ctx, "#fff0bc", 49, 47, 152, 137);
  rect(ctx, "#aac986", 51, 67, 145, 102);
  rect(ctx, "#b6d492", 56, 60, 133, 115);
  for (let y = 66; y < 173; y += 16)
    for (let x = 57; x < 191; x += 16) {
      if ((x + y) % 3 === 0) rect(ctx, "#9bbd7c", x, y + 7, 3, 2);
      if ((x * y) % 7 === 0) {
        rect(ctx, "#f4edb8", x + 5, y + 5, 3, 3);
        rect(ctx, "#f1b272", x + 6, y + 6, 1, 1);
      }
    }
  for (const [x, y] of [
    [94, 91],
    [142, 91],
    [94, 139],
    [142, 139],
  ])
    rock(ctx, x, y, "backyard");
  for (const [x, y] of [
    [77, 91],
    [126, 74],
    [126, 122],
    [174, 123],
    [110, 155],
  ])
    castle(ctx, x, y);
  drawBalloon(ctx, 111, 106, time, (time % 3000) / 3000);
  drawBalloon(ctx, 160, 75, time + 300, 0.5, "#91c5f2");
  const splashPhase = time % 4000;
  if (splashPhase > 3000) {
    const size = splashPhase < 3800 ? 30 : 16;
    rect(ctx, "#5bbce0", 64 - size / 2, 134, size, 9);
    rect(ctx, "#8be0e6", 59, 138 - size / 2, 10, size);
    rect(ctx, "#effff1", 62, 136, 5, 5);
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const r = (splashPhase - 3000) / 35;
      rect(
        ctx,
        "#eefde9",
        64 + Math.cos(angle) * r,
        138 + Math.sin(angle) * r,
        2,
        3,
      );
    }
  }
  drawAnimal(
    ctx,
    57 + Math.floor(Math.sin(time / 1100) * 4),
    72,
    "frog",
    "none",
    Math.floor(time / 210) % 2,
    1.6,
  );
  drawAnimal(
    ctx,
    155,
    138 + Math.floor(Math.sin(time / 900) * 3),
    "duck",
    "bucket",
    Math.floor(time / 250) % 2,
    1.7,
  );
  drawAnimal(ctx, 166, 55, "cat", "none", Math.floor(time / 300) % 2, 1.25);
  drawAnimal(ctx, 82, 153, "otter", "snorkel", Math.floor(time / 300) % 2, 1.2);
  palm(ctx, 21, 17);
  palm(ctx, 191, 107);
  // A striped parasol and towel frame the little battle island.
  rect(ctx, "#8c916d", 182, 37, 2, 29);
  rect(ctx, "#f28879", 169, 25, 27, 8);
  rect(ctx, "#f28879", 175, 20, 15, 5);
  rect(ctx, "#ffe1a8", 181, 20, 5, 13);
  rect(ctx, "#f8b69c", 171, 27, 8, 5);
  rect(ctx, "#df746c", 168, 32, 29, 3);
  rect(ctx, "#e99180", 41, 152, 8, 22);
  rect(ctx, "#ffe7b5", 41, 157, 8, 2);
  rect(ctx, "#ffe7b5", 41, 168, 8, 2);
  drawAnimal(
    ctx,
    206,
    61 + Math.floor(Math.sin(time / 650) * 2),
    "duck",
    "none",
    0,
  );
  rect(ctx, "#fcf6d5", 23, 128, 10, 1);
  rect(ctx, "#fcf6d5", 27, 124, 1, 9);
  rect(ctx, "#fcf6d5", 211, 181, 12, 1);
  rect(ctx, "#fcf6d5", 216, 176, 1, 10);
  rect(ctx, "#ecac90", 114, 188, 6, 4);
  rect(ctx, "#fff0c1", 114, 188, 1, 3);
}
