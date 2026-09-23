// MusicDirector: owns the looping background track. Crossfades between tracks, runs the
// lookahead scheduler (a ~25 ms timer scheduling ~100 ms ahead on the AudioContext clock),
// applies the showdown tempo, and pauses cleanly while audio is not running or the tab is
// hidden. Requests made before audio is unlocked are remembered and start on unlock.
import type { AudioEngine } from './engine';
import { TrackPlayer } from './sequencer';
import { compileSong, type CompiledSong } from './song';
import { SONGS } from './tracks';
import type { MusicTrack, SongTrack } from './types';

const SCHEDULE_INTERVAL_MS = 25;
const LOOKAHEAD = 0.1;
const FADE_OUT = 0.45;
const FADE_IN = 0.12;
const START_DELAY = 0.06;

interface Current {
  track: SongTrack;
  song: CompiledSong;
  player: TrackPlayer;
}

export class MusicDirector {
  private desired: MusicTrack = 'none';
  private current: Current | null = null;
  private fading: TrackPlayer[] = [];
  private showdown = false;
  private active = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly compiled = new Map<SongTrack, CompiledSong>();

  constructor(private readonly engine: AudioEngine) {}

  /** Switch to `track` ('none' stops). A new track also clears the showdown flag. */
  play(track: MusicTrack): void {
    if (track === this.desired) return;
    this.desired = track;
    this.showdown = false;
    this.sync();
  }

  /** Speed the current track up to its showdown tempo (battle) or back to normal. */
  setShowdown(on: boolean): void {
    if (on === this.showdown) return;
    this.showdown = on;
    const cur = this.current;
    if (cur) cur.player.setTempoScale(this.tempoScale(cur.song));
  }

  /** Allow scheduling (audio running and tab visible) or pause it. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) {
      this.stopTimer();
      return;
    }
    this.sync();
    this.pump();
    this.ensureTimer();
  }

  private tempoScale(song: CompiledSong): number {
    return this.showdown ? song.showdownScale : 1;
  }

  private songFor(track: SongTrack): CompiledSong {
    let song = this.compiled.get(track);
    if (!song) {
      song = compileSong(SONGS[track]);
      this.compiled.set(track, song);
    }
    return song;
  }

  /** Make the playing track match the desired one (crossfade), if audio can play now. */
  private sync(): void {
    const ctx = this.engine.ctx;
    const bus = this.engine.musicBus;
    if (!this.active || !ctx || !bus) return;
    if ((this.current?.track ?? 'none') === this.desired) return;

    const now = ctx.currentTime;
    if (this.current) {
      this.current.player.fadeOut(now, FADE_OUT);
      this.fading.push(this.current.player);
      this.current = null;
    }
    if (this.desired !== 'none') {
      const song = this.songFor(this.desired);
      const player = new TrackPlayer(ctx, bus, song, now + START_DELAY, this.tempoScale(song));
      player.fadeIn(now, FADE_IN);
      this.current = { track: this.desired, song, player };
    }
    this.pump();
    this.ensureTimer();
  }

  /** One scheduler pass: fill the lookahead window and retire finished fade-outs. */
  private pump(): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.active) return;
    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    this.current?.player.schedule(now, horizon);
    this.fading = this.fading.filter((player) => {
      if (player.isFinished(now)) {
        player.dispose();
        return false;
      }
      player.schedule(now, horizon);
      return true;
    });
    if (!this.current && this.fading.length === 0) this.stopTimer();
  }

  private ensureTimer(): void {
    if (this.timer !== null || !this.active) return;
    if (!this.current && this.fading.length === 0) return;
    this.timer = setInterval(() => this.pump(), SCHEDULE_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
