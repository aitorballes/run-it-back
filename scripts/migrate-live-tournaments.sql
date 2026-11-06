-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Live tournaments: tournaments played in a casino/club, tracked by hand from the phone.
--
-- Safe / additive: creates a new table, does not touch existing ones.

CREATE TABLE IF NOT EXISTS live_tournaments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue            text NOT NULL,                       -- casino / club
  name             text NOT NULL,
  buyin            numeric(12,2) NOT NULL DEFAULT 0,
  currency         text NOT NULL DEFAULT '€',
  level_minutes    integer NOT NULL DEFAULT 20 CHECK (level_minutes > 0),
  starting_stack   integer NOT NULL DEFAULT 0 CHECK (starting_stack >= 0),
  -- [{ sb, bb, ante }, ...] — level N is structure[N-1]; editable because every tournament differs
  structure        jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_level    integer NOT NULL DEFAULT 1 CHECK (current_level >= 1),
  level_ends_at    timestamptz,                         -- clock running: when the current level ends
  paused_remaining integer,                             -- clock paused: seconds left in the level
  my_stack         integer,
  entries          integer,                             -- total entries (incl. re-entries)
  players_left     integer,
  -- [{ at, level, stack, players, entries }, ...] — one row per update, for the stack history
  history          jsonb NOT NULL DEFAULT '[]'::jsonb,
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished')),
  finish_position  integer,
  prize_won        numeric(12,2),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_tournaments_user_idx ON live_tournaments (user_id, created_at DESC);

ALTER TABLE live_tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_tournaments owner" ON live_tournaments;
CREATE POLICY "live_tournaments owner" ON live_tournaments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Multi-day tournaments and breaks (added later — run these two lines if the table already exists).
-- Breaks themselves live in `structure`: a level with { breakAfter: minutes } is followed by a break.
ALTER TABLE live_tournaments ADD COLUMN IF NOT EXISTS day      integer NOT NULL DEFAULT 1;
ALTER TABLE live_tournaments ADD COLUMN IF NOT EXISTS on_break boolean NOT NULL DEFAULT false;
