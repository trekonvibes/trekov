-- Fix 1: username sign-in ("column reference ip is ambiguous")
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

-- Fix 2: short-link codes (gen_random_bytes lives in extensions)
-- pgcrypto lives in the extensions schema on Supabase, and create_trip_link
-- runs with search_path = public — unqualified, gen_random_bytes was not found
-- and every short link silently fell back to a long one (2026-09-18).
create or replace function trip_link_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(7);
  out text := '';
  i int;
begin
  for i in 0..6 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return out;
end $$;
revoke all on function trip_link_code() from public, anon, authenticated;
