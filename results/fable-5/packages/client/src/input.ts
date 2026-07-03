import type { Dir } from "@splash/shared";

export type Action = "up" | "down" | "left" | "right" | "drop" | "emote1" | "emote2" | "emote3" | "emote4" | "mute";

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  drop: ["Space", "KeyE"],
  emote1: ["Digit1"],
  emote2: ["Digit2"],
  emote3: ["Digit3"],
  emote4: ["Digit4"],
  mute: ["KeyM"],
};

export class InputSys {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  bindings: Record<Action, string[]>;
  /** Order the movement keys were pressed in — latest wins. */
  private moveStack: Action[] = [];

  constructor(bindings?: Record<Action, string[]>) {
    this.bindings = bindings ?? structuredClone(DEFAULT_BINDINGS);
  }

  keyDown(code: string): void {
    if (this.down.has(code)) return;
    this.down.add(code);
    this.pressedThisFrame.add(code);
    const act = this.actionFor(code);
    if (act && ["up", "down", "left", "right"].includes(act)) {
      this.moveStack = this.moveStack.filter((a) => a !== act);
      this.moveStack.push(act);
    }
  }

  keyUp(code: string): void {
    this.down.delete(code);
    const act = this.actionFor(code);
    if (act) {
      // Only drop from the stack if NO other bound key for it is held.
      if (!this.bindings[act].some((c) => this.down.has(c))) {
        this.moveStack = this.moveStack.filter((a) => a !== act);
      }
    }
  }

  clear(): void {
    this.down.clear();
    this.moveStack = [];
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
  }

  actionFor(code: string): Action | null {
    for (const [action, codes] of Object.entries(this.bindings) as [Action, string[]][]) {
      if (codes.includes(code)) return action;
    }
    return null;
  }

  isHeld(action: Action): boolean {
    return this.bindings[action].some((c) => this.down.has(c));
  }

  wasPressed(action: Action): boolean {
    return this.bindings[action].some((c) => this.pressedThisFrame.has(c));
  }

  /** Current movement direction — most recently pressed still-held key wins. */
  moveDir(): Dir {
    for (let i = this.moveStack.length - 1; i >= 0; i--) {
      const a = this.moveStack[i];
      if (this.isHeld(a)) {
        if (a === "up") return 1;
        if (a === "right") return 2;
        if (a === "down") return 3;
        if (a === "left") return 4;
      }
    }
    return 0;
  }

  rebind(action: Action, code: string): void {
    // Remove the code from every action, then set as primary for this one.
    for (const codes of Object.values(this.bindings)) {
      const i = codes.indexOf(code);
      if (i >= 0) codes.splice(i, 1);
    }
    this.bindings[action] = [code, ...this.bindings[action].slice(1)];
  }
}
