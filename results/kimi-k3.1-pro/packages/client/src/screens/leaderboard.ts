import type { GameMode } from "@splash/shared";
import { STR } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { background, button, centered, panel, text, truncate } from "./ui.js";
import { drawTierBadge } from "../render/hud.js";

interface LeaderboardRow {
  rank: number;
  playerId: string;
  nickname: string;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
}

let mode: GameMode = "duel";
let rows: LeaderboardRow[] = [];
let loading = false;
let offset = 0;

async function load(app: App): Promise<void> {
  loading = true;
  try {
    const response = await fetch(`/api/leaderboard?mode=${mode}`);
    const data = await response.json() as { players: LeaderboardRow[] };
    rows = data.players;
    offset = 0;
  } catch {
    rows = [];
    app.toastMessage(STR.unknownError);
  } finally {
    loading = false;
  }
}

export const leaderboardScreen: Screen = {
  enter(app) {
    app.audio.setTrack("menu");
    void load(app);
  },
  render(app, time) {
    background(app, time);
    centered(app, STR.rankedLeaderboard, 128, 9, "#f9dc5c", 12);
    button(app, "duel", STR.duel, 40, 29, 82, 15, () => { mode = "duel"; void load(app); }, { small: true, color: mode === "duel" ? "#56e39f" : undefined });
    button(app, "ffa", STR.ffa, 134, 29, 82, 15, () => { mode = "ffa"; void load(app); }, { small: true, color: mode === "ffa" ? "#56e39f" : undefined });
    text(app, STR.rank, 12, 50, "#8a96bd", 6);
    text(app, STR.nickname, 40, 50, "#8a96bd", 6);
    text(app, STR.rating, 141, 50, "#8a96bd", 6);
    text(app, STR.games, 190, 50, "#8a96bd", 6);
    if (loading) centered(app, STR.loading, 128, 105, "#8be9fd", 7);
    else if (rows.length === 0) centered(app, STR.noMatches, 128, 105, "#8a96bd", 8);
    rows.slice(offset, offset + 7).forEach((row, index) => {
      const y = 61 + index * 18;
      panel(app, 7, y, 242, 16, row.playerId === app.profile?.id ? "#29345d" : "#182142");
      text(app, String(row.rank), 14, y + 5, row.rank <= 3 ? "#f9dc5c" : "#8a96bd", 7);
      text(app, truncate(app, row.nickname, 86), 39, y + 5, "#f7f3d5", 7);
      text(app, String(row.rating), 137, y + 5, "#8be9fd", 7);
      drawTierBadge(app, row.tier, 169, y + 3, 38);
      text(app, `${row.games} / ${row.winrate}%`, 211, y + 5, "#8a96bd", 6);
      app.addHitRegion({ id: `leader-${row.playerId}`, x: 7, y, width: 242, height: 16, action: () => app.openProfile(row.playerId), disabled: false });
    });
    button(app, "prev", "▲", 8, 193, 28, 17, () => { offset = Math.max(0, offset - 7); }, { disabled: offset === 0 });
    button(app, "next", "▼", 40, 193, 28, 17, () => { offset = Math.min(Math.max(0, rows.length - 7), offset + 7); }, { disabled: offset + 7 >= rows.length });
    button(app, "refresh", STR.refresh, 74, 193, 82, 17, () => void load(app), { small: true });
    button(app, "back", STR.back, 162, 193, 86, 17, () => app.go("menu"), { small: true });
  },
  key(app, code) {
    if (code === "ArrowDown") offset = Math.min(Math.max(0, rows.length - 7), offset + 1);
    if (code === "ArrowUp") offset = Math.max(0, offset - 1);
    if (code === "Escape") app.go("menu");
    return true;
  }
};
