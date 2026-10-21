import { levelProgress, type GameMode } from "@splash/shared";
import type { App } from "../main.js";
import {
  COLORS,
  Screen,
  contains,
  drawButton,
  drawInset,
  drawOcean,
  drawPanel,
  drawProgress,
  drawWrapped,
  type Button,
} from "../ui.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { drawAnimal } from "../render/sprites.js";

export class MenuScreen extends Screen {
  private time = 0;
  private selected = 0;
  private helpOpen = false;
  private helpPage = 0;
  private nameOpen = false;
  private nameInput = "";
  private nameError = "";
  private awaitingName = false;
  private queueAfterName: GameMode | null = null;
  private buttons: Button[] = [
    { x: 14, y: 73, w: 110, h: 22, label: "RANKED DUEL", action: "duel" },
    { x: 132, y: 73, w: 110, h: 22, label: "RANKED FFA", action: "ffa" },
    { x: 14, y: 100, w: 110, h: 22, label: "CASUAL ROOMS", action: "casual" },
    { x: 132, y: 100, w: 110, h: 22, label: "PRACTICE", action: "practice" },
    { x: 14, y: 127, w: 110, h: 22, label: "LEADERBOARD", action: "leaderboard" },
    { x: 132, y: 127, w: 110, h: 22, label: "LOCKER", action: "locker" },
    { x: 14, y: 154, w: 110, h: 22, label: "HOW TO PLAY", action: "help" },
    { x: 132, y: 154, w: 110, h: 22, label: "SETTINGS", action: "settings" },
  ];
  private nameButton: Button = { x: 196, y: 27, w: 48, h: 13, label: "NAME", action: "name", small: true };

