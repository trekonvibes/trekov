-- Pre-launch security fixes (audit of 2026-09-11, approved by Punit).
-- Safe to run more than once.
--
--   1. Live-trip channels are members-only (Realtime private channels + RLS).
--   3. Username sign-in: lockouts per handle AND network, a per-network cap,
--      no bcrypt work for unknown handles, old attempts purged.
--   5. Photos: images only, 10 MB max, and nobody can list other people's files.
--
-- After this runs and the app update is live, turn OFF "Allow public access"
-- in Realtime settings, so only these private channels are possible.

-- ------------------------------------------------------------------ 1. realtime
-- trip:<id> (live positions, alerts) and voice:<id> (push-to-talk signalling):
-- only the trip's owner and members may listen or send.
drop policy if exists trip_members_listen on realtime.messages;
create policy trip_members_listen on realtime.messages for select to authenticated
  using (
    (split_part(realtime.topic(), ':', 1) in ('trip', 'voice')
      and public.is_trip_member(split_part(realtime.topic(), ':', 2), auth.uid()))
    -- New public posts pushed to everyone signed in (src/lib/sync.js).
    or realtime.topic() = 'trekov-public'
  );
drop policy if exists trip_members_send on realtime.messages;
create policy trip_members_send on realtime.messages for insert to authenticated
  with check (
    split_part(realtime.topic(), ':', 1) in ('trip', 'voice')
    and public.is_trip_member(split_part(realtime.topic(), ':', 2), auth.uid())
  );

-- ------------------------------------------------------------------ 3. sign-in
-- One row per (handle, network) — a stranger can no longer lock someone out
-- from elsewhere — plus a cap on attempts from any one network.
create table if not exists login_failures (
  handle        text not null,
  ip            text not null,
  failures      int not null default 0,
  window_start  timestamptz not null default now(),
  primary key (handle, ip)
);
create index if not exists login_failures_ip on login_failures (ip, window_start);
alter table login_failures enable row level security;
revoke all on login_failures from anon, authenticated;
drop table if exists login_attempts;

create or replace function email_for_login(p_handle text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions, auth as $$
-- The caller's address is client_ip, never "ip": a variable named like the
-- login_failures column made every lookup "column reference ip is ambiguous",
-- and every username sign-in failed as "Could not sign in" (2026-09-18).
-- Columns are always read through the lf alias for the same reason.
declare
  h text := lower(ltrim(trim(p_handle), '@'));
  hdrs json := nullif(current_setting('request.headers', true), '')::json;
  client_ip text := coalesce(nullif(hdrs ->> 'cf-connecting-ip', ''), nullif(trim(split_part(hdrs ->> 'x-forwarded-for', ',', 1)), ''), 'unknown');
  em text; hash text; mine int; from_ip int;
begin
  delete from login_failures lf where lf.window_start < now() - interval '15 minutes';

  select lf.failures into mine from login_failures lf where lf.handle = h and lf.ip = client_ip;
  select coalesce(sum(lf.failures), 0) into from_ip from login_failures lf where lf.ip = client_ip;
  if coalesce(mine, 0) >= 5 or from_ip >= 30 then
    raise exception 'too_many_attempts';
  end if;

  select u.email, u.encrypted_password into em, hash
    from profiles p join auth.users u on u.id = p.id
   where p.handle = h;

  -- Handles are public, so there is nothing to hide about whether one exists:
  -- no bcrypt for unknown ones (it was an easy way to load the database).
  if coalesce(hash, '') <> '' and hash = extensions.crypt(p_password, hash) then
    delete from login_failures lf where lf.handle = h and lf.ip = client_ip;
    return em;
  end if;

  insert into login_failures as t (handle, ip, failures, window_start) values (h, client_ip, 1, now())
  on conflict on constraint login_failures_pkey do update set failures = t.failures + 1;
  return null;
end $$;
revoke all on function email_for_login(text, text) from public;
grant execute on function email_for_login(text, text) to anon, authenticated;

-- ------------------------------------------------------------------ 5. photos
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'photos';

-- Photos stay publicly viewable by URL (the bucket is public); listing the
-- bucket through the API is limited to your own folder.
drop policy if exists read_photos on storage.objects;
create policy read_photos on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
