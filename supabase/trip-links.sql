-- Short trip links (Punit, 2026-09-17). Safe to run more than once.
--
-- A shared trip used to travel inside the link itself, which made the link a
-- screenful of base64 in WhatsApp. Now the same packed trip is kept here under
-- a short code, and the link is trekov.com/i/#<code>. The old links keep
-- working: the app and the /i/ page read both shapes.
--
-- The code is per trip and owner, so sharing the same trip again gives the same
-- link with the itinerary as it is now — nobody ends up holding a stale one.
-- Only signed-in riders can make a link; anyone with the code can read it,
-- which is what a link is for.

create table if not exists trip_links (
  code       text primary key,
  trip_id    text not null,
  owner_id   uuid not null references profiles(id) on delete cascade,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, owner_id)
);
alter table trip_links enable row level security;
-- No policies: the table is reached only through the two functions below.

-- Seven characters, unambiguous letters and digits (no 0/O, 1/l/I), from a
-- secure random source. 57^7 codes; a collision retries.
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

-- Make (or refresh) the link for one of your trips. p_payload is the packed
-- trip the app already builds for long links: it is stored as sent and served
-- back as sent, so the reader's own cleaning applies, as it does to long links.
create or replace function create_trip_link(p_trip text, p_payload jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
  n int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_trip is null or length(p_trip) > 64 then raise exception 'Bad trip id.'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or (p_payload->>'v') is null then
    raise exception 'Bad trip.';
  end if;
  -- A trip link is a few kilobytes; anything near the old URL limits is not one.
  if octet_length(p_payload::text) > 65536 then raise exception 'Trip too large to link.'; end if;

  select code into c from trip_links where trip_id = p_trip and owner_id = auth.uid();
  if c is not null then
    update trip_links set payload = p_payload, updated_at = now() where code = c;
    return c;
  end if;
  loop
    c := trip_link_code();
    begin
      insert into trip_links (code, trip_id, owner_id, payload) values (c, p_trip, auth.uid(), p_payload);
      return c;
    exception when unique_violation then
      n := n + 1;
      if n > 5 then raise exception 'Could not make a link, try again.'; end if;
    end;
  end loop;
end $$;
revoke all on function create_trip_link(text, jsonb) from public, anon;
grant execute on function create_trip_link(text, jsonb) to authenticated;

-- The trip behind a code, or null. Open to anyone: a link is meant to be opened
-- by whoever it was sent to, signed in or not, app or not.
create or replace function trip_link(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select payload from trip_links where code = p_code
$$;
revoke all on function trip_link(text) from public;
grant execute on function trip_link(text) to anon, authenticated;
