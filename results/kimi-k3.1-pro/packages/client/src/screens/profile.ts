import { tierFor } from "@splash/shared";
import type { PlayerProfile, RatingInfo } from "@splash/shared";
import { STR } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { background, button, centered, panel, text, xpBar } from "./ui.js";
import { drawAnimal } from "../render/sprites.js";
import { drawTierBadge } from "../render/hud.js";

interface ProfileData {
  profile: PlayerProfile;
  ratings: RatingInfo[];
  recentMatches: { matchId: string; mode: string; ranked: boolean; endedAt: number; placement: number; soaks: number; roundsWon: number; ratingBefore: number | null; ratingAfter: number | null; xpEarned: number }[];
}

let data: ProfileData | null = null;
let loading = false;

async function load(app: App): Promise<void> {
  loading = true;
  data = null;
  try {
    const response = await fetch(`/api/profile/${app.profileViewId}`);
    if (!response.ok) throw new Error("Not found");
    data = await response.json() as ProfileData;
  } catch {
    app.toastMessage(STR.emptyProfile);
  } finally {
    loading = false;
  }
}

export const profileScreen: Screen = {
  enter(app) {
    void load(app);
  },
  render(app, time) {
    background(app, time);
    if (loading) centered(app, STR.loading, 128, 100, "#8be9fd", 8);
    if (!data && !loading) centered(app, STR.emptyProfile, 128, 100, "#8a96bd", 8);
    if (data) {
      const profile = data.profile;
      panel(app, 8, 8, 240, 44);
      drawAnimal(app.canvas, profile.selectedAnimal, 29, 31, Math.floor(time / 180) % 2, profile.selectedHat, "down", false, 28);
      text(app, `${profile.nickname}#${profile.tag}`, 52, 13, "#f9dc5c", 10);
      text(app, `${STR.level} ${profile.level} • ${profile.xp} ${STR.xp} • ${profile.unlocks.length} ${STR.locker}`, 52, 29, "#8be9fd", 7);
      xpBar(app, 52, 41, 185, profile.xp, profile.level);
      data.ratings.forEach((rating, index) => {
        const x = 8 + index * 124;
        panel(app, x, 58, 116, 37);
        text(app, rating.mode === "duel" ? STR.duel : STR.ffa, x + 8, 64, "#8a96bd", 7);
        text(app, String(rating.rating), x + 8, 76, "#f9dc5c", 12);
        drawTierBadge(app, tierFor(rating.rating), x + 64, 65, 43);
        text(app, `${rating.wins}/${rating.games} ${STR.wins} • ${STR.rank} ${rating.peak}`, x + 8, 88, "#8a96bd", 6);
      });
      text(app, STR.recentMatches, 10, 105, "#f9dc5c", 8);
      if (data.recentMatches.length === 0) centered(app, STR.noMatches, 128, 139, "#8a96bd", 7);
      data.recentMatches.slice(0, 4).forEach((match, index) => {
        const y = 118 + index * 17;
        panel(app, 8, y, 240, 15);
        text(app, `#${match.placement} ${match.mode.toUpperCase()} ${match.ranked ? STR.rankedOnly : STR.casualOnly}`, 14, y + 4, match.placement === 1 ? "#56e39f" : "#f7f3d5", 6);
        text(app, `${match.roundsWon}★ ${match.soaks} ${STR.soaks}`, 124, y + 4, "#8a96bd", 6);
        if (match.ratingBefore !== null) text(app, `${match.ratingBefore}→${match.ratingAfter}`, 199, y + 4, "#8be9fd", 6);
        else text(app, `+${match.xpEarned}${STR.xp}`, 207, y + 4, "#56e39f", 6);
      });
    }
    button(app, "back", STR.back, 85, 193, 86, 18, () => app.go(app.profileReturn), { small: true });
  },
  key(app, code) {
    if (code === "Escape") app.go(app.profileReturn);
    return true;
  }
};
