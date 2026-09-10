-- Trekov schema.
--
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: everything is IF NOT EXISTS / OR REPLACE.
--
-- Ids are TEXT, not uuid, because the client generates them so a row created
-- offline keeps the same id when it syncs.

-- ---------------------------------------------------------------- profiles
create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  handle      text unique not null,
  name        text not null default '',
  bio         text not null default '',
  avatar      text not null default '',
  created_at  timestamptz not null default now()
);

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- ------------------------------------------------------------------ places
create table if not exists places (
  id         text primary key,
  name       text not null,
  region     text not null default '',
  country    text not null default '',
  lat        double precision not null,
  lng        double precision not null,
  best_time  text not null default '',
  blurb      text not null default '',
  added_by   uuid references profiles(id) on delete set null,
  added_at   timestamptz not null default now()
);
create index if not exists places_added_at_idx on places (added_at desc);

-- ------------------------------------------------------------------- posts
create table if not exists posts (
  id         text primary key,
  place_id   text not null references places(id) on delete cascade,
  author_id  uuid not null references profiles(id) on delete cascade,
  photo_path text not null,            -- object path in the `photos` bucket
  caption    text not null default '',
  tags       text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists posts_place_created_idx on posts (place_id, created_at desc);
-- Location proof (see post-location.sql): when, how far from the place, how accurate.
alter table posts add column if not exists located_at         timestamptz;
alter table posts add column if not exists located_distance_m integer;
alter table posts add column if not exists located_accuracy_m integer;

-- The newest photo at a place holds its banner.
create or replace view place_banners as
  select distinct on (place_id) place_id, id as post_id, author_id, photo_path, created_at
  from posts order by place_id, created_at desc;

-- ------------------------------------------------------------------- likes
create table if not exists likes (
  post_id text not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  primary key (post_id, user_id)
);

-- ---------------------------------------------------------------- comments
create table if not exists comments (
  id         text primary key,
  post_id    text not null references posts(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- reviews
-- One review per person per place; ratings and facts are jsonb so adding a
-- category later needs no migration.
create table if not exists reviews (
  id         text primary key,
  place_id   text not null references places(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  ratings    jsonb not null default '{}',
  facts      jsonb not null default '{}',
  note       text not null default '',
  created_at timestamptz not null default now(),
  unique (place_id, user_id)
);

-- ------------------------------------------------------------------- saves
create table if not exists saves (
  place_id text not null references places(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (place_id, user_id)
);

-- ------------------------------------------------------------------- trips
create table if not exists trips (
  id         text primary key,
  owner_id   uuid not null references profiles(id) on delete cascade,
  title      text not null default 'Untitled trip',
  starts_on  date,
  ends_on    date,
  notes      text not null default '',
  stops      jsonb not null default '[]',   -- [{ placeId, note }] — order matters
  bookings   jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- Companions on a trip: who may see it and share their live position.
create table if not exists trip_members (
  trip_id  text not null references trips(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  primary key (trip_id, user_id)
);

create or replace function is_trip_member(t text, u uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from trips where id = t and owner_id = u)
      or exists (select 1 from trip_members where trip_id = t and user_id = u);
$$;

-- =====================================================================
-- Row level security
-- =====================================================================
alter table profiles     enable row level security;
alter table places       enable row level security;
alter table posts        enable row level security;
alter table likes        enable row level security;
alter table comments     enable row level security;
alter table reviews      enable row level security;
alter table saves        enable row level security;
alter table trips        enable row level security;
alter table trip_members enable row level security;

do $$ begin
  -- Public reading: the map is meant to be browsable.
  create policy read_profiles on profiles for select using (true);
  create policy read_places   on places   for select using (true);
  create policy read_posts    on posts    for select using (true);
  create policy read_likes    on likes    for select using (true);
  create policy read_comments on comments for select using (true);
  create policy read_reviews  on reviews  for select using (true);

  -- You edit only your own rows.
  create policy write_own_profile on profiles for update using (auth.uid() = id);
  create policy add_places     on places   for insert with check (auth.uid() = added_by);
  create policy edit_own_place on places   for update using (auth.uid() = added_by);

  create policy add_own_post  on posts for insert with check (auth.uid() = author_id);
  create policy del_own_post  on posts for delete using (auth.uid() = author_id);

  create policy own_like      on likes    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy own_comment   on comments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy own_review    on reviews  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

  -- Saves are private: a wishlist is nobody else's business.
  create policy own_saves     on saves    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

  -- Trips are visible to their owner and invited companions.
  create policy read_own_trips on trips for select using (is_trip_member(id, auth.uid()));
  create policy write_own_trip on trips for all
    using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
  create policy read_members   on trip_members for select using (is_trip_member(trip_id, auth.uid()));
  create policy manage_members on trip_members for all
    using (exists (select 1 from trips where id = trip_id and owner_id = auth.uid()))
    with check (exists (select 1 from trips where id = trip_id and owner_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Photo storage
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

do $$ begin
  create policy read_photos on storage.objects for select
    using (bucket_id = 'photos');
  -- Uploads land under <user-id>/…, so nobody can write into anyone else's folder.
  create policy write_own_photos on storage.objects for insert
    with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy delete_own_photos on storage.objects for delete
    using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

-- Realtime for the tables the app subscribes to.
do $$ begin
  alter publication supabase_realtime add table places;
  alter publication supabase_realtime add table posts;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Partner listings
--
-- Businesses that pay to be listed. Everything here is shown ABOVE the
-- results Google returns, which is the whole product: the subscription buys
-- placement above commodity data, not the existence of a result.
--
-- `subscribed_until` is enforced in the read policy, so a lapsed listing
-- stops being served without anyone having to remember to delete it.
-- =====================================================================
create table if not exists listings (
  id               text primary key,
  owner_id         uuid references profiles(id) on delete set null,
  category         text not null,
  name             text not null,
  description      text not null default '',
  phone            text not null default '',
  address          text not null default '',
  lat              double precision not null,
  lng              double precision not null,
  url              text not null default '',
  photo_path       text not null default '',
  plan             text not null default 'basic',
  subscribed_until date,
  verified         boolean not null default false,
  created_at       timestamptz not null default now()
);
-- Stated separately and re-applied on every run, so adding a category later
-- is a schema edit rather than a migration nobody remembers to write.
alter table listings drop constraint if exists listings_category_check;
alter table listings add constraint listings_category_check check (category in
  ('hotel','food','street_food','bike_service','car_service','rental','attraction'));

create index if not exists listings_category_idx on listings (category);
create index if not exists listings_location_idx on listings (lat, lng);

alter table listings enable row level security;

do $$ begin
  -- Only live subscriptions are visible.
  create policy read_live_listings on listings for select
    using (subscribed_until is null or subscribed_until >= current_date);
  -- A business edits its own entry; billing state is not theirs to set, so
  -- keep `subscribed_until` and `verified` to server-side/admin updates.
  create policy manage_own_listing on listings for all
    using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;

-- Username + password sign-in: see username-login.sql (run it after this file).
