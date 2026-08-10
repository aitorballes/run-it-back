-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Adds the columns needed for EVERY "Estudia tu juego" filter to run as one Postgres
-- query, instead of downloading the hand history and filtering it in the browser.
--
-- Safe / additive: does not touch raw, hero_result, net, or any existing column.

ALTER TABLE hands
  ADD COLUMN IF NOT EXISTS preflop_raise_count smallint,
  ADD COLUMN IF NOT EXISTS preflop_clean       boolean,
  ADD COLUMN IF NOT EXISTS preflop_limped      boolean,
  ADD COLUMN IF NOT EXISTS pos_vs_field        text,
  ADD COLUMN IF NOT EXISTS bb_folded           boolean,
  ADD COLUMN IF NOT EXISTS hero_stack_bb       numeric,
  ADD COLUMN IF NOT EXISTS flop_players_count  smallint,
  ADD COLUMN IF NOT EXISTS hero_folded_preflop boolean;

-- hero_pos and pfr already existed, but weren't indexed — needed now that they're
-- actually used to filter, not just to display stats.
CREATE INDEX IF NOT EXISTS idx_hands_hero_pos ON hands (hero_pos);
CREATE INDEX IF NOT EXISTS idx_hands_pfr      ON hands (pfr);

-- After this succeeds, backfill existing hands with:
--   node scripts/backfill-study-columns.mjs
