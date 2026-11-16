-- Paid places of a live tournament, to show how far you are from the money (bubble / ITM).
-- Run once in the Supabase SQL editor. Safe to re-run.
ALTER TABLE live_tournaments ADD COLUMN IF NOT EXISTS paid_places integer CHECK (paid_places IS NULL OR paid_places >= 0);
