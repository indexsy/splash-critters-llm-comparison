// Lobby choreography shared by flows: a private 2-player casual room that host A opens, B joins
// and readies, and A starts.
import type { Msg, WsClient } from './client';

export async function startCasualDuel(a: WsClient, b: WsClient, name: string): Promise<Msg<'match_start'>> {
  a.send({ type: 'create_room', opts: { name, size: 2, isPublic: false, theme: 'backyard', roundsToWin: 3, botFill: false } });
  const { code } = await a.take('room_created');
  b.send({ type: 'join_room', code });
  await b.take('lobby_state', (m) => m.lobby.code === code);
  b.send({ type: 'set_ready', ready: true });
  await a.take('lobby_state', (m) => m.lobby.slots[1].ready);
  a.send({ type: 'start_match' });
  const [start] = await Promise.all([a.take('match_start'), b.take('match_start')]);
  return start;
}
