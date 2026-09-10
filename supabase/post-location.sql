-- Location proof for photos (2026-09-11). Posting requires a fresh GPS fix at
-- the place; a post keeps when it was taken, how far the phone was from the
-- place, and how accurate the fix was — never the raw coordinates, since
-- posts are readable by everyone. Safe to run more than once.
alter table posts add column if not exists located_at         timestamptz;
alter table posts add column if not exists located_distance_m integer;
alter table posts add column if not exists located_accuracy_m integer;
