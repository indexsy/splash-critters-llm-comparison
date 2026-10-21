import { ANIMALS, HATS, type AnimalId, type HatId } from '@splash-critters/shared';
import type { App } from '../app.js';
import { button, clear, el, panel } from '../ui.js';
import { drawCritter, drawHat } from '../render/sprites.js';

/** Locker: pick an animal and a hat, both purely cosmetic. */
export class LockerScreen {
  private app: App | null = null;
  private animal: AnimalId = 'frog';
  private hat: HatId = 'none';
  private time = 0;
  private preview: HTMLCanvasElement | null = null;

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    const profile = app.state.profile;
    this.animal = (profile?.animal as AnimalId) ?? 'frog';
    this.hat = (profile?.hat as HatId) ?? 'none';
    const unlocked = new Set(profile?.unlocks ?? ['frog', 'duck', 'none']);

    const preview = el('canvas', { width: '96', height: '80' }) as HTMLCanvasElement;
    preview.style.imageRendering = 'pixelated';
    preview.style.width = '192px';
    preview.style.height = '160px';
    preview.style.border = '2px solid #0b1120';
    preview.style.background = '#1b2947';
    this.preview = preview;

    const animalGrid = el('div', { class: 'grid2' });
    for (const animal of ANIMALS) {
      const owned = unlocked.has(animal.id);
      animalGrid.appendChild(
        button(
          `${animal.name}${owned ? '' : ` (LV ${animal.unlockLevel})`}`,
          () => {
            if (!owned) {
              app.toast(`${animal.name} unlocks at level ${animal.unlockLevel}`);
              return;
            }
            this.animal = animal.id as AnimalId;
            this.apply();
          },
          owned ? '' : 'dim',
          !owned,
        ),
      );
    }

    const hatGrid = el('div', { class: 'grid2' });
    for (const hat of HATS) {
      const owned = unlocked.has(hat.id);
      hatGrid.appendChild(
        button(
          `${hat.name}${owned ? '' : ` (LV ${hat.unlockLevel})`}`,
          () => {
            if (!owned) {
              app.toast(`${hat.name} unlocks at level ${hat.unlockLevel}`);
              return;
            }
            this.hat = hat.id as HatId;
            this.apply();
          },
          owned ? '' : 'dim',
          !owned,
        ),
      );
    }

    const root = panel(
      'Locker',
      el('div', { class: 'row' }, [preview]),
      el('p', { class: 'hint' }, [
        `Level ${profile?.level ?? 1} - cosmetics never change your power.`,
      ]),
      el('h2', {}, ['Animals']),
      animalGrid,
      el('h2', {}, ['Hats']),
      hatGrid,
      el('div', { class: 'row' }, [
        button('Back', () => app.go('menu')),
      ]),
    );
    app.overlay.appendChild(root);
  }

  hide(): void {
    if (this.app) clear(this.app.overlay);
  }

  update(dt: number): void {
    this.time += dt;
    const canvas = this.preview;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1b2947';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#23355c';
    ctx.fillRect(0, 60, canvas.width, 20);
    const frame = Math.floor(this.time * 6) % 2;
    drawCritter(ctx, this.animal, 42, 24, frame, 0);
    drawHat(ctx, this.hat, 42, 24);
    ctx.fillStyle = '#fdf6e3';
    ctx.font = '8px monospace';
    ctx.fillText(this.animal.toUpperCase(), 48, 10);
  }

  render(ctx: CanvasRenderingContext2D): void {
    // the preview lives in its own small canvas inside the panel
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, 256, 224);
  }

  private apply(): void {
    const app = this.app;
    if (!app) return;
    app.send({ t: 'set_cosmetics', animal: this.animal, hat: this.hat });
    app.toast('look updated');
  }
}