  enter(): void {
    this.app.audio.setMusic("menu");
    this.app.audio.setShowdown(false);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.awaitingName && this.app.profile) {
      const target = this.nameInput.trim();
      const success =
        !this.app.profile.needsNickname &&
        this.app.profile.nickname.toLowerCase() === target.toLowerCase();
      if (success) {
        this.awaitingName = false;
        this.nameOpen = false;
        const mode = this.queueAfterName;
        this.queueAfterName = null;
        if (mode) this.startQueue(mode);
      }
    }
  }

  private act(action: string): void {
    this.app.audio.unlock();
    this.app.audio.click();
    if (action === "duel" || action === "ffa") {
      this.tryQueue(action);
    } else if (action === "casual") {
      this.app.showBrowser();
    } else if (action === "practice") {
      if (this.app.connection !== "open") {
        this.app.toast("NOT CONNECTED YET.");
        return;
      }
      this.app.net.createRoom({
        name: "Practice Pond",
        size: 4,
        isPrivate: true,
        theme: "random",
        roundsToWin: 3,
        botFill: true,
        practice: true,
      });
      this.app.toast("STARTING PRACTICE MATCH...");
    } else if (action === "leaderboard") {
      this.app.showLeaderboard();
    } else if (action === "locker") {
      this.app.showLocker();
    } else if (action === "help") {
      this.helpOpen = true;
      this.helpPage = 0;
    } else if (action === "settings") {
      this.app.showSettings();
    } else if (action === "name") {
      this.openName(false);
    }
  }

  private tryQueue(mode: GameMode): void {
    if (!this.app.profile) {
      this.app.toast("CONNECTING...");
      return;
    }
    if (this.app.connection !== "open") {
      this.app.toast("YOU ARE OFFLINE.");
      return;
    }
    if (this.app.profile.needsNickname) {
      this.openName(true, mode);
      return;
    }
    this.startQueue(mode);
  }

  private startQueue(mode: GameMode): void {
    this.app.net.queueJoin(mode);
    this.app.showQueue(mode);
  }

  private openName(queue: boolean, mode: GameMode | null = null): void {
    this.nameInput = this.app.profile?.nickname ?? "";
    this.nameError = "";
    this.nameOpen = true;
    this.awaitingName = false;
    this.queueAfterName = queue ? mode : null;
  }

  private submitName(): void {
    const value = this.nameInput.trim();
    if (value.length < 3 || value.length > 16) {
      this.nameError = "USE 3-16 CHARACTERS.";
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/u.test(value)) {
      this.nameError = "LETTERS, NUMBERS, SPACE, _ OR -.";
      return;
    }
    this.nameError = "";
    this.awaitingName = true;
    this.app.net.setNickname(value);
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.nameOpen) {
      if (event.code === "Escape") {
        this.nameOpen = false;
        this.awaitingName = false;
        this.queueAfterName = null;
        return true;
      }
      if (event.code === "Backspace") {
        this.nameInput = this.nameInput.slice(0, -1);
        return true;
      }
      if (event.code === "Enter" || event.code === "NumpadEnter") {
        this.submitName();
        return true;
      }
      if (event.key.length === 1 && /^[A-Za-z0-9 _-]$/u.test(event.key) && this.nameInput.length < 16) {
        this.nameInput += event.key;
        return true;
      }
      return true;
    }
    if (this.helpOpen) {
      if (event.code === "Escape" || event.code === "Enter") this.helpOpen = false;
      else if (event.code === "ArrowRight") this.helpPage = Math.min(1, this.helpPage + 1);
      else if (event.code === "ArrowLeft") this.helpPage = Math.max(0, this.helpPage - 1);
      return true;
    }
    if (event.code === "ArrowDown") {
      this.selected = (this.selected + 2) % this.buttons.length;
      return true;
    }
    if (event.code === "ArrowUp") {
      this.selected = (this.selected - 2 + this.buttons.length) % this.buttons.length;
      return true;
    }
    if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      this.selected = (this.selected + 1) % this.buttons.length;
      return true;
    }
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      const button = this.buttons[this.selected];
      if (button) this.act(button.action);
      return true;
    }
    return false;
  }

  onClick(x: number, y: number): void {
    if (this.nameOpen) {
      if (x >= 114 && y >= 144 && x < 142 && y < 158 && !this.awaitingName) this.submitName();
      if (x >= 66 && y >= 144 && x < 110 && y < 158) {
        this.nameOpen = false;
        this.nameError = "";
        this.queueAfterName = null;
      }
      return;
    }
    if (this.helpOpen) {
      this.helpOpen = false;
      return;
    }
    if (contains(this.nameButton, x, y)) {
      this.act("name");
      return;
    }
    this.buttons.forEach((button, index) => {
      if (contains(button, x, y)) {
        this.selected = index;
        this.act(button.action);
      }
    });
  }

  onMouseMove(x: number, y: number): void {
    if (this.nameOpen || this.helpOpen) return;
    this.buttons.forEach((button, index) => {
      if (contains(button, x, y)) this.selected = index;
    });
  }

  cursorAt(x: number, y: number): string {
    if (this.nameOpen || this.helpOpen) return "default";
    if (contains(this.nameButton, x, y)) return "pointer";
    return this.buttons.some((button) => contains(button, x, y)) ? "pointer" : "default";
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawOcean(ctx, this.time, true);
    const profile = this.app.profile;
    drawText(ctx, "SPLASH CRITTERS", 10, 8, COLORS.mint, 1);
    drawText(ctx, "MAIN MENU", 192, 8, "#649aa6");
    if (profile) {
      drawPanel(ctx, 8, 23, 240, 42);
      drawAnimal(ctx, {
        animal: profile.selectedAnimal,
        hat: profile.selectedHat,
        x: 12,
        y: 25,
        scale: 1.7,
        time: this.time,
        moving: true,
        frame: Math.floor(this.time * 4) % 2,
      });
      drawText(
        ctx,
        profile.displayName.toUpperCase().slice(0, 17),
        42,
        28,
        profile.needsNickname ? COLORS.coral : COLORS.foam,
      );
      drawText(ctx, `LEVEL ${profile.level}`, 42, 39, COLORS.yellow);
      const progress = levelProgress(profile.xp);
      drawProgress(ctx, 84, 41, 64, 6, progress.ratio, COLORS.teal);
      drawText(
        ctx,
        `${progress.intoLevel}/${progress.needed} XP`,
        84,
        50,
        "#77a7b2",
      );
      const duel = profile.ratings.duel;
      const ffa = profile.ratings.ffa;
      drawText(ctx, `DUEL ${duel ? Math.round(duel.rating) : 1000}`, 170, 43, "#8dd6d5");
      drawText(ctx, `FFA ${ffa ? Math.round(ffa.rating) : 1000}`, 170, 53, "#8dd6d5");
      drawButton(ctx, this.nameButton, false);
    } else {
      drawPanel(ctx, 8, 23, 240, 42);
      drawText(ctx, "CONNECTING TO THE POND...", 20, 39, COLORS.mint);
    }
    this.buttons.forEach((button, index) => {
      drawButton(ctx, button, index === this.selected, index === this.selected);
    });
    drawTextCentered(
      ctx,
      "ARROWS / MOUSE + ENTER",
      128,
      190,
      "#5b929e",
    );
    drawTextCentered(
      ctx,
      "RANKED NEEDS A NICKNAME / CASUAL OPEN",
      128,
      201,
      "#457b87",
    );
    if (profile?.needsNickname) {
      drawTextCentered(ctx, "SET A NICKNAME BEFORE RANKED!", 128, 212, COLORS.coral);
    }
    if (this.helpOpen) this.renderHelp(ctx);
    if (this.nameOpen) this.renderName(ctx);
  }

  private renderHelp(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(2, 8, 12, 0.8)";
    ctx.fillRect(0, 0, 256, 224);
    drawPanel(ctx, 16, 22, 224, 182);
    drawText(ctx, this.helpPage === 0 ? "HOW TO PLAY" : "SPLASH SCIENCE", 26, 31, COLORS.mint, 2);
    if (this.helpPage === 0) {
      const rows: Array<[string, string]> = [
        ["WASD / ARROWS", "MOVE YOUR CRITTER"],
        ["SPACE / E", "DROP A WATER BALLOON"],
        ["1 2 3 4", "ANIMAL EMOTES"],
        ["M", "MUTE AUDIO"],
        ["ESC", "LEAVE A MATCH"],
      ];
      rows.forEach(([key, text], index) => {
        drawText(ctx, key, 28, 58 + index * 17, COLORS.yellow);
        drawText(ctx, text, 118, 58 + index * 17, COLORS.foam);
      });
      drawWrapped(
        ctx,
        "LAST CRITTER DRY WINS THE ROUND. FIRST TO THE ROUND TARGET WINS THE MATCH.",
        28,
        148,
        200,
        "#82b4be",
        9,
      );
      drawTextCentered(ctx, "1/2   ARROWS TO READ", 128, 190, "#5f929d");
    } else {
      drawWrapped(
        ctx,
        "BALLOONS BURST INTO CROSS-SHAPED SPLASHES. A SPLASH WASHES THE FIRST SANDCASTLE IN EACH DIRECTION AND STOPS.",
        28,
        55,
        200,
        COLORS.foam,
        9,
      );
      drawWrapped(
        ctx,
        "CHAIN BALLOONS FOR BIGGER SPLASHES. HIDDEN POWER-UPS POP OUT OF CASTLES. GRAB EXTRA BALLOONS, RANGE, FLIPPERS AND RARE RUBBER BOOTS.",
        28,
        92,
        200,
        "#a6d7dc",
        9,
      );
      drawWrapped(
        ctx,
        "AT 2:00 THE RISING TIDE FLOODS THE EDGES. IN CASUAL MATCHES, SOAKED CRITTERS CAN THROW REVENGE BALLOONS FROM DUCKY RAFTS.",
        28,
        140,
        200,
        "#7fb4bf",
        9,
      );
      drawTextCentered(ctx, "2/2   ARROWS TO READ", 128, 190, "#5f929d");
    }
  }

  private renderName(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(2, 8, 12, 0.82)";
    ctx.fillRect(0, 0, 256, 224);
    drawPanel(ctx, 38, 54, 180, 112);
    drawTextCentered(ctx, "PICK YOUR NAME", 128, 64, COLORS.mint, 2);
    drawTextCentered(ctx, "3-16 CHARACTERS. A #TAG IS ADDED.", 128, 84, "#88bdc6");
    drawInset(ctx, 56, 96, 144, 17);
    const shown = this.nameInput || "";
    drawText(ctx, shown, 61, 101, COLORS.foam);
    if (Math.floor(this.time * 2) % 2 === 0) {
      ctx.fillStyle = COLORS.teal;
      ctx.fillRect(62 + Math.min(130, shown.length * 6), 101, 1, 7);
    }
    drawTextCentered(ctx, this.nameError || (this.awaitingName ? "SAVING..." : "ENTER TO SAVE"), 128, 121, this.nameError ? COLORS.coral : "#74a7b2");
    drawButton(ctx, { x: 66, y: 144, w: 44, h: 14, label: "CANCEL", action: "cancel", small: true }, false);
    drawButton(ctx, { x: 114, y: 144, w: 28, h: 14, label: "OK", action: "ok", small: true }, false);
  }
}
