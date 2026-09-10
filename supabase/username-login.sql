-- Username + password sign-in (2026-09-11).
--
-- Supabase Auth only signs in with an email, and emails must stay private:
-- the invite search already shows handles to everyone. So the lookup below
-- hands back an email ONLY to someone who proved they know the password, and
-- the app then signs in with that email normally (keeping Supabase's own
-- rate limits). Five wrong passwords for one handle lock it for 15 minutes.
-- Safe to run more than once.

-- Failed tries per handle. RLS on and no policies: invisible to the API.
create table if not exists login_attempts (
  handle        text primary key,
  failures      int not null default 0,
  window_start  timestamptz not null default now()
);
alter table login_attempts enable row level security;
revoke all on login_attempts from anon, authenticated;

create or replace function email_for_login(p_handle text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  h text := lower(ltrim(trim(p_handle), '@'));
  em text; hash text; a record;
begin
  select failures, window_start into a from login_attempts where handle = h;
  if found and a.window_start > now() - interval '15 minutes' and a.failures >= 5 then
    raise exception 'too_many_attempts';
  end if;

  select u.email, u.encrypted_password into em, hash
    from profiles p join auth.users u on u.id = p.id
   where p.handle = h;

  if coalesce(hash, '') <> '' and hash = extensions.crypt(p_password, hash) then
    delete from login_attempts where handle = h;
    return em;
  end if;
  -- Same bcrypt work when the handle doesn't exist, so timing gives nothing away.
  if coalesce(hash, '') = '' then perform extensions.crypt(p_password, extensions.gen_salt('bf', 10)); end if;

  insert into login_attempts as t (handle, failures, window_start) values (h, 1, now())
  on conflict (handle) do update set
    failures     = case when t.window_start > now() - interval '15 minutes' then t.failures + 1 else 1 end,
    window_start = case when t.window_start > now() - interval '15 minutes' then t.window_start else now() end;
  return null;
end $$;
revoke all on function email_for_login(text, text) from public;
grant execute on function email_for_login(text, text) to anon, authenticated;

-- Is a handle free? Handles are public already (invites search them).
create or replace function handle_available(p_handle text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where handle = lower(ltrim(trim(p_handle), '@')))
$$;
revoke all on function handle_available(text) from public;
grant execute on function handle_available(text) to anon, authenticated;

-- New accounts keep the handle they picked at sign-up (sent as user metadata);
-- otherwise one is derived from the email as before.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; candidate text; n int := 0; wanted text;
begin
  wanted := lower(coalesce(new.raw_user_meta_data->>'handle', ''));
  if wanted ~ '^[a-z0-9_]{3,20}$' and not exists (select 1 from profiles where handle = wanted) then
    candidate := wanted;
  else
    base := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
    if base = '' then base := 'traveller'; end if;
    candidate := base;
    while exists (select 1 from profiles where handle = candidate) loop
      n := n + 1; candidate := base || n::text;
    end loop;
  end if;
  insert into profiles (id, handle, name) values (new.id, candidate, candidate);
  return new;
end $$;
