-- Host and captain on a group trip (Punit, 2026-09-12). Safe to run more than once.
-- Run after trip-invites.sql.
--
-- The HOST is the trip's owner: the one who made it. Only the host invites
-- riders, removes them (manage_members in schema.sql) and names the captain.
-- The CAPTAIN is the rider who leads on the road — the host, or any rider who
-- has accepted. It lives on the trip so every phone shows the same captain,
-- and it clears itself if that rider leaves or is taken off the trip.

alter table trips add column if not exists captain_id uuid references profiles(id) on delete set null;

-- The captain has to be on the trip. (On INSERT the trip isn't in the table
-- yet, so the host is checked against the new row rather than is_trip_member.)
create or replace function trips_captain_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.captain_id is not null
     and new.captain_id <> new.owner_id
     and not is_trip_member(new.id, new.captain_id) then
    raise exception 'The captain has to be the host or a rider who has accepted.';
  end if;
  return new;
end $$;
drop trigger if exists trips_captain_guard on trips;
create trigger trips_captain_guard before insert or update on trips
  for each row execute function trips_captain_guard();

-- Taken off the trip (or left it): the trip has no captain again.
create or replace function trip_members_captain_gone() returns trigger
language plpgsql set search_path = public as $$
begin
  update trips set captain_id = null where id = old.trip_id and captain_id = old.user_id;
  return old;
end $$;
drop trigger if exists trip_members_captain_gone on trip_members;
create trigger trip_members_captain_gone after delete on trip_members
  for each row execute function trip_members_captain_gone();

notify pgrst, 'reload schema';
