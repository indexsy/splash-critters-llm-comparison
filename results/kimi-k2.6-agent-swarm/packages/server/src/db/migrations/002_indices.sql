-- Migration 002: Performance indices
CREATE INDEX IF NOT EXISTS players_token_hash ON players(token_hash);
CREATE INDEX IF NOT EXISTS ratings_mode_rating ON ratings(mode, rating DESC);
CREATE INDEX IF NOT EXISTS match_players_match_id ON match_players(match_id);
CREATE INDEX IF NOT EXISTS match_players_player_id ON match_players(player_id);
