import { app, type Screen } from "../app.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { button, panel } from "../render/ui.js";
import { drawBalloon, drawPowerup } from "../render/sprites.js";

const LINES: [string, string][] = [
  ["MOVE", "WASD OR ARROW KEYS"],
  ["DROP BALLOON", "SPACE OR E"],
  ["EMOTES", "KEYS 1-4"],
  ["MUTE", "M"],
  ["", ""],
  ["BALLOONS BURST IN A CROSS SHAPE.", ""],
  ["SPLASHES WASH SANDCASTLES AND", ""],
  ["SOAK CRITTERS. LAST ONE DRY WINS!", ""],
  ["", ""],
  ["CHAIN BALLOONS FOR MEGA SPLASHES.", ""],
  ["AT 2:00 THE TIDE FLOODS THE ARENA", ""],
  ["FROM THE EDGES - STAY DRY!", ""],
];

export class HowToScreen implements Screen {
  private t = 0;

  update(dt: number): void {
    this.t += dt;
  }

  onKeyDown(code: string): boolean | void {
    if (code === "Escape") {
      app.go("menu");
      return true;
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.uiBg;
    g.fillRect(0, 0, 256, 224);
    drawTextCentered(g, "HOW TO PLAY", 128, 6, PAL.gold, 2);
    if (button(g, 4, 4, 40, 12, "< BACK")) app.go("menu");

    panel(g, 8, 24, 152, 130);
    LINES.forEach(([a, b], i) => {
      const y = 30 + i * 10;
      if (b) {
        drawText(g, a, 14, y, PAL.waterLight);
        drawText(g, b, 74, y, PAL.white);
      } else {
        drawText(g, a, 14, y, PAL.white);
      }
    });

    panel(g, 166, 24, 82, 130, "POWER-UPS");
    const items: [string, string][] = [
      ["extra_balloon", "+1 BALLOON"],
      ["big_splash", "+1 RANGE"],
      ["flippers", "+SPEED"],
      ["rubber_boots", "KICK!"],
    ];
    items.forEach(([type, label], i) => {
      const y = 40 + i * 26;
      drawPowerup(g, 172, y, type, this.t);
      drawText(g, label, 192, y + 6, PAL.white);
    });

    panel(g, 8, 158, 240, 52, "TIPS");
    drawText(g, "- SOAKED IN CASUAL? RIDE THE REVENGE DUCK", 14, 172, PAL.gray);
    drawText(g, "  AND LOB BALLOONS FROM THE BORDER!", 14, 181, PAL.gray);
    drawText(g, "- RUBBER BOOTS LET YOU KICK BALLOONS", 14, 190, PAL.gray);
    drawText(g, "- POWER-UPS HIDE INSIDE SANDCASTLES", 14, 199, PAL.gray);
    drawBalloon(g, 232, 190, 0.6, false, this.t);
  }
}
