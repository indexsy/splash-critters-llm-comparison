export interface Screen {
  enter(data?: unknown): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  exit(): void;
}
