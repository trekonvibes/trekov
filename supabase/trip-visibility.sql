-- Public group trips (Punit, 2026-09-12). Safe to run more than once.
-- Run after trip-invites.sql and trip-roles.sql.
--
-- Private is the default and means what it always did: only the host and the
-- riders they invited can see the trip at all.
--
-- Public means other riders can FIND it — title, dates, where it starts and
-- ends, how many are going — and ask to join. It does not open the trip up:
-- notes, bookings, live positions and voice stay with the people on it, and the
-- host approves every rider. That is why the listing comes from open_rides()
-- rather than from loosening the trips table: a stranger never reads the row.

alter table trips add column if not exists visibility text not null default 'private';
alter table trips drop constraint if exists trips_visibility_check;
alter table trips add constraint trips_visibility_check check (visibility in ('private', 'public'));
create index if not exists trips_public_idx on trips (updated_at desc) where visibility = 'public';

-- A rider who asked to come along, waiting on the host: 'requested' is the
-- mirror of 'pending' (which means the host asked and the rider hasn't answered).
alter table trip_members drop constraint if exists trip_members_status_check;
alter table trip_members add constraint trip_members_status_check
  check (status in ('pending', 'accepted', 'declined', 'requested'));

-- Same guard as trip-invites.sql, with two additions: a rider may put
-- themselves down as 'requested' on a public trip (through request_to_join,
-- which sets trekov.joining), and the host may answer such a request.
create or replace function trip_members_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;                                   -- dashboard / service role
  end if;
  if tg_op = 'INSERT' then
    if coalesce(current_setting('trekov.joining', true), '') = 'on' and new.user_id = auth.uid() then
      new.status := 'requested';
      new.invited_by := null;                     -- nobody invited them; they asked
      new.invited_at := now();
      new.responded_at := null;
      return new;
    end if;
    new.status := 'pending';
    new.invited_by := auth.uid();
    new.invited_at := now();
    new.responded_at := null;
  elsif auth.uid() = old.user_id then
    -- The rider answers an invite the host sent. A request they made
    -- themselves is not theirs to accept — that is the host's answer — so only
    -- a 'pending' row can be answered here; they can still withdraw by leaving.
    if old.status = 'pending' and new.status in ('accepted', 'declined') then
      new.status := new.status;
    else
      new.status := old.status;
    end if;
    new.trip_id := old.trip_id;
    new.user_id := old.user_id;
    new.invited_by := old.invited_by;
    new.invited_at := old.invited_at;
    new.responded_at := now();
  else
    -- The host. They can answer a request, or resend an invite; an accepted
    -- rider stays accepted.
    new.trip_id := old.trip_id;
    new.user_id := old.user_id;
    if old.status = 'accepted' then
      new.status := 'accepted';
      new.invited_by := old.invited_by;
      new.invited_at := old.invited_at;
      new.responded_at := old.responded_at;
    elsif old.status = 'requested' then
      if new.status not in ('accepted', 'declined') then new.status := old.status; end if;
      new.invited_by := old.invited_by;
      new.invited_at := old.invited_at;
      new.responded_at := now();
    else
      new.status := 'pending';
      new.invited_by := auth.uid();
      new.invited_at := now();
      new.responded_at := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trip_members_guard on trip_members;
create trigger trip_members_guard before insert or update on trip_members
  for each row execute function trip_members_guard();

-- Ask to come along. Only on a public trip, only for yourself.
create or replace function request_to_join(p_trip text) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select visibility into v from trips where id = p_trip;
  if v is null then raise exception 'No such trip.'; end if;
  if v <> 'public' then raise exception 'That ride is invite only.'; end if;
  if exists (select 1 from trips where id = p_trip and owner_id = auth.uid()) then return 'host'; end if;
  perform set_config('trekov.joining', 'on', true);
  insert into trip_members (trip_id, user_id) values (p_trip, auth.uid())
    on conflict (trip_id, user_id) do nothing;
  perform set_config('trekov.joining', 'off', true);
  return (select status from trip_members where trip_id = p_trip and user_id = auth.uid());
end $$;
revoke all on function request_to_join(text) from public, anon;
grant execute on function request_to_join(text) to authenticated;

-- Your own place on a trip is yours to see. read_members shows accepted riders
-- the group; it hid your own row while you were only asked or only asking —
-- which also meant "delete my row" matched nothing and a rider could not take
-- back a request (a delete with a where clause needs the select policy to pass).
drop policy if exists own_membership on trip_members;
create policy own_membership on trip_members for select to authenticated
  using (auth.uid() = user_id);

-- The rides on offer. Enough to decide whether to ask: never the notes or the
-- bookings, and never anyone's position.
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
       and t.owner_id <> auth.uid()
       and jsonb_array_length(t.stops) > 0
     order by t.updated_at desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) x
$$;
revoke all on function open_rides(integer) from public, anon;
grant execute on function open_rides(integer) to authenticated;

notify pgrst, 'reload schema';
