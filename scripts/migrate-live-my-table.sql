-- "My table": the tables you sit at in a live tournament, and where each player with a note sits.
-- Run once in the Supabase SQL editor (after migrate-player-notes-per-tournament.sql). Safe to re-run.

-- Tables you've played at, oldest first; the last one is where you are now: [{ no, seats, mySeat, at }]
ALTER TABLE live_tournaments ADD COLUMN IF NOT EXISTS tables jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Table number and seat of each player note (both optional)
ALTER TABLE player_notes ADD COLUMN IF NOT EXISTS table_no int;
ALTER TABLE player_notes ADD COLUMN IF NOT EXISTS seat int;
