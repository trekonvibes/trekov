-- Before the Play Store launch (audit, 2026-09-14). Safe to run more than once.
-- Run after the other files. Nothing here removes data.

-- ------------------------------------------------------ report and block
-- Google Play requires that people can report other people's content and
-- block users. A report is written by its reporter and read only by admins
-- (admin_reports below); a block is private to the person who made it.
create table if not exists reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references profiles(id) on delete cascade,
  kind        text not null check (kind in ('post', 'comment', 'review', 'profile', 'ride')),
  target_id   text not null check (char_length(target_id) between 1 and 80),
  reason      text not null check (reason in ('spam', 'abuse', 'nudity', 'violence', 'fake', 'other')),
  note        text not null default '' check (char_length(note) <= 500),
  status      text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at  timestamptz not null default now(),
  unique (reporter_id, kind, target_id)
);
alter table reports enable row level security;
drop policy if exists file_report on reports;
create policy file_report on reports for insert
  with check (auth.uid() = reporter_id and status = 'open');
-- No select/update/delete policy: reporters cannot read reports back, and
-- nobody can see who reported them.

create table if not exists blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table blocks enable row level security;
drop policy if exists own_blocks on blocks;
create policy own_blocks on blocks for all
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- Whether either person has blocked the other. Used by push-send and the
-- invite/join guard; says nothing about who blocked whom.
create or replace function blocked_between(a uuid, b uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;
revoke all on function blocked_between(uuid, uuid) from public, anon, authenticated;

-- Admins read open reports through the existing admin gate.
create or replace function admin_reports(p_status text default 'open', p_limit integer default 100) returns json
language plpgsql security definer set search_path = public as $$
declare out json;
begin
  perform admin_begin();
  select coalesce(json_agg(r order by r.created_at desc), '[]') into out from (
    select id, kind, target_id, reason, note, status, created_at,
           (select handle from profiles where id = reporter_id) as reporter
      from reports where status = p_status order by created_at desc limit least(p_limit, 500)
  ) r;
  return out;
end $$;
revoke all on function admin_reports(text, integer) from public, anon;
grant execute on function admin_reports(text, integer) to authenticated;

create or replace function admin_resolve_report(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform admin_begin('resolve_report', p_id::text, json_build_object('status', p_status)::jsonb);
  if p_status not in ('actioned', 'dismissed') then raise exception 'actioned or dismissed'; end if;
  update reports set status = p_status where id = p_id;
end $$;
revoke all on function admin_resolve_report(bigint, text) from public, anon;
grant execute on function admin_resolve_report(bigint, text) to authenticated;

-- A blocked person cannot invite you, and you cannot be asked to host them.
create or replace function trip_members_no_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
declare host uuid;
begin
  select owner_id into host from trips where id = new.trip_id;
  if host is not null and blocked_between(host, new.user_id) then
    raise exception 'This rider cannot be added.';
  end if;
  return new;
end $$;
drop trigger if exists trip_members_no_blocked on trip_members;
create trigger trip_members_no_blocked before insert on trip_members
  for each row execute function trip_members_no_blocked();

-- ------------------------------------------------------ push rate limit
-- push-send records what each account sends, so one account cannot flood
-- other people's phones. Only the service role (the function) touches it.
create table if not exists push_log (
  sender_id uuid not null references profiles(id) on delete cascade,
  kind      text not null,
  sent_at   timestamptz not null default now()
);
create index if not exists push_log_sender_time on push_log (sender_id, sent_at desc);
alter table push_log enable row level security;
-- No policies: invisible to the app. Old rows go with the cleanup below.

-- ------------------------------------------------------ sign-up handles fit
-- A handle made from an email address could be shorter than 3 or longer than
-- 20 characters (a@x.com, a very long address). With the check below that
-- would stop the account being created at all, so the made-up handle is
-- trimmed and padded to fit first.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; candidate text; n int := 0; wanted text;
begin
  wanted := lower(coalesce(new.raw_user_meta_data->>'handle', ''));
  if wanted ~ '^[a-z0-9_]{3,20}$' and not exists (select 1 from profiles where handle = wanted) then
    candidate := wanted;
  else
    base := left(lower(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^a-zA-Z0-9_]', '', 'g')), 15);
    if base = '' then base := 'traveller'; end if;
    if char_length(base) < 3 then base := base || '_rider'; end if;
    candidate := base;
    while exists (select 1 from profiles where handle = candidate) loop
      n := n + 1; candidate := base || n::text;
    end loop;
  end if;
  insert into profiles (id, handle, name) values (new.id, candidate, candidate);
  return new;
end $$;

-- ------------------------------------------------------ profile limits
-- The app has always checked these; the database now does too, so an account
-- cannot set a handle that looks like someone else's, a megabyte avatar, or an
-- outside image that tracks who looks at it. NOT VALID: existing rows are left
-- alone and only new writes are checked.
alter table profiles drop constraint if exists profiles_handle_format;
alter table profiles add constraint profiles_handle_format
  check (handle ~ '^[a-z0-9_]{3,20}$') not valid;
alter table profiles drop constraint if exists profiles_text_lengths;
alter table profiles add constraint profiles_text_lengths
  check (char_length(name) <= 60 and char_length(bio) <= 300) not valid;
alter table profiles drop constraint if exists profiles_avatar_inline;
alter table profiles add constraint profiles_avatar_inline
  check (avatar = '' or (avatar ~ '^data:image/(jpeg|png|webp|svg\+xml)[;,]' and octet_length(avatar) <= 200000)) not valid;

alter table posts drop constraint if exists posts_limits;
alter table posts add constraint posts_limits
  check (char_length(caption) <= 1000 and photo_path = author_id::text || '/' || id || '.jpg') not valid;
alter table comments drop constraint if exists comments_limits;
alter table comments add constraint comments_limits check (char_length(body) between 1 and 1000) not valid;
alter table reviews drop constraint if exists reviews_limits;
alter table reviews add constraint reviews_limits check (char_length(note) <= 2000) not valid;

-- ------------------------------------------------------ payments survive
-- Deleting an account must not delete the payment records the policy says
-- are kept for tax.
alter table payments alter column user_id drop not null;
alter table payments drop constraint if exists payments_user_id_fkey;
alter table payments add constraint payments_user_id_fkey
  foreign key (user_id) references profiles(id) on delete set null;

-- ------------------------------------------------------ captain cleared
-- The trigger ran as the rider who left, and RLS stopped it updating the trip,
-- so a captain who left stayed named. It runs as the owner now.
create or replace function trip_members_captain_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update trips set captain_id = null where id = old.trip_id and captain_id = old.user_id;
  return old;
end $$;

notify pgrst, 'reload schema';
