import type { GeneratedMap } from '@shared/map.js';
import type {
  Animal,
  Hat,
  Direction,
  PlayerState,
  Balloon,
  Splash,
  Tile,
  PowerUpType,
} from '@shared/types.js';

// NES-ish limited palette
export const PALETTE = {
  black: '#101010',
  darkGray: '#505050',
  midGray: '#808080',
  lightGray: '#A0A0A0',
  white: '#F8F8F8',
  red: '#D83030',
  orange: '#F8A030',
  yellow: '#F8D800',
  green: '#48B048',
  darkGreen: '#286820',
  teal: '#30C0A0',
  blue: '#3060D8',
  skyBlue: '#70C8FF',
  waterBlue: '#2080D0',
  purple: '#9040C0',
  pink: '#F880B0',
  brown: '#885828',
  sand: '#D8B060',
  beige: '#F0D0A0',
  skin: '#F8C0A0',
  darkBlue: '#1830A0',
  gold: '#E8C820',
  silver: '#B0B0C0',
} as const;

const TILE = 16;
const HALF = 8;

// Player colors (for balloons, splashes, etc.)
export const PLAYER_COLORS = [
  PALETTE.red,
  PALETTE.blue,
  PALETTE.green,
  PALETTE.yellow,
] as const;

export class SpriteRenderer {
  private tick = 0;
  private theme: 'backyard' | 'beach' | 'pool' = 'backyard';
  private tileSize = TILE;

  setTick(t: number): void {
    this.tick = t;
  }

  setTheme(t: 'backyard' | 'beach' | 'pool'): void {
    this.theme = t;
  }

  setTileSize(s: number): void {
    this.tileSize = s;
  }

