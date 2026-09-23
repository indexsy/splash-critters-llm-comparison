// Result presentation: the match verdict, the result card headline (and its fit inside the
// card) and the kill feed's name clipping. Pure text and font metrics, no canvas.
import { describe, expect, it } from 'vitest';
import { clip, headlineText, roundCardHeadline } from '../src/game/labels';
import { verdictFromPlacements, verdictFromScores, type MatchVerdict } from '../src/game/verdict';
import { feedSpanText } from '../src/render/killfeed';
import { headlineLines, labelWidth } from '../src/render/textFit';

const NAMES = ['DUCKYDAN', 'SPLASHMASTER9000', 'CAPY', 'OTTERLY'];
const nameOf = (slot: number) => NAMES[slot];
/** Room for the headline beside the winner's critter on the 184 px result card. */
const TITLE_W = 184 - 44 - 4;

const final = (winner: number, verdict: MatchVerdict | null) => ({ winner, matchOver: true, verdict });
const round = (winner: number) => ({ winner, matchOver: false, verdict: null });

describe('match verdict', () => {
  it('a unique top round-win count among the contenders wins', () => {
    expect(verdictFromScores([4, 1, 3, 2], [0, 1, 2, 3])).toEqual({ kind: 'winner', slot: 0 });
    expect(verdictFromScores([4, 1, 3, 2], [1, 2, 3])).toEqual({ kind: 'winner', slot: 2 });
    expect(verdictFromScores([3, 3, 1, 0], [0, 1, 2, 3])).toEqual({ kind: 'pending' });
    expect(verdictFromScores([1, 1], [])).toEqual({ kind: 'pending' });
  });

  it('placements settle ties: one 1st wins, shared 1st is a tie (a draw when everyone shares it)', () => {
    expect(verdictFromPlacements([{ slot: 1, placement: 1 }, { slot: 0, placement: 2 }])).toEqual({ kind: 'winner', slot: 1 });
    const ffa = [{ slot: 0, placement: 1 }, { slot: 2, placement: 1 }, { slot: 1, placement: 3 }];
    expect(verdictFromPlacements(ffa)).toEqual({ kind: 'shared', slots: [0, 2], all: false });
    const duel = [{ slot: 0, placement: 1 }, { slot: 1, placement: 1 }];
    expect(verdictFromPlacements(duel)).toEqual({ kind: 'shared', slots: [0, 1], all: true });
  });
});

describe('result headline', () => {
  it('rounds name the round winner', () => {
    expect(headlineText(roundCardHeadline(round(0), 0, nameOf))).toBe('YOU WIN THE ROUND!');
    expect(headlineText(roundCardHeadline(round(2), 0, nameOf))).toBe('CAPY WINS!');
    expect(roundCardHeadline(round(-1), 0, nameOf)).toMatchObject({ hero: -1, rest: 'DRAW!', tone: 'neutral' });
  });

  it('the final round names the match winner, who need not have won that round', () => {
    const h = roundCardHeadline(final(1, { kind: 'winner', slot: 3 }), 0, nameOf);
    expect(h).toMatchObject({ hero: 3, name: 'OTTERLY', rest: 'WINS THE MATCH!', tone: 'theirs' });
    expect(roundCardHeadline(final(-1, { kind: 'winner', slot: 0 }), 0, nameOf)).toMatchObject({ hero: 0, rest: 'YOU WIN THE MATCH!', tone: 'mine' });
  });

  it('shared and pending verdicts', () => {
    expect(headlineText(roundCardHeadline(final(0, { kind: 'shared', slots: [0, 1], all: true }), 0, nameOf))).toBe('MATCH DRAWN!');
    expect(roundCardHeadline(final(0, { kind: 'shared', slots: [0, 2], all: false }), 0, nameOf)).toMatchObject({ rest: 'YOU TIE FOR 1ST!', tone: 'mine' });
    expect(headlineText(roundCardHeadline(final(0, { kind: 'shared', slots: [1, 2], all: false }), 0, nameOf))).toBe('TIED FOR 1ST!');
    // Tied on round wins until match_end: the card shows the final round's own result.
    expect(headlineText(roundCardHeadline(final(2, { kind: 'pending' }), 0, nameOf))).toBe('CAPY WINS!');
  });

  it('fits beside the critter: a long winner name takes its own line, nothing is wider than the slot', () => {
    const long = roundCardHeadline(final(1, { kind: 'winner', slot: 1 }), 0, nameOf);
    expect(labelWidth(headlineText(long))).toBeGreaterThan(TITLE_W); // the reviewer's overflow case
    const lines = headlineLines(long, TITLE_W);
    expect(lines).toEqual(['SPLASHMASTER9000', 'WINS THE MATCH!']);
    for (const line of lines) expect(labelWidth(line)).toBeLessThanOrEqual(TITLE_W);
    expect(headlineLines(roundCardHeadline(final(1, { kind: 'winner', slot: 2 }), 0, nameOf), TITLE_W)).toEqual(['CAPY WINS THE MATCH!']);
    const huge = headlineLines({ hero: 1, name: 'W'.repeat(40), rest: 'WINS THE MATCH!', tone: 'theirs' }, TITLE_W);
    expect(huge[0].endsWith('.')).toBe(true);
    expect(labelWidth(huge[0])).toBeLessThanOrEqual(TITLE_W);
  });
});

describe('kill feed names', () => {
  it('clips long names with the same "." mark as the HUD, never mid-space', () => {
    expect(feedSpanText('Bot OtterLord', 1)).toBe('Bot Otter.');
    expect(feedSpanText('Bot Ottr Lordy', 1)).toBe('Bot Ottr.');
    expect(feedSpanText('DuckyDan', 0)).toBe('DuckyDan');
    expect(feedSpanText(' got washed away by the tide!', null)).toBe(' got washed away by the tide!');
    expect(clip('SPLASHMASTER', 5)).toBe('SPLA.');
  });
});
