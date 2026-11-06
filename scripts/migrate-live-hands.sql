-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Live hands: each live tournament gets a row in `tournaments` (platform 'live') so its hands
-- can be stored in `hands` and show up in the Dashboard, Visualizer, sharing, notes and study.
-- Also adds per-user notes on live opponents.
--
-- Safe / additive / idempotent: run it as many times as you like.

-- Link from a live tournament to its `tournaments` row
ALTER TABLE live_tournaments
  ADD COLUMN IF NOT EXISTS tournament_db_id uuid REFERENCES tournaments(id) ON DELETE SET NULL;

-- Notes on players met live (keyed by normalized name, one per user)
CREATE TABLE IF NOT EXISTS player_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  name_key    text NOT NULL,                 -- lower(trim(name))
  note        text NOT NULL DEFAULT '',
  last_venue  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name_key)
);

ALTER TABLE player_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "player_notes owner" ON player_notes;
CREATE POLICY "player_notes owner" ON player_notes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
