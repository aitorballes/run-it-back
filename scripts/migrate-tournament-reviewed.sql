-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Adds the "marcar como revisado" flag for tournaments.
--
-- Safe / additive: does not touch any existing column.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS reviewed boolean NOT NULL DEFAULT false;
