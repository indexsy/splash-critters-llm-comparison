import type {
  LeaderboardEntry,
  LobbyState,
  MatchConfig,
  MatchResult,
  Mode,
  Profile,
  RoomSummary,
  ServerMessage,
} from "@splash/shared";
import { animalDataUrl } from "./render/sprites.js";
export type Screen =
  | "title"
  | "menu"
  | "tutorial"
  | "browser"
  | "lobby"
  | "queue"
  | "game"
  | "results"
  | "leaderboard"
  | "locker"
  | "settings";
export interface Settings {
  sfx: number;
  music: number;
  muted: boolean;
  colorblind: boolean;
  reducedShake: boolean;
  bindings: Record<"up" | "down" | "left" | "right" | "balloon", string>;
}
export interface UIState {
  screen: Screen;
  profile: Profile | null;
  connection: string;
  lobby: LobbyState | null;
  rooms: RoomSummary[];
  queue: Extract<ServerMessage, { type: "queue_status" }> | null;
  match: MatchConfig | null;
  result: MatchResult | null;
  mode: Mode;
  leaderboard: LeaderboardEntry[];
  leaderboardLoading: boolean;
  settings: Settings;
  training: boolean;
  tutorialGoals: Set<string>;
}
export const escapeHtml = (v: unknown): string =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const icon = (name: string, size = 20): string => {
  const paths: Record<string, string> = {
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    trophy:
      '<path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v4a4 4 0 0 0 4 4m8-8h4v4a4 4 0 0 1-4 4m-4 1v6m-4 1h8"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
    sound:
      '<path d="m11 5-6 4H2v6h3l6 4Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    mute: '<path d="m11 5-6 4H2v6h3l6 4Zm5 4 6 6m0-6-6 6"/>',
    gear: '<path d="m10 2-1 3-3 1-3-1-1 4 2 3-1 3 3 3 3-1 3 2 3-2 3 1 3-3-1-3 2-3-1-4-3 1-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/>',
    shirt: '<path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0Z"/>',
    refresh:
      '<path d="M20 7v5h-5M4 17v-5h5m10-5A8 8 0 0 0 5 6m0 11a8 8 0 0 0 14 1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="1"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
    drop: '<path d="M12 2C9 7 5 10 5 15a7 7 0 0 0 14 0c0-5-4-8-7-13Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1"/>',
    bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${paths[name] ?? paths.drop}</svg>`;
};
export function portrait(
  animal = "frog",
  hat = "none",
  className = "",
): string {
  return `<img class="portrait ${className}" src="${animalDataUrl(animal as Parameters<typeof animalDataUrl>[0], hat as Parameters<typeof animalDataUrl>[1])}" alt="${escapeHtml(animal)}" draggable="false">`;
}
export const button = (
  label: string,
  action: string,
  style = "primary",
  extra = "",
): string =>
  `<button class="button ${style}" data-action="${action}" ${extra}>${label}</button>`;
export const themeName = (theme: string): string =>
  ({
    backyard: "Backyard",
    beach: "Beach",
    pool: "Pool Party",
    random: "Surprise me",
  })[theme] ?? theme;
export function pageHeading(
  eyebrow: string,
  title: string,
  description: string,
  action = "",
): string {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
