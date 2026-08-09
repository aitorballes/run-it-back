-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Adds an indexed column so "last N hands" can be answered with a single
-- ORDER BY ... LIMIT query instead of downloading the whole hand history.
--
-- Safe / additive: does not touch raw, hero_result, net, or any existing column.
--
-- Note: the Supabase SQL editor runs queries inside a transaction, so plain
-- CREATE INDEX is used here instead of CONCURRENTLY (which can't run inside one).
-- This briefly locks the table while the index builds — fine for this table's size.

ALTER TABLE hands ADD COLUMN IF NOT EXISTS hand_datetime timestamptz;

CREATE INDEX IF NOT EXISTS idx_hands_hand_datetime
  ON hands (hand_datetime DESC);

-- After this succeeds, backfill existing hands with:
--   node scripts/backfill-hand-datetime.mjs
