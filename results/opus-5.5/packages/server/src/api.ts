// REST API: GET /api/leaderboard?mode=duel|ffa (top 100) and GET /api/profile/:id.
// Responses are JSON, never cached; errors are {error, message}.
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import type { Mode } from '@splash/shared';
import { buildPublicProfile } from './accounts';
import { getLeaderboard, type Db } from './db';

const LEADERBOARD_SIZE = 100;
const PLAYER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isMode(value: unknown): value is Mode {
  return value === 'duel' || value === 'ffa';
}

function fail(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}

export function createApiRouter(db: Db): Router {
  const router = express.Router();

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /** Top players of a mode: LeaderboardEntry[] ordered by rank. */
  router.get('/leaderboard', (req, res) => {
    const mode = req.query.mode;
    if (!isMode(mode)) return fail(res, 400, 'bad_request', 'Query parameter "mode" must be "duel" or "ffa".');
    res.json(getLeaderboard(db, mode, LEADERBOARD_SIZE));
  });

  /** A player's public profile (ratings, recent matches, level, unlocks). */
  router.get('/profile/:id', (req, res) => {
    const id = req.params.id;
    const profile = PLAYER_ID_RE.test(id) ? buildPublicProfile(db, id) : null;
    if (!profile) return fail(res, 404, 'not_found', 'No player with that id.');
    res.json(profile);
  });

  router.use((_req, res) => fail(res, 404, 'not_found', 'Unknown API route.'));

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] request failed', err);
    fail(res, 500, 'server_error', 'Something went wrong.');
  });

  return router;
}
