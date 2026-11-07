-- Player notes belong to a live tournament instead of being global per user.
-- Run once in the Supabase SQL editor (after migrate-live-hands.sql). Safe to re-run.

ALTER TABLE player_notes
  ADD COLUMN IF NOT EXISTS live_tournament_id uuid REFERENCES live_tournaments(id) ON DELETE CASCADE;

-- One note per player name *within each tournament* (was: one per user and name)
ALTER TABLE player_notes DROP CONSTRAINT IF EXISTS player_notes_user_id_name_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS player_notes_tournament_name_idx ON player_notes (live_tournament_id, name_key);

-- Old global notes (no tournament) are no longer shown anywhere. Uncomment to remove them:
-- DELETE FROM player_notes WHERE live_tournament_id IS NULL;