  // ============================================================
  // Tile / Background
  // ============================================================
  drawMap(ctx: CanvasRenderingContext2D, map: GeneratedMap, offsetX: number, offsetY: number): void {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.grid[y][x];
        const px = offsetX + x * this.tileSize;
        const py = offsetY + y * this.tileSize;
        this.drawTile(ctx, tile, px, py, x, y);
      }
    }
  }

  private drawTile(
    ctx: CanvasRenderingContext2D,
    tile: Tile,
    px: number,
    py: number,
    tx: number,
    ty: number
  ): void {
    switch (tile) {
      case 'boulder':
        this.drawBoulder(ctx, px, py);
        break;
      case 'sandcastle':
        this.drawSandcastle(ctx, px, py, tx, ty);
        break;
      case 'powerup':
        // Drawn separately
        break;
      case 'water':
        this.drawWater(ctx, px, py, tx, ty);
        break;
      case 'empty':
      default:
        this.drawGround(ctx, px, py, tx, ty);
        break;
    }
  }

  private drawGround(ctx: CanvasRenderingContext2D, px: number, py: number, tx: number, ty: number): void {
    ctx.fillStyle = this.groundColor();
    ctx.fillRect(px, py, this.tileSize, this.tileSize);

    // Add subtle texture
    if ((tx + ty) % 2 === 0) {
      ctx.fillStyle = this.groundAltColor();
      ctx.fillRect(px + 4, py + 4, 2, 2);
    }

    // Theme details
    if (this.theme === 'backyard') {
      // Tiny grass blades
      if ((tx * 7 + ty * 13) % 5 === 0) {
        ctx.fillStyle = PALETTE.darkGreen;
        ctx.fillRect(px + 2, py + 14, 2, 2);
      }
    } else if (this.theme === 'beach') {
      // Tiny shells / pebbles
      if ((tx * 3 + ty * 11) % 7 === 0) {
        ctx.fillStyle = PALETTE.beige;
        ctx.fillRect(px + 12, py + 12, 2, 2);
      }
    } else if (this.theme === 'pool') {
      // Tile lines
      ctx.fillStyle = PALETTE.darkBlue;
      ctx.fillRect(px + 15, py, 1, 16);
      ctx.fillRect(px, py + 15, 16, 1);
    }
  }

  private groundColor(): string {
    switch (this.theme) {
      case 'backyard':
        return PALETTE.green;
      case 'beach':
        return PALETTE.sand;
      case 'pool':
        return PALETTE.blue;
      default:
        return PALETTE.green;
    }
  }

  private groundAltColor(): string {
    switch (this.theme) {
      case 'backyard':
        return PALETTE.darkGreen;
      case 'beach':
        return PALETTE.beige;
      case 'pool':
        return PALETTE.darkBlue;
      default:
        return PALETTE.darkGreen;
    }
  }

  private drawBoulder(ctx: CanvasRenderingContext2D, px: number, py: number): void {
    ctx.fillStyle = PALETTE.darkGray;
    ctx.fillRect(px + 1, py + 1, 14, 14);
    ctx.fillStyle = PALETTE.lightGray;
    ctx.fillRect(px + 2, py + 2, 6, 6);
    ctx.fillRect(px + 9, py + 9, 4, 4);
    ctx.fillStyle = PALETTE.midGray;
    ctx.fillRect(px + 3, py + 8, 4, 2);
    ctx.fillRect(px + 10, py + 3, 2, 4);
  }

  private drawSandcastle(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    _tx: number,
    _ty: number
  ): void {
    ctx.fillStyle = this.groundColor();
    ctx.fillRect(px, py, this.tileSize, this.tileSize);

    // Castle block
    ctx.fillStyle = PALETTE.beige;
    ctx.fillRect(px + 2, py + 4, 12, 10);
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(px + 3, py + 5, 10, 8);
    // Crenellations
    ctx.fillStyle = PALETTE.beige;
    ctx.fillRect(px + 2, py + 2, 3, 3);
    ctx.fillRect(px + 7, py + 2, 3, 3);
    ctx.fillRect(px + 11, py + 2, 3, 3);
    // Door
    ctx.fillStyle = PALETTE.brown;
    ctx.fillRect(px + 6, py + 10, 4, 4);
  }

  private drawWater(ctx: CanvasRenderingContext2D, px: number, py: number, tx: number, ty: number): void {
    const shimmer = Math.sin(this.tick * 0.1 + tx * 0.5 + ty * 0.3) > 0;
    ctx.fillStyle = shimmer ? PALETTE.waterBlue : PALETTE.blue;
    ctx.fillRect(px, py, this.tileSize, this.tileSize);
    // Wave line
    const waveY = Math.floor((this.tick + tx * 3) % 16);
    ctx.fillStyle = PALETTE.skyBlue;
    ctx.fillRect(px, py + waveY, 16, 1);
  }

  // ============================================================
  // Animals (8×8 pixel art, centered in 16×16 tile)
  // ============================================================
  drawPlayer(
    ctx: CanvasRenderingContext2D,
    player: PlayerState,
    offsetX: number,
    offsetY: number,
    colorblindMode: boolean,
    hat?: Hat
  ): void {
    const px = offsetX + player.x * this.tileSize + HALF - 4;
    const py = offsetY + player.y * this.tileSize + HALF - 4;

    if (!player.alive) {
      this.drawDeadPlayer(ctx, px, py, player);
      return;
    }

    const walkFrame = Math.floor(this.tick / 8) % 2;
    const dir = player.direction || 'down';

    // Draw animal body
    this.drawAnimal(ctx, player.animal, px, py, walkFrame, dir, colorblindMode);

    // Draw hat on top
    if (hat && hat !== 'none') {
      this.drawHat(ctx, hat, px, py, dir);
    }
  }

  private drawAnimal(
    ctx: CanvasRenderingContext2D,
    animal: Animal,
    px: number,
    py: number,
    walkFrame: number,
    dir: Direction,
    _colorblindMode: boolean
  ): void {
    const colors = this.getAnimalColors(animal, _colorblindMode);
    const bodyColor = colors.body;
    const bellyColor = colors.belly;
    const eyeColor = PALETTE.black;
    const legOffset = walkFrame === 0 ? 0 : 1;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(px + 1, py + 13, 6, 2);

    switch (animal) {
      case 'frog':
        this.drawFrog(ctx, px, py, bodyColor, bellyColor, eyeColor, legOffset, dir);
        break;
      case 'duck':
        this.drawDuck(ctx, px, py, bodyColor, bellyColor, eyeColor, legOffset, dir);
        break;
      case 'otter':
        this.drawOtter(ctx, px, py, bodyColor, bellyColor, eyeColor, legOffset, dir);
        break;
      case 'penguin':
        this.drawPenguin(ctx, px, py, bodyColor, bellyColor, eyeColor, legOffset, dir);
        break;
      case 'cat':
        this.drawCat(ctx, px, py, bodyColor, bellyColor, eyeColor, legOffset, dir);
        break;
      case 'raccoon':
        this.drawRaccoon(ctx, px, py, bodyColor, bellyColor, eyeColor, legOffset, dir);
        break;
      case 'turtle':
        this.drawTurtle(ctx, px, py, bodyColor, bellyColor, eyeColor, legOffset, dir);
        break;
      case 'capybara':
        this.drawCapybara(ctx, px, py, bodyColor, bellyColor, eyeColor, legOffset, dir);
        break;
    }
  }

  private getAnimalColors(animal: Animal, colorblindMode: boolean): { body: string; belly: string } {
    if (colorblindMode) {
      // Use high-contrast patterns for colorblind mode
      switch (animal) {
        case 'frog':
          return { body: PALETTE.green, belly: PALETTE.yellow };
        case 'duck':
          return { body: PALETTE.yellow, belly: PALETTE.beige };
        case 'otter':
          return { body: PALETTE.brown, belly: PALETTE.beige };
        case 'penguin':
          return { body: PALETTE.darkGray, belly: PALETTE.white };
        case 'cat':
          return { body: PALETTE.orange, belly: PALETTE.beige };
        case 'raccoon':
          return { body: PALETTE.darkGray, belly: PALETTE.lightGray };
        case 'turtle':
          return { body: PALETTE.darkGreen, belly: PALETTE.green };
        case 'capybara':
          return { body: PALETTE.brown, belly: PALETTE.beige };
      }
    }
    switch (animal) {
      case 'frog':
        return { body: PALETTE.green, belly: PALETTE.teal };
      case 'duck':
        return { body: PALETTE.yellow, belly: PALETTE.beige };
      case 'otter':
        return { body: PALETTE.brown, belly: PALETTE.beige };
      case 'penguin':
        return { body: PALETTE.darkGray, belly: PALETTE.white };
      case 'cat':
        return { body: PALETTE.orange, belly: PALETTE.beige };
      case 'raccoon':
        return { body: PALETTE.darkGray, belly: PALETTE.lightGray };
      case 'turtle':
        return { body: PALETTE.darkGreen, belly: PALETTE.green };
      case 'capybara':
        return { body: PALETTE.brown, belly: PALETTE.beige };
    }
  }

  // Frog: 8x8
  private drawFrog(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    body: string,
    belly: string,
    eye: string,
    legOff: number,
    _dir: Direction
  ): void {
    ctx.fillStyle = body;
    ctx.fillRect(px + 1, py + 2, 6, 5);
    ctx.fillRect(px + 0, py + 3, 1, 3);
    ctx.fillRect(px + 7, py + 3, 1, 3);
    // Eyes
    ctx.fillStyle = eye;
    ctx.fillRect(px + 2, py + 1, 1, 1);
    ctx.fillRect(px + 5, py + 1, 1, 1);
    // Belly
    ctx.fillStyle = belly;
    ctx.fillRect(px + 2, py + 4, 4, 2);
    // Legs
    ctx.fillStyle = body;
    ctx.fillRect(px + 1 + legOff, py + 7, 2, 1);
    ctx.fillRect(px + 5 - legOff, py + 7, 2, 1);
  }

  // Duck: 8x8
  private drawDuck(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    body: string,
    belly: string,
    eye: string,
    legOff: number,
    dir: Direction
  ): void {
    ctx.fillStyle = body;
    ctx.fillRect(px + 1, py + 2, 6, 5);
    // Beak
    ctx.fillStyle = PALETTE.orange;
    if (dir === 'right') {
      ctx.fillRect(px + 7, py + 3, 2, 2);
    } else if (dir === 'left') {
      ctx.fillRect(px - 1, py + 3, 2, 2);
    } else {
      ctx.fillRect(px + 3, py + 1, 2, 1);
    }
    // Eye
    ctx.fillStyle = eye;
    const eyeX = dir === 'left' ? 2 : dir === 'right' ? 5 : 2;
    ctx.fillRect(px + eyeX, py + 2, 1, 1);
    if (dir === 'up' || dir === 'down') {
      ctx.fillRect(px + 5, py + 2, 1, 1);
    }
    // Belly
    ctx.fillStyle = belly;
    ctx.fillRect(px + 2, py + 4, 4, 2);
    // Legs
    ctx.fillStyle = PALETTE.orange;
    ctx.fillRect(px + 2 + legOff, py + 7, 2, 1);
    ctx.fillRect(px + 5 - legOff, py + 7, 2, 1);
  }

  // Otter: 8x8
  private drawOtter(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    body: string,
    belly: string,
    eye: string,
    legOff: number,
    _dir: Direction
  ): void {
    ctx.fillStyle = body;
    ctx.fillRect(px + 1, py + 2, 6, 5);
    // Head
    ctx.fillRect(px + 2, py + 1, 4, 1);
    // Eyes
    ctx.fillStyle = eye;
    ctx.fillRect(px + 2, py + 2, 1, 1);
    ctx.fillRect(px + 5, py + 2, 1, 1);
    // Nose
    ctx.fillStyle = PALETTE.pink;
    ctx.fillRect(px + 3, py + 3, 2, 1);
    // Belly
    ctx.fillStyle = belly;
    ctx.fillRect(px + 2, py + 4, 4, 2);
    // Tail
    ctx.fillStyle = body;
    ctx.fillRect(px + 7, py + 4, 2, 2);
    // Legs
    ctx.fillRect(px + 1 + legOff, py + 7, 2, 1);
    ctx.fillRect(px + 5 - legOff, py + 7, 2, 1);
  }

  // Penguin: 8x8
  private drawPenguin(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    body: string,
    belly: string,
    eye: string,
    legOff: number,
    _dir: Direction
  ): void {
    ctx.fillStyle = body;
    ctx.fillRect(px + 1, py + 1, 6, 6);
    // Belly
    ctx.fillStyle = belly;
    ctx.fillRect(px + 2, py + 3, 4, 4);
    // Eyes
    ctx.fillStyle = eye;
    ctx.fillRect(px + 2, py + 2, 1, 1);
    ctx.fillRect(px + 5, py + 2, 1, 1);
    // Beak
    ctx.fillStyle = PALETTE.orange;
    ctx.fillRect(px + 3, py + 3, 2, 1);
    // Feet
    ctx.fillStyle = PALETTE.orange;
    ctx.fillRect(px + 1 + legOff, py + 7, 2, 1);
    ctx.fillRect(px + 5 - legOff, py + 7, 2, 1);
  }

  // Cat: 8x8
  private drawCat(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    body: string,
    belly: string,
    eye: string,
    legOff: number,
    dir: Direction
  ): void {
    ctx.fillStyle = body;
    ctx.fillRect(px + 1, py + 2, 6, 5);
    // Ears
    ctx.fillRect(px + 1, py + 0, 2, 2);
    ctx.fillRect(px + 5, py + 0, 2, 2);
    // Eyes
    ctx.fillStyle = eye;
    const eyeX = dir === 'left' ? 2 : dir === 'right' ? 5 : 2;
    ctx.fillRect(px + eyeX, py + 2, 1, 1);
    if (dir === 'up' || dir === 'down') {
      ctx.fillRect(px + 5, py + 2, 1, 1);
    }
    // Nose
    ctx.fillStyle = PALETTE.pink;
    ctx.fillRect(px + 3, py + 3, 2, 1);
    // Belly
    ctx.fillStyle = belly;
    ctx.fillRect(px + 2, py + 4, 4, 2);
    // Tail
    ctx.fillStyle = body;
    ctx.fillRect(px + 7, py + 5, 1, 2);
    // Legs
    ctx.fillRect(px + 1 + legOff, py + 7, 2, 1);
    ctx.fillRect(px + 5 - legOff, py + 7, 2, 1);
  }

  // Raccoon: 8x8
  private drawRaccoon(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    body: string,
    _belly: string,
    eye: string,
    legOff: number,
    _dir: Direction
  ): void {
    ctx.fillStyle = body;
    ctx.fillRect(px + 1, py + 2, 6, 5);
    // Mask
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(px + 2, py + 2, 4, 2);
    // Eyes
    ctx.fillStyle = eye;
    ctx.fillRect(px + 2, py + 2, 1, 1);
    ctx.fillRect(px + 5, py + 2, 1, 1);
    // Ears
    ctx.fillStyle = body;
    ctx.fillRect(px + 1, py + 0, 2, 2);
    ctx.fillRect(px + 5, py + 0, 2, 2);
    // Striped tail
    ctx.fillStyle = body;
    ctx.fillRect(px + 7, py + 4, 2, 3);
    ctx.fillRect(px + 7, py + 5, 1, 1);
    // Legs
    ctx.fillRect(px + 1 + legOff, py + 7, 2, 1);
    ctx.fillRect(px + 5 - legOff, py + 7, 2, 1);
  }

  // Turtle: 8x8
  private drawTurtle(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    _body: string,
    belly: string,
    eye: string,
    legOff: number,
    _dir: Direction
  ): void {
    // Shell
    ctx.fillStyle = PALETTE.darkGreen;
    ctx.fillRect(px + 1, py + 2, 6, 5);
    // Shell pattern
    ctx.fillStyle = PALETTE.green;
    ctx.fillRect(px + 2, py + 3, 4, 3);
    // Head
    ctx.fillStyle = belly;
    ctx.fillRect(px + 2, py + 0, 4, 2);
    // Eyes
    ctx.fillStyle = eye;
    ctx.fillRect(px + 2, py + 1, 1, 1);
    ctx.fillRect(px + 5, py + 1, 1, 1);
    // Legs
    ctx.fillStyle = belly;
    ctx.fillRect(px + 0 + legOff, py + 3, 2, 2);
    ctx.fillRect(px + 6 - legOff, py + 3, 2, 2);
    ctx.fillRect(px + 1 + legOff, py + 7, 2, 1);
    ctx.fillRect(px + 5 - legOff, py + 7, 2, 1);
  }

  // Capybara: 8x8
  private drawCapybara(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    body: string,
    belly: string,
    eye: string,
    legOff: number,
    _dir: Direction
  ): void {
    ctx.fillStyle = body;
    ctx.fillRect(px + 0, py + 2, 8, 5);
    // Head
    ctx.fillRect(px + 1, py + 1, 6, 2);
    // Eyes
    ctx.fillStyle = eye;
    ctx.fillRect(px + 2, py + 2, 1, 1);
    ctx.fillRect(px + 5, py + 2, 1, 1);
    // Nose
    ctx.fillStyle = PALETTE.darkGray;
    ctx.fillRect(px + 3, py + 3, 2, 1);
    // Belly
    ctx.fillStyle = belly;
    ctx.fillRect(px + 1, py + 4, 6, 2);
    // Legs
    ctx.fillStyle = body;
    ctx.fillRect(px + 1 + legOff, py + 7, 2, 1);
    ctx.fillRect(px + 5 - legOff, py + 7, 2, 1);
  }

  private drawDeadPlayer(ctx: CanvasRenderingContext2D, px: number, py: number, player: PlayerState): void {
    // Flattened / soaked look
    const colors = this.getAnimalColors(player.animal, false);
    ctx.fillStyle = colors.body;
    ctx.fillRect(px + 1, py + 6, 6, 2);
    // X eyes
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(px + 2, py + 5, 1, 1);
    ctx.fillRect(px + 5, py + 5, 1, 1);
    // Water puddle
    ctx.fillStyle = PALETTE.waterBlue;
    ctx.fillRect(px, py + 8, 8, 2);
  }

  // ============================================================
  // Hats
  // ============================================================
  private drawHat(
    ctx: CanvasRenderingContext2D,
    hat: Hat,
    px: number,
    py: number,
    _dir: Direction
  ): void {
    switch (hat) {
      case 'bucket':
        ctx.fillStyle = PALETTE.yellow;
        ctx.fillRect(px + 1, py - 2, 6, 3);
        ctx.fillRect(px + 0, py + 0, 8, 1);
        break;
      case 'snorkel':
        ctx.fillStyle = PALETTE.yellow;
        ctx.fillRect(px + 2, py - 1, 4, 2);
        ctx.fillStyle = PALETTE.blue;
        ctx.fillRect(px + 6, py - 1, 1, 4);
        ctx.fillRect(px + 6, py + 3, 2, 1);
        break;
      case 'crown':
        ctx.fillStyle = PALETTE.gold;
        ctx.fillRect(px + 1, py - 2, 6, 2);
        ctx.fillRect(px + 1, py - 3, 1, 1);
        ctx.fillRect(px + 3, py - 3, 1, 1);
        ctx.fillRect(px + 5, py - 3, 1, 1);
        break;
      case 'pirate':
        ctx.fillStyle = PALETTE.red;
        ctx.fillRect(px + 1, py - 2, 6, 2);
        ctx.fillStyle = PALETTE.black;
        ctx.fillRect(px + 1, py - 1, 6, 1);
        // Eye patch
        ctx.fillRect(px + 5, py + 2, 1, 1);
        break;
      case 'propeller':
        ctx.fillStyle = PALETTE.blue;
        ctx.fillRect(px + 2, py - 3, 4, 2);
        const spin = Math.floor(this.tick / 2) % 3;
        if (spin === 0) {
          ctx.fillRect(px + 1, py - 3, 6, 1);
        } else if (spin === 1) {
          ctx.fillRect(px + 3, py - 5, 2, 5);
        } else {
          ctx.fillRect(px + 1, py - 4, 6, 1);
          ctx.fillRect(px + 3, py - 2, 2, 1);
        }
        break;
    }
  }

  // ============================================================
  // Balloons
  // ============================================================
  drawBalloon(
    ctx: CanvasRenderingContext2D,
    balloon: Balloon,
    offsetX: number,
    offsetY: number,
    playerColor: string
  ): void {
    const px = offsetX + balloon.x * this.tileSize;
    const py = offsetY + balloon.y * this.tileSize;
    const fusePct = balloon.fuseTicks / 90; // approx

    // Wobble animation
    const wobble = Math.sin(this.tick * 0.3 + balloon.x * 2) * 1;
    const inflate = 1 + (1 - fusePct) * 0.3;

    const size = Math.floor(10 * inflate);
    const bx = px + HALF - size / 2 + wobble;
    const by = py + HALF - size / 2 - wobble;

    // Balloon body
    ctx.fillStyle = playerColor;
    ctx.fillRect(bx, by, size, size);
    // Highlight
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(bx + 1, by + 1, size - 4, 2);
    // Base
    ctx.fillStyle = PALETTE.darkGray;
    ctx.fillRect(bx + size / 2 - 1, by + size, 2, 1);

    // Fuse (white when about to pop)
    if (balloon.fuseTicks < 20 && Math.floor(this.tick / 4) % 2 === 0) {
      ctx.fillStyle = PALETTE.white;
      ctx.fillRect(bx + size / 2 - 1, by - 2, 2, 2);
    }
  }

  // ============================================================
  // Splashes
  // ============================================================
  drawSplash(
    ctx: CanvasRenderingContext2D,
    splash: Splash,
    offsetX: number,
    offsetY: number,
    playerColor: string
  ): void {
    const px = offsetX + splash.x * this.tileSize;
    const py = offsetY + splash.y * this.tileSize;
    const life = splash.ticksRemaining / 12; // 0..1
    const alpha = life;

    // Cross shape
    ctx.fillStyle = playerColor;
    ctx.globalAlpha = alpha;
    ctx.fillRect(px + 4, py + 4, 8, 8);

    // Droplets radiating
    const dropCount = 4;
    for (let i = 0; i < dropCount; i++) {
      const angle = (Math.PI * 2 * i) / dropCount + this.tick * 0.1;
      const dist = (1 - life) * 8;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      ctx.fillStyle = PALETTE.white;
      ctx.fillRect(px + 8 + dx - 1, py + 8 + dy - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  // ============================================================
  // Power-ups
  // ============================================================
  drawPowerUp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    type: PowerUpType,
    offsetX: number,
    offsetY: number
  ): void {
    const px = offsetX + x * this.tileSize + 4;
    const py = offsetY + y * this.tileSize + 4;
    const bob = Math.sin(this.tick * 0.15) * 2;

    // Glow background
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(px - 1, py - 1 + bob, 10, 10);

    switch (type) {
      case 'extraBalloon':
        ctx.fillStyle = PALETTE.red;
        ctx.fillRect(px + 2, py + 1 + bob, 4, 4);
        ctx.fillStyle = PALETTE.white;
        ctx.fillRect(px + 3, py + 2 + bob, 2, 2);
        ctx.fillStyle = PALETTE.darkGray;
        ctx.fillRect(px + 3, py + 5 + bob, 2, 1);
        break;
      case 'bigSplash':
        ctx.fillStyle = PALETTE.blue;
        ctx.fillRect(px + 1, py + 2 + bob, 6, 6);
        ctx.fillStyle = PALETTE.white;
        ctx.fillRect(px + 3, py + 3 + bob, 2, 2);
        break;
      case 'flippers':
        ctx.fillStyle = PALETTE.orange;
        ctx.fillRect(px + 1, py + 4 + bob, 3, 2);
        ctx.fillRect(px + 5, py + 4 + bob, 3, 2);
        ctx.fillStyle = PALETTE.yellow;
        ctx.fillRect(px + 2, py + 3 + bob, 2, 1);
        ctx.fillRect(px + 5, py + 3 + bob, 2, 1);
        break;
      case 'rubberBoots':
        ctx.fillStyle = PALETTE.brown;
        ctx.fillRect(px + 1, py + 4 + bob, 3, 3);
        ctx.fillRect(px + 5, py + 4 + bob, 3, 3);
        ctx.fillStyle = PALETTE.black;
        ctx.fillRect(px + 2, py + 3 + bob, 2, 1);
        ctx.fillRect(px + 5, py + 3 + bob, 2, 1);
        break;
    }
  }

  // ============================================================
  // Rubber Ducks (revenge mode)
  // ============================================================
  drawRubberDuck(
    ctx: CanvasRenderingContext2D,
    player: PlayerState,
    offsetX: number,
    offsetY: number
  ): void {
    const px = offsetX + player.x * this.tileSize + 2;
    const py = offsetY + player.y * this.tileSize + 4;

    // Duck body
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(px, py, 12, 6);
    ctx.fillRect(px + 8, py - 2, 4, 4);
    // Beak
    ctx.fillStyle = PALETTE.orange;
    ctx.fillRect(px + 11, py + 1, 2, 2);
    // Eye
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(px + 9, py - 1, 1, 1);
    // Water wake
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(px - 2 + Math.floor(this.tick % 4), py + 6, 3, 1);
    ctx.fillRect(px + 8 - Math.floor(this.tick % 4), py + 6, 3, 1);
  }

  // ============================================================
  // Background decorations (for menus)
  // ============================================================
  drawCritterWalking(
    ctx: CanvasRenderingContext2D,
    animal: Animal,
    x: number,
    y: number,
    tick: number,
    dir: Direction = 'right'
  ): void {
    this.tick = tick;
    this.drawAnimal(ctx, animal, x, y, Math.floor(tick / 8) % 2, dir, false);
  }

  // ============================================================
  // Animal face icon (for HUD, 16x16)
  // ============================================================
  drawAnimalFace(
    ctx: CanvasRenderingContext2D,
    animal: Animal,
    x: number,
    y: number,
    size: number
  ): void {
    const colors = this.getAnimalColors(animal, false);
    ctx.fillStyle = colors.body;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = colors.belly;
    ctx.fillRect(x + size / 4, y + size / 2, size / 2, size / 3);
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(x + size / 4, y + size / 4, size / 8, size / 8);
    ctx.fillRect(x + (size * 5) / 8, y + size / 4, size / 8, size / 8);
  }
}
