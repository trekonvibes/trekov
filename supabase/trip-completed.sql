-- Completed trips (Punit, 2026-09-21). Safe to run more than once.
-- Run after trip-visibility.sql.
--
-- A trip the host has marked done. It stays where it is — route, notes,
-- bookings, riders — and the app lists it under Completed without "Go live".
-- Null means still on. The app sends it with the rest of the trip (sync.js) and
-- carries on without it on a server that has not had this run.

alter table trips add column if not exists completed_at timestamptz;

-- A finished ride is not on offer. The app also makes a trip private when it is
-- completed; this covers a phone on an older version that did not.
create or replace function open_rides(p_limit integer default 30) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x), '[]'::json) from (
    select t.id, t.title, t.starts_on, t.ends_on,
           jsonb_array_length(t.stops) as stops,
           p.handle as host,
           (select count(*) from trip_members m where m.trip_id = t.id and m.status = 'accepted') as riders,
           (select pl.name from places pl where pl.id = (t.stops -> 0 ->> 'placeId')) as starts_at,
           (select pl.name from places pl where pl.id = (t.stops -> (jsonb_array_length(t.stops) - 1) ->> 'placeId')) as ends_at,
           coalesce((select m.status from trip_members m where m.trip_id = t.id and m.user_id = auth.uid()), 'none') as my_status
      from trips t join profiles p on p.id = t.owner_id
     where t.visibility = 'public'
       and t.completed_at is null
       and t.owner_id <> auth.uid()
       and jsonb_array_length(t.stops) > 0
     order by t.updated_at desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) x
$$;
revoke all on function open_rides(integer) from public, anon;
grant execute on function open_rides(integer) to authenticated;

notify pgrst, 'reload schema';
