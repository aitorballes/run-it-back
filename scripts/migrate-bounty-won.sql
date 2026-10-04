-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Adds bounty winnings (KO tournaments) separately from the finishing prize.
--
-- Safe / additive: does not touch any existing column.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS bounty_won numeric;
