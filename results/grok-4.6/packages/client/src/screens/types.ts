export interface Screen {
  name: string;
  update: (dt: number) => void;
  draw: (ctx: CanvasRenderingContext2D) => void;
  key?: (e: KeyboardEvent) => void;
  keyup?: (e: KeyboardEvent) => void;
  click?: (x: number, y: number) => void;
  leave?: () => void;
}
