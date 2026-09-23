// A socket drop without a page reload keeps the MatchState; the server re-attaches with
// match_start (same match), the current round and player_status for every other seat that is
// still offline, bot-played or forfeited. A seat that came back while we were away is not
// mentioned, so a connection status kept from before the drop would show a live opponent as
// disconnected ("DC" chip) for the rest of the match.
import { describe, expect, it } from 'vitest';
import type { SlotStatus } from '../src/game/scene';
import { START, ffaConfig, matchInRound, roundStartFor } from './match-fixtures';

const OFFLINE: SlotStatus = { connected: false, replacedByBot: false, forfeited: false };
const BOT_PLAYED: SlotStatus = { connected: false, replacedByBot: true, forfeited: false };
const FORFEITED: SlotStatus = { connected: false, replacedByBot: false, forfeited: true };

describe('re-attach to the same match', () => {
  it('forgets connection states from before the drop, keeps forfeits and bot take-overs', () => {
    const config = ffaConfig();
    const m = matchInRound(config, roundStartFor(config));
    // Seen before our own socket dropped: slot 1 went offline, 2 was taken over, 3 forfeited.
    m.setStatus(1, OFFLINE);
    m.setStatus(2, BOT_PLAYED);
    m.setStatus(3, FORFEITED);
    // Slot 1 came back while we were away; the server's broadcast of that never reached us.
    m.startMatch(config, 60_000);
    m.startRound(roundStartFor(config, { resumeTick: 900 }), START + 30_000);
    // The table status the server sends next only names seats still away.
    m.setStatus(2, BOT_PLAYED);
    m.setStatus(3, FORFEITED);
    expect(m.status.has(1)).toBe(false);
    expect(m.status.get(2)).toEqual(BOT_PLAYED);
    expect(m.status.get(3)).toEqual(FORFEITED);
    expect(m.predicted!.players.map((p) => p.present)).toEqual([true, true, true, false]);
  });

  it('a seat still offline is marked again by the re-sent table status', () => {
    const config = ffaConfig();
    const m = matchInRound(config, roundStartFor(config));
    m.setStatus(1, OFFLINE);
    m.startMatch(config, 60_000);
    m.setStatus(1, OFFLINE);
    expect(m.status.get(1)).toEqual(OFFLINE);
  });

  it('a forfeit known before the drop still decides the verdict of a replayed final round_end', () => {
    const config = ffaConfig();
    const m = matchInRound(config, roundStartFor(config));
    m.setStatus(3, FORFEITED);
    m.startMatch(config, 60_000);
    // Between rounds the re-sync replays the last round_end before any player_status.
    m.endRound({ type: 'round_end', roundNo: 5, winner: 1, scores: [1, 2, 0, 3], summaries: [], matchOver: true }, 61_000);
    expect(m.result!.verdict).toEqual({ kind: 'winner', slot: 1 });
  });

  it('a new match starts with no status at all', () => {
    const config = ffaConfig();
    const m = matchInRound(config, roundStartFor(config));
    m.setStatus(3, FORFEITED);
    m.startMatch({ ...config, matchId: 'm-2' }, 60_000);
    expect(m.status.size).toBe(0);
  });
});
