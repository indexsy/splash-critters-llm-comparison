/**
 * Turning sim events into things you can see and hear.
 *
 * The match screen owns the world; this owns the reaction to it. Every case is
 * one event in, one burst of feedback out, which keeps the audio-visual polish
 * in a single readable table instead of scattered through the frame loop.
 */

import { animalDef, type MatchPlayerInfo, type PlayerSoakedEvent, type SimEvent } from '@splash/shared';
import { playChain, playEmote, playSfx } from '../audio';
import { Announcer, KillFeed, Shaker } from '../render/hud';
import { ParticleField } from '../render/particles';
import { SLOT_COLORS, UI } from '../render/palette';
import type { RenderState } from '../render/world';

/** Kill-feed lines share the stage with the HUD, so names are kept short. */
const FEED_NAME_CHARS = 10;

export function feedName(roster: MatchPlayerInfo[], slot: number): string {
  const info = roster.find((p) => p.slot === slot);
  if (info === undefined) return 'Critter';
  return info.nickname.length > FEED_NAME_CHARS
    ? `${info.nickname.slice(0, FEED_NAME_CHARS - 1)}.`
    : info.nickname;
}

export function slotColor(slot: number): string {
  const count = SLOT_COLORS.length;
  return SLOT_COLORS[((Math.floor(slot) % count) + count) % count];
}

function chainText(count: number): string {
  if (count === 2) return 'Double splash!';
  if (count === 3) return 'Triple splash!';
  return `${count}x splash!!`;
}

export interface MatchFeedbackDeps {
  particles: ParticleField;
  feed: KillFeed;
  announcer: Announcer;
  shaker: Shaker;
  /** The match roster, empty until match_start lands. */
  roster(): MatchPlayerInfo[];
  /** The frame last drawn, for events that carry an id but no position. */
  scene(): RenderState | null;
  /** A soak has landed and the world should stop dead for a moment. */
  onHitStop(): void;
}

export interface MatchFeedback {
  handle(ev: SimEvent): void;
}

export function createMatchFeedback(deps: MatchFeedbackDeps): MatchFeedback {
  function onSoaked(ev: PlayerSoakedEvent): void {
    playSfx('soak');
    deps.particles.burst(ev.x, ev.y, 'soak');
    deps.shaker.kick(5);
    deps.onHitStop();

    const roster = deps.roster();
    const victim = feedName(roster, ev.playerId);
    if (ev.byTide) {
      deps.feed.push(`${victim} was washed away by the tide`, UI.danger);
      return;
    }
    if (ev.byPlayerId === ev.playerId) {
      deps.feed.push(`${victim} soaked themselves!`, slotColor(ev.playerId));
      return;
    }
    deps.feed.push(`${feedName(roster, ev.byPlayerId)} soaked ${victim}!`, slotColor(ev.byPlayerId));
  }

  return {
    handle(ev: SimEvent): void {
      switch (ev.kind) {
        case 'balloon_placed':
          playSfx('drop');
          break;
        case 'castle_washed':
          deps.particles.burst(ev.x + 0.5, ev.y + 0.5, 'castle');
          break;
        case 'balloon_burst':
          playSfx('burst');
          deps.particles.burst(ev.x + 0.5, ev.y + 0.5, 'splash');
          deps.shaker.kick(2);
          break;
        case 'chain_burst':
          playChain(ev.count);
          deps.announcer.show(chainText(ev.count), UI.water, 1200, 2);
          deps.shaker.kick(2 + ev.count);
          break;
        case 'player_soaked':
          onSoaked(ev);
          break;
        case 'powerup_collected': {
          playSfx('pickup');
          // The event names the collector, not the tile, so the sparkle follows
          // whoever picked it up rather than where the power-up used to sit.
          const who = deps.scene()?.players.find((p) => p.slot === ev.playerId);
          if (who) deps.particles.burst(who.x, who.y, 'pickup');
          break;
        }
        case 'balloon_kicked': {
          playSfx('kick');
          const balloon = deps.scene()?.balloons.find((b) => b.id === ev.id);
          if (balloon) deps.particles.burst(balloon.x, balloon.y, 'kick');
          break;
        }
        case 'tide_warning':
          playSfx('tide');
          deps.announcer.show('Rising tide!', UI.danger, 1600, 2);
          break;
        case 'revenge_lob':
          playSfx('lob');
          break;
        case 'emote': {
          const info = deps.roster().find((p) => p.slot === ev.playerId);
          if (info) playEmote(animalDef(info.animal).voice);
          break;
        }
        default:
          break;
      }
    },
  };
}
