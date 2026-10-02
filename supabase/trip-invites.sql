-- Trip invites with a status (Punit, 2026-09-11). Safe to run more than once.
--
-- Whoever invites sees each invite as pending, accepted or declined; the
-- invitee accepts or declines from their Trips tab. Only the owner and
-- ACCEPTED members can open the trip or join its live channels (is_trip_member
-- is what the trips read policy and the Realtime policies use).
--
-- Who can change what is enforced here, not in the app: an invite always
-- starts as pending, only the invitee can accept or decline it (through
-- respond_invite), and the owner can only (re)send one.

-- Existing members were added before invites had a status: they count as accepted.
alter table trip_members add column if not exists status text not null default 'accepted'
  check (status in ('pending', 'accepted', 'declined'));
alter table trip_members alter column status set default 'pending';
alter table trip_members add column if not exists invited_by uuid references profiles(id) on delete set null;
alter table trip_members add column if not exists invited_at timestamptz not null default now();
alter table trip_members add column if not exists responded_at timestamptz;

create or replace function is_trip_member(t text, u uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from trips where id = t and owner_id = u)
      or exists (select 1 from trip_members where trip_id = t and user_id = u and status = 'accepted');
$$;

create or replace function trip_members_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;                                   -- dashboard / service role
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.invited_by := auth.uid();
    new.invited_at := now();
    new.responded_at := null;
  elsif auth.uid() = old.user_id then
    -- The invitee answers: accepted or declined, nothing else changes.
    if new.status not in ('accepted', 'declined') then new.status := old.status; end if;
    new.trip_id := old.trip_id;
    new.user_id := old.user_id;
    new.invited_by := old.invited_by;
    new.invited_at := old.invited_at;
    new.responded_at := now();
  else
    -- The owner can only resend an invite (back to pending); an accepted
    -- member stays accepted.
    new.trip_id := old.trip_id;
    new.user_id := old.user_id;
    if old.status = 'accepted' then
      new.status := 'accepted';
      new.invited_by := old.invited_by;
      new.invited_at := old.invited_at;
      new.responded_at := old.responded_at;
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

-- Leaving a trip (Punit, 2026-09-11): a rider may remove their own place on a
-- trip, and nobody else's. The owner still manages everyone (manage_members);
-- permissive policies add up, so either one allows the delete.
drop policy if exists leave_trip on trip_members;
create policy leave_trip on trip_members for delete to authenticated
  using (auth.uid() = user_id);

-- The invitee's answer. (They can't write trip_members directly: only the
-- trip's owner can, under manage_members.)
create or replace function respond_invite(p_trip text, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  update trip_members set status = case when p_accept then 'accepted' else 'declined' end
   where trip_id = p_trip and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'There is no pending invite for this trip.'; end if;
end $$;
revoke all on function respond_invite(text, boolean) from public, anon;
grant execute on function respond_invite(text, boolean) to authenticated;

-- Your pending invites, with enough to decide: the trip's name and who asked.
create or replace function my_invites()
returns table (trip_id text, title text, owner_handle text, invited_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.trip_id, t.title, p.handle, m.invited_at
    from trip_members m
    join trips t on t.id = m.trip_id
    left join profiles p on p.id = t.owner_id
   where m.user_id = auth.uid() and m.status = 'pending'
   order by m.invited_at desc
$$;
revoke all on function my_invites() from public, anon;
grant execute on function my_invites() to authenticated;
