import type { App } from "../main.js";

export interface Screen {
  enter?(app: App): void;
  exit?(app: App): void;
  render(app: App, time: number): void;
  key?(app: App, code: string): boolean;
}
