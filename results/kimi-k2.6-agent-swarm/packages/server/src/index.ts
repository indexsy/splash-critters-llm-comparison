import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { ConnectionManager } from './net.js';
import { RoomManager } from './rooms.js';
import { Matchmaker } from './matchmaker.js';
import { GameLoop } from './gameLoop.js';
import type { ClientMsg, PlayerId, GameConfig, PlayerState } from '@splash-critters/shared';
import { getInitialPlayerState } from '@splash-critters/shared';
import {
  initDb,
  getPlayerByToken,
  createPlayer,
  getLeaderboard,
  getProfile,
  getRatings,
} from './db/queries.js';
import type { Profile } from '@splash-critters/shared';
import type { DatabaseInstance } from './db/queries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || './data';

export interface GameRoom {
  loop: GameLoop;
  playerIds: PlayerId[];
}

export default function startServer(): ReturnType<typeof createServer> {
  const db = initDb();
  const app = express();
  const server = createServer(app);

  const roomManager = new RoomManager();
  const matchmaker = new Matchmaker(roomManager);
  const activeGames = new Map<string, GameRoom>();

  // Matchmaker tick every 2s
  setInterval(() => {
    matchmaker.tick();
  }, 2000);

  // Room GC every 60s
  setInterval(() => {
    roomManager.gcIdleRooms();
  }, 60000);

  const connectionManager = new ConnectionManager({
    authenticate(token) {
      if (token) {
        const player = getPlayerByToken(db, token);
        if (player) {
          const profile: Profile = {
            playerId: String(player.id) as PlayerId,
            nickname: player.nickname || 'Guest',
            tag: player.tag || '0000',
            xp: player.xp,
            level: player.level,
            selectedAnimal: player.selected_animal as Profile['selectedAnimal'],
            selectedHat: player.selected_hat as Profile['selectedHat'],
          };
          return { playerId: profile.playerId, profile, token };
        }
      }
      const newToken = crypto.randomUUID();
      const { id, nickname, tag } = createPlayer(db, newToken);
      const profile: Profile = {
        playerId: String(id) as PlayerId,
        nickname,
        tag,
        xp: 0,
        level: 1,
        selectedAnimal: 'frog',
        selectedHat: 'none',
      };
      return { playerId: profile.playerId, profile, token: newToken };
    },
    onMessage(playerId: PlayerId, msg: ClientMsg) {
      handleClientMessage(playerId, msg);
    },
    onDisconnect(playerId: PlayerId) {
      handleDisconnect(playerId);
    },
    onReconnectTimeout(playerId: PlayerId) {
      handleReconnectTimeout(playerId);
    },
  });

  function handleClientMessage(playerId: PlayerId, msg: ClientMsg): void {
    switch (msg.type) {
      case 'queue_join': {
        const ratings = getRatings(db, Number(playerId));
        const rating = ratings.find((r) => r.mode === msg.mode)?.rating ?? 1000;
        matchmaker.queueJoin(playerId, msg.mode, rating);
        const status = matchmaker.getQueueStatus(playerId);
        connectionManager.sendTo(playerId, {
          type: 'queue_status',
          eta: status?.eta ?? 0,
          searchRange: status?.searchRange ?? 100,
        });
        break;
      }
      case 'queue_leave': {
        matchmaker.queueLeave(playerId);
        break;
      }
      case 'create_room': {
        const room = roomManager.createRoom({
          hostId: playerId,
          ...msg.opts,
        });
        connectionManager.sendTo(playerId, {
          type: 'room_created',
          code: room.code,
          lobby: room.getLobbyState(),
        });
        break;
      }
      case 'join_room': {
        const room = roomManager.joinRoom(msg.code, playerId);
        if (room) {
          broadcastRoomState(room.code);
        } else {
          connectionManager.sendTo(playerId, {
            type: 'error',
            code: 'ROOM_NOT_FOUND',
            msg: 'Room not found or full',
          });
        }
        break;
      }
      case 'leave_room': {
        const room = roomManager.getRoomByPlayer(playerId);
        if (room) {
          roomManager.leaveRoom(playerId);
          broadcastRoomState(room.code);
        }
        break;
      }
      case 'room_list_request': {
        const rooms = roomManager.getPublicRooms(msg.filter);
        connectionManager.sendTo(playerId, {
          type: 'room_list',
          rooms,
        });
        break;
      }
      case 'set_slot': {
        const room = roomManager.getRoomByPlayer(playerId);
        if (room && room.hostId === playerId) {
          room.setSlot(msg.slot, msg.kind, msg.difficulty);
          broadcastRoomState(room.code);
        }
        break;
      }
      case 'set_ready': {
        const room = roomManager.getRoomByPlayer(playerId);
        if (room) {
          room.setReady(playerId, msg.ready);
          broadcastRoomState(room.code);
        }
        break;
      }
      case 'start_match': {
        const room = roomManager.getRoomByPlayer(playerId);
        if (room && room.hostId === playerId) {
          const config = room.startMatch();
          if (config) {
            const playerIds = room.getPlayerIds();
            startGame(room.code, playerIds, config, db);
          }
        }
        break;
      }
      case 'input': {
        const game = findGameByPlayer(playerId);
        if (game) {
          const tick = msg.tick;
          game.loop.addInput(playerId, tick, {
            dir: msg.dir ?? null,
            balloonPressed: msg.balloonPressed,
          });
        }
        break;
      }
      case 'emote': {
        const game = findGameByPlayer(playerId);
        if (game) {
          const state = game.loop.roundState;
          if (state) {
            const player = state.players.find((p) => p.playerId === playerId);
            if (player && player.emoteCooldown <= 0) {
              // cooldown handled by sim
            }
          }
        }
        break;
      }
      case 'rematch_vote': {
        const room = roomManager.getRoomByPlayer(playerId);
        if (room) {
          room.voteRematch(playerId, msg.vote);
          if (room.state === 'waiting') {
            // Rematch started, start a new game
            const config = room.getGameConfig();
            const playerIds = room.getPlayerIds();
            startGame(room.code, playerIds, config, db);
          }
          broadcastRoomState(room.code);
        }
        break;
      }
      case 'set_nickname': {
        // TODO: validate nickname
        break;
      }
      default:
        break;
    }
  }

  function handleDisconnect(playerId: PlayerId): void {
    const room = roomManager.getRoomByPlayer(playerId);
    if (room) {
      room.handleDisconnect(playerId);
      broadcastRoomState(room.code);
    }
    matchmaker.queueLeave(playerId);
  }

  function handleReconnectTimeout(playerId: PlayerId): void {
    const room = roomManager.getRoomByPlayer(playerId);
    if (room) {
      room.handleReconnectTimeout(playerId);
      broadcastRoomState(room.code);
    }
  }

  function broadcastRoomState(code: string): void {
    const room = roomManager.getRoom(code);
    if (!room) return;
    const lobby = room.getLobbyState();
    for (const slot of room.slots) {
      if (slot.playerId) {
        connectionManager.sendTo(slot.playerId, {
          type: 'lobby_state',
          lobby,
        });
      }
    }
  }

  function findGameByPlayer(playerId: PlayerId): GameRoom | undefined {
    for (const game of activeGames.values()) {
      if (game.playerIds.includes(playerId)) {
        return game;
      }
    }
    return undefined;
  }

  function startGame(
    roomCode: string,
    playerIds: PlayerId[],
    config: GameConfig,
    db: DatabaseInstance
  ): void {
    const matchId = crypto.randomUUID();
    const loop = new GameLoop({
      matchId,
      matchConfig: config,
      db,
      ranked: false,
      playerIds,
    });

    activeGames.set(matchId, { loop, playerIds });

    // Create player states for round start
    const playerStates: PlayerState[] = playerIds.map((pid) =>
      getInitialPlayerState(pid, 'Player', 'frog', { x: 1, y: 1 })
    );

    // Send match_start to all players
    for (const id of playerIds) {
      connectionManager.sendTo(id, {
        type: 'match_start',
        config,
        players: playerIds.map((pid) => ({
          playerId: pid,
          nickname: 'Player',
          animal: 'frog',
          hat: 'none',
        })),
      });
    }

    // Start round 1
    const seed = Math.floor(Math.random() * 1e9);
    loop.startRound(1, seed, playerStates);

    // Start game tick loop
    const tickInterval = setInterval(() => {
      if (loop.matchEnded) {
        clearInterval(tickInterval);
        activeGames.delete(matchId);
        return;
      }

      loop.tick();

      // Send snapshot every 2 ticks (15Hz)
      if (loop.snapshotCounter % 2 === 0) {
        const snapshot = loop.getSnapshot();
        if (snapshot) {
          for (const id of playerIds) {
            connectionManager.sendTo(id, {
              type: 'snapshot',
              snapshot,
            });
          }
        }
      }

      // Send events
      if (loop.roundState && loop.roundState.events.length > 0) {
        for (const event of loop.roundState.events) {
          for (const id of playerIds) {
            connectionManager.sendTo(id, { type: 'event', event });
          }
        }
      }

      // Check if round ended
      if (loop.roundState && loop.roundState.ended) {
        const roundResult = loop.endRound();
        for (const id of playerIds) {
          connectionManager.sendTo(id, {
            type: 'round_end',
            winner: roundResult.winner,
            roundNo: loop.roundState?.roundNo ?? 0,
            scores: Object.fromEntries(loop.getScores()),
          });
        }

        if (loop.checkMatchEnd()) {
          const result = loop.getMatchResult();
          for (const id of playerIds) {
            connectionManager.sendTo(id, {
              type: 'match_end',
              result,
            });
          }
          // Transition room to rematch state
          const room = roomManager.getRoom(roomCode);
          if (room) {
            room.endMatch();
          }
        } else {
          // Start next round after a delay
          setTimeout(() => {
            const nextSeed = Math.floor(Math.random() * 1e9);
            const nextRoundNo = (loop.roundState?.roundNo ?? 0) + 1;
            const nextPlayers = playerIds.map((pid) =>
              getInitialPlayerState(pid, 'Player', 'frog', { x: 1, y: 1 })
            );
            loop.startRound(nextRoundNo, nextSeed, nextPlayers);
          }, 3000);
        }
      }
    }, 1000 / 30); // 30Hz
  }

  // Static files
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));

  // Health endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      players: connectionManager.getConnectionCount(),
      rooms: roomManager.getRoomCount(),
      games: activeGames.size,
    });
  });

  // REST API
  app.get('/api/leaderboard', (req, res) => {
    const mode = req.query.mode === 'ffa' ? 'ffa' : 'duel';
    const entries = getLeaderboard(db, mode, 100);
    res.json(entries);
  });

  app.get('/api/profile/:id', (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }
    const profile = getProfile(db, id);
    if (!profile) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(profile);
  });

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  // WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || 'unknown';
    connectionManager.handleConnection(ws, ip);
  });

  server.listen(PORT, () => {
    console.log(`Splash Critters server listening on port ${PORT}`);
    console.log(`DATA_DIR: ${DATA_DIR}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    for (const client of wss.clients) {
      client.close();
    }
    wss.close(() => {
      server.close(() => {
        console.log('HTTP server closed');
        db.close();
        process.exit(0);
      });
    });
  });

  return server;
}

// Auto-start if this module is the entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
