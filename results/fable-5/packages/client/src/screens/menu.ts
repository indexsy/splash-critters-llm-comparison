import { tierForRating, xpProgress, type GameMode, type S2C } from "@splash/shared";
import { app, type Screen } from "../app.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { critterSprite, drawTierBadge } from "../render/sprites.js";
import { button, modal, panel, textField } from "../render/ui.js";
import { TextInput } from "../textinput.js";

type Dialog = null | { kind: "nickname"; then: GameMode | null } | { kind: "joincode" };

export class MenuScreen implements Screen {
  private dialog: Dialog = null;
  private nickInput = new TextInput(16);
  private codeInput = new TextInput(6, /^[a-zA-Z0-9]$/);
  private t = 0;

  enter(): void {
    app.audio.music("menu");
    this.dialog = null;
  }

  update(dt: number): void {
    this.t += dt;
  }

  onMessage(msg: S2C): void {
    if (msg.t === "nickname_result") {
      if (msg.ok) {
        app.toast("NICKNAME SET!", PAL.green);
        const then = this.dialog?.kind === "nickname" ? this.dialog.then : null;
        this.dialog = null;
        if (then) this.queue(then);
      } else {
        app.toast(msg.msg ?? "TRY ANOTHER NAME", PAL.red);
      }
    }
    if (msg.t === "room_created") {
      // lobby_state will follow and route us to the lobby screen
    }
  }

  onKeyDown(code: string, key: string): boolean | void {
    if (this.dialog?.kind === "nickname") {
      if (code === "Enter") {
        this.submitNickname();
        return true;
      }
      if (code === "Escape") {
        this.dialog = null;
        return true;
      }
      return this.nickInput.handleKey(code, key);
    }
    if (this.dialog?.kind === "joincode") {
      if (code === "Enter") {
        this.submitJoinCode();
        return true;
      }
      if (code === "Escape") {
        this.dialog = null;
        return true;
      }
      return this.codeInput.handleKey(code, key);
    }
  }

  private queue(mode: GameMode): void {
    if (!app.profile?.hasCustomNickname) {
      this.dialog = { kind: "nickname", then: mode };
      this.nickInput.value = "";
      return;
    }
    app.net.send({ t: "queue_join", mode });
    app.go("queue", { mode });
  }

  private submitNickname(): void {
    const v = this.nickInput.value.trim();
    if (v.length < 3) {
      app.toast("AT LEAST 3 CHARACTERS", PAL.red);
      return;
    }
    app.net.send({ t: "set_nickname", nickname: v });
  }

  private submitJoinCode(): void {
    const code = this.codeInput.value.trim().toUpperCase();
    if (code.length !== 6) {
      app.toast("CODES ARE 6 CHARACTERS", PAL.red);
      return;
    }
    app.net.send({ t: "join_room", code });
    this.dialog = null;
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.uiBg;
    g.fillRect(0, 0, 256, 224);
    drawTextCentered(g, "SPLASH CRITTERS", 128, 8, PAL.waterLight, 2);

    // profile card
    const p = app.profile;
    panel(g, 8, 26, 108, 64);
    if (p) {
      const sprite = critterSprite(p.selectedAnimal, p.selectedHat, Math.floor(this.t * 3) % 2, 3);
      g.drawImage(sprite, 0, 0, 16, 16, 14, 32, 24, 24);
      drawText(g, p.nickname.slice(0, 10), 42, 32, PAL.white);
      drawText(g, p.tag, 42, 40, PAL.gray);
      drawText(g, `LEVEL ${p.level}`, 42, 50, PAL.gold);
      const [have, need] = xpProgress(p.xp);
      g.fillStyle = PAL.darkgray;
      g.fillRect(14, 62, 88, 4);
      g.fillStyle = PAL.green;
      g.fillRect(14, 62, Math.round((88 * have) / need), 4);
      drawText(g, `${have}/${need} XP`, 14, 68, PAL.gray);
      drawTierBadge(g, 14, 76, tierForRating(p.ratings.duel.rating));
      drawText(g, `DUEL ${p.ratings.duel.rating}`, 27, 78, PAL.white);
      drawTierBadge(g, 66, 76, tierForRating(p.ratings.ffa.rating));
      drawText(g, `FFA ${p.ratings.ffa.rating}`, 79, 78, PAL.white);
    }

    // menu buttons
    const bx = 128;
    const bw = 118;
    let by = 26;
    const step = 15;
    drawText(g, "RANKED", bx + 2, by - 1, PAL.gold);
    by += 7;
    if (button(g, bx, by, bw, 12, "RANKED DUEL (1V1)")) this.queue("duel");
    by += step;
    if (button(g, bx, by, bw, 12, "RANKED FREE-FOR-ALL")) this.queue("ffa");
    by += step + 4;
    drawText(g, "CASUAL", bx + 2, by - 1, PAL.waterLight);
    by += 7;
    if (button(g, bx, by, bw, 12, "BROWSE ROOMS")) app.go("browser");
    by += step;
    if (button(g, bx, by, bw, 12, "CREATE ROOM")) app.go("browser", { create: true });
    by += step;
    if (button(g, bx, by, bw, 12, "JOIN BY CODE")) {
      this.dialog = { kind: "joincode" };
      this.codeInput.value = "";
    }
    by += step;
    if (button(g, bx, by, bw, 12, "PRACTICE VS BOTS")) {
      app.net.send({
        t: "create_room",
        opts: { name: "Practice", mode: "ffa", isPublic: false, theme: "random", roundsToWin: 3, botFill: true },
      });
    }

    // bottom row
    let bx2 = 8;
    const y2 = 96;
    if (button(g, bx2, y2, 52, 12, "TUTORIAL")) app.go("tutorial");
    if (button(g, 8, 112, 52, 12, "LOCKER")) app.go("locker");
    if (button(g, 8, 128, 52, 12, "RANKS")) app.go("leaderboard");
    if (button(g, 8, 144, 52, 12, "HELP")) app.go("howto");
    if (button(g, 8, 160, 52, 12, "SETTINGS")) app.go("settings");

    drawTextCentered(g, app.connected ? `PING ${app.pingMs}MS` : "RECONNECTING...", 128, 214, app.connected ? PAL.darkgray : PAL.red);

    // dialogs
    if (this.dialog?.kind === "nickname") {
      const m = modal(g, 180, 74, "PICK A NICKNAME");
      drawText(g, "NEEDED FOR RANKED PLAY.", m.x + 6, m.y + 4, PAL.gray);
      drawText(g, "3-16 CHARACTERS.", m.x + 6, m.y + 12, PAL.gray);
      if (textField(g, m.x + 6, m.y + 22, 168, this.nickInput.value, true, "YOUR NAME")) {
        // clicking focuses (already focused)
      }
      if (button(g, m.x + 6, m.y + 40, 80, 13, "CONFIRM")) this.submitNickname();
      if (button(g, m.x + 94, m.y + 40, 80, 13, "CANCEL")) this.dialog = null;
    }
    if (this.dialog?.kind === "joincode") {
      const m = modal(g, 160, 64, "JOIN BY CODE");
      textField(g, m.x + 6, m.y + 6, 148, this.codeInput.value.toUpperCase(), true, "ABC123");
      if (button(g, m.x + 6, m.y + 26, 70, 13, "JOIN")) this.submitJoinCode();
      if (button(g, m.x + 84, m.y + 26, 70, 13, "CANCEL")) this.dialog = null;
    }
  }
}
