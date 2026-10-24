import type { GameEvent } from "@splash/shared";
import { STR } from "../strings.js";
import type { App } from "../main.js";
import { button, panel, text } from "./ui.js";

export class TutorialTracker {
  private step = 0;
  private startX = 0;
  private startY = 0;
  private started = false;

  reset(): void {
    this.step = 0;
    this.started = false;
  }

  update(app: App): void {
    if (!app.matchConfig?.tutorial) return;
    const player = app.prediction.localPlayer();
    if (!player) return;
    if (!this.started) {
      this.startX = player.x;
      this.startY = player.y;
      this.started = true;
    }
    if (this.step === 0 && Math.hypot(player.x - this.startX, player.y - this.startY) > 0.6) this.step = 1;
  }

  event(app: App, event: GameEvent): void {
    if (!app.matchConfig?.tutorial) return;
    if (event.type === "balloon_dropped" && event.playerId === app.localPlayerId && this.step === 1) this.step = 2;
    if (event.type === "powerup_collected" && event.playerId === app.localPlayerId && this.step <= 2) this.step = 3;
    if (event.type === "chain_burst" && event.ownerId === app.localPlayerId && this.step <= 3) this.step = 4;
    if (event.type === "player_soaked" && event.playerId !== app.localPlayerId && this.step >= 3) this.step = 5;
  }

  render(app: App): void {
    if (!app.matchConfig?.tutorial) return;
    const instructions = [STR.tutorialMove, STR.tutorialDrop, STR.tutorialPickup, STR.tutorialChain, STR.tutorialSoak, STR.tutorialDone];
    panel(app, 18, 201, 220, 18, "#10162fee");
    text(app, `${Math.min(this.step + 1, 5)}/5 ${instructions[this.step]}`, 24, 207, this.step === 5 ? "#56e39f" : "#f9dc5c", 6);
    button(app, "skip-tutorial", STR.skipTutorial, 174, 33, 72, 11, () => app.leaveRoom(), { small: true });
  }
}
