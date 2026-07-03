import { app, type Screen } from "../app.js";
import { drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { critterSprite } from "../render/sprites.js";

const CAST = ["frog", "duck", "otter", "penguin", "cat", "raccoon", "turtle", "capybara"];

export class TitleScreen implements Screen {
  private t = 0;

  enter(): void {
    app.audio.music("menu");
  }

  update(dt: number): void {
    this.t += dt;
    if (app.mouse.clicked) this.proceed();
  }

  onKeyDown(): boolean {
    this.proceed();
    return true;
  }

  private proceed(): void {
    app.audio.unlock();
    app.audio.music("menu");
    if (!app.connected) return;
    if (app.pendingRoomCode) {
      const code = app.pendingRoomCode;
      app.pendingRoomCode = null;
      app.net.send({ t: "join_room", code });
      return; // lobby_state will route us to the lobby
    }
    if (app.profile && !app.profile.tutorialDone) app.go("tutorial");
    else app.go("menu");
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.navy;
    g.fillRect(0, 0, 256, 224);

    // rolling waves
    for (let row = 0; row < 4; row++) {
      const y = 150 + row * 20;
      g.fillStyle = row % 2 === 0 ? PAL.waterDeep : PAL.water;
      g.fillRect(0, y, 256, 20);
      g.fillStyle = PAL.waterLight;
      for (let x = -16; x < 272; x += 16) {
        const off = Math.round(Math.sin(this.t * (1.2 + row * 0.3) + x / 14 + row) * 3);
        g.fillRect(x + off, y, 8, 2);
      }
    }

    // bobbing critters riding the waves
    CAST.forEach((animal, i) => {
      const x = 20 + i * 30;
      const y = 148 + Math.round(Math.sin(this.t * 2 + i) * 4) + (i % 2) * 22;
      g.drawImage(critterSprite(animal, i === 3 ? "snorkel" : i === 7 ? "crown" : "none", Math.floor(this.t * 4 + i) % 2, 3), x, y);
    });

    // logo
    drawTextCentered(g, "SPLASH", 128, 38, PAL.waterLight, 4);
    drawTextCentered(g, "CRITTERS", 128, 66, PAL.gold, 3);
    drawTextCentered(g, "8-BIT WATER BALLOON BATTLES", 128, 92, PAL.white);

    const blink = Math.floor(this.t * 2) % 2 === 0;
    if (app.connected) {
      if (blink) drawTextCentered(g, "PRESS ANY KEY", 128, 118, PAL.white);
    } else {
      drawTextCentered(g, "CONNECTING...", 128, 118, PAL.gray);
    }
    drawTextCentered(g, "AN ORIGINAL PIXEL ARENA GAME", 128, 214, PAL.darkgray);
  }
}
