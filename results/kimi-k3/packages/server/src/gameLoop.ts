import { CONFIG, InputFrame, simulateTick } from '@splash/shared';
import { RoomManager } from './rooms.js';

export function startGameLoop(rooms: RoomManager): void {
  const tickMs = 1000 / CONFIG.TICK_RATE;
  let counter = 0;
  setInterval(() => {
    counter++;
    rooms.tickAll((room, inputs) => {
      const state = room.state!;
      for (let i = 0; i < room.slots.length; i++) {
        const s = room.slots[i]!;
        if (s.kind === 'bot' && s.bot && state.players[i]) {
          inputs.set(i, s.bot.nextInput(state));
        }
      }
      const frames = new Map<number, InputFrame>();
      for (const [slot, inp] of inputs) {
        const lastSeq = room.lastAppliedSeq.get(slot) ?? 0;
        frames.set(slot, { seq: inp.seq, dir: inp.dir, balloon: inp.balloon && inp.seq !== lastSeq });
        room.lastAppliedSeq.set(slot, inp.seq);
      }
      simulateTick(state, frames);

      if (state.roundNo !== room.lastBroadcastRound) {
        room.lastBroadcastRound = state.roundNo;
        room.destroyedCastles = [];
        room.sendAll({
          t: 'round_start',
          roundNo: state.roundNo,
          mapSeed: room.mapSeed,
          castleGrid: [...state.tiles],
          theme: room.theme,
        });
      }
      room.handleEvents(state.events);
      if (counter % Math.round(CONFIG.TICK_RATE / CONFIG.SNAPSHOT_RATE) === 0 && room.phase === 'playing') {
        room.sendAll({ t: 'snapshot', s: room.buildSnapshot() });
      }
    });
  }, tickMs);

  setInterval(() => rooms.gc(), 60_000);
}
