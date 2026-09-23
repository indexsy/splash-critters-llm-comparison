// Settings change notifications: keybinds keep their object identity until the binds really
// change (input.ts treats a new reference as a remap and drops held keys), and writes that
// change nothing are not announced. Each test loads a fresh module; storage falls back to its
// in-memory map because node has no localStorage.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SettingsModule = typeof import('../src/settings');

let mod: SettingsModule;

beforeEach(async () => {
  vi.resetModules();
  mod = await import('../src/settings');
});

function recordChanges() {
  const calls: { keybindsChanged: boolean; muted: boolean }[] = [];
  mod.settings.subscribe((next, prev) => calls.push({ keybindsChanged: next.keybinds !== prev.keybinds, muted: next.muted }));
  return calls;
}

describe('settings keybinds identity', () => {
  it('keeps the keybinds reference across non-keybind writes', () => {
    const { settings } = mod;
    const before = settings.get().keybinds;
    const calls = recordChanges();
    settings.set({ muted: true });
    settings.set({ sfxVolume: 0.3 });
    settings.set({ colorblind: true, reducedShake: true });
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => !c.keybindsChanged)).toBe(true);
    expect(settings.get().keybinds).toBe(before);
    expect(settings.get()).toMatchObject({ muted: true, sfxVolume: 0.3, colorblind: true, reducedShake: true });
  });

  it('keeps the reference when keybinds are re-set to equal values', () => {
    const { settings } = mod;
    const before = settings.get().keybinds;
    const calls = recordChanges();
    settings.set({ keybinds: structuredClone(before) });
    settings.resetKeybinds();
    expect(calls).toHaveLength(0);
    expect(settings.get().keybinds).toBe(before);
  });

  it('issues a new reference when a bind really changes', () => {
    const { settings } = mod;
    const before = settings.get().keybinds;
    const calls = recordChanges();
    settings.bindKey('balloon', 0, 'KeyF');
    expect(calls).toEqual([{ keybindsChanged: true, muted: false }]);
    expect(settings.get().keybinds).not.toBe(before);
    expect(settings.get().keybinds.balloon).toEqual(['KeyF', 'KeyE']);
    settings.resetKeybinds();
    expect(calls).toHaveLength(2);
    expect(settings.get().keybinds.balloon).toEqual(['Space', 'KeyE']);
  });
});

describe('settings no-op writes', () => {
  it('does not notify when nothing changed (including clamped values)', () => {
    const { settings } = mod;
    const calls = recordChanges();
    settings.set({});
    settings.set({ muted: false, sfxVolume: 0.8 });
    settings.set({ musicVolume: 0.5 });
    expect(calls).toHaveLength(0);
    settings.set({ sfxVolume: 1 });
    settings.set({ sfxVolume: 7 });
    expect(calls).toHaveLength(1);
    expect(settings.get().sfxVolume).toBe(1);
  });
});

describe('settings shared between tabs', () => {
  it("adopts another tab's saved settings and notifies subscribers", async () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.resetModules();
    const { settings } = await import('../src/settings');
    const seen: boolean[] = [];
    settings.subscribe((next) => seen.push(next.muted));
    const other = { ...settings.get(), muted: true, musicVolume: 0.1 };
    const event = Object.assign(new Event('storage'), { key: 'splash.settings', newValue: JSON.stringify(other) });
    win.dispatchEvent(event);
    expect(settings.get()).toMatchObject({ muted: true, musicVolume: 0.1 });
    expect(seen).toEqual([true]);
    win.dispatchEvent(Object.assign(new Event('storage'), { key: 'splash.settings', newValue: '{not json' }));
    win.dispatchEvent(Object.assign(new Event('storage'), { key: 'other.key', newValue: '{}' }));
    expect(seen).toEqual([true]);
    vi.unstubAllGlobals();
  });
});
