-- The captain can change the plan (Punit, 2026-09-21). Safe to run more than once.
-- Run after trip-roles.sql.
--
-- On a group or public trip, only the host and the captain may change its
-- name, dates, notes, itinerary and bookings; every other rider sees it as it is.
--
-- The host already writes the trip row (write_own_trip). The captain gets this
-- one function rather than a looser policy, so a captain can change the plan
-- and nothing else: not the owner, not who the captain is, not whether the
-- trip is public.

-- The first version had no bookings; it is replaced, not kept alongside.
drop function if exists edit_trip_as_captain(text, text, date, date, text, jsonb);

create or replace function edit_trip_as_captain(
  p_trip text, p_title text, p_starts date, p_ends date, p_notes text, p_stops jsonb,
  p_bookings jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  t trips;
begin
  select * into t from trips where id = p_trip for update;
  if not found then
    raise exception 'no_trip';
  end if;
  -- The named captain, still an accepted rider (trips_captain_guard keeps the
  -- captain on the trip; checked again here in case that changed mid-edit).
  if t.captain_id is null or t.captain_id <> auth.uid() or t.owner_id = auth.uid()
     or not is_trip_member(t.id, auth.uid()) then
    raise exception 'not_captain';
  end if;
  if not can_write() then
    raise exception 'read_only';
  end if;
  if jsonb_typeof(coalesce(p_stops, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_stops, '[]'::jsonb)) > 100 then
    raise exception 'bad_stops';
  end if;
  if p_bookings is not null and (jsonb_typeof(p_bookings) <> 'array' or jsonb_array_length(p_bookings) > 100) then
    raise exception 'bad_bookings';
  end if;

  update trips set
    title = left(coalesce(nullif(trim(p_title), ''), 'Untitled trip'), 120),
    starts_on = p_starts,
    ends_on = p_ends,
    notes = left(coalesce(p_notes, ''), 10000),
    stops = coalesce(p_stops, '[]'::jsonb),
    -- Left as it is when an older app doesn't send them.
    bookings = coalesce(p_bookings, bookings),
    updated_at = now()
  where id = p_trip;
end $$;

revoke all on function edit_trip_as_captain(text, text, date, date, text, jsonb, jsonb) from public, anon;
grant execute on function edit_trip_as_captain(text, text, date, date, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
