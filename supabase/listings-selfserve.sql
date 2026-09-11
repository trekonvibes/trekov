-- Free, self-serve business listings (2026-09-11). Safe to run more than once.
--
-- Anyone signed in can list a business for free — there is no sign-up fee.
-- What a listing may NOT do is promote itself: `verified`, `plan`,
-- `subscribed_until` and `hidden` are Trekov's to set, and the guard below
-- enforces that on the server, whatever the app sends. Before this, the
-- owner policy let a business mark itself "Verified partner".
--
-- Placement: a free listing sits among the nearby results by distance,
-- labelled "On Trekov". "Partner" placement is reserved for an optional
-- boost (plan <> 'basic' with a live subscribed_until); when a boost lapses
-- the listing falls back to free rather than disappearing.

alter table listings add column if not exists hidden boolean not null default false;

-- Fuel stations were missing from the allowed categories.
alter table listings drop constraint if exists listings_category_check;
alter table listings add constraint listings_category_check check (category in
  ('hotel','food','street_food','bike_service','car_service','fuel','rental','attraction'));

alter table listings drop constraint if exists listings_name_len;
alter table listings add constraint listings_name_len check (char_length(btrim(name)) between 2 and 80);
alter table listings drop constraint if exists listings_description_len;
alter table listings add constraint listings_description_len check (char_length(description) <= 300);

-- Visible unless Trekov has hidden it; owners always see their own.
drop policy if exists read_live_listings on listings;
drop policy if exists read_listings on listings;
create policy read_listings on listings for select
  using (hidden = false or auth.uid() = owner_id);

-- Owners keep full control of their own rows (the guard limits which columns).
drop policy if exists manage_own_listing on listings;
create policy manage_own_listing on listings for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create or replace function listings_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Only requests from the app are limited; the dashboard and service role
  -- (which carry no app role) can still verify, boost or hide a listing.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if (select count(*) from listings where owner_id = auth.uid()) >= 5 then
      raise exception 'You can list up to 5 businesses. Edit or remove one to add another.';
    end if;
    new.owner_id := auth.uid();
    new.verified := false;
    new.plan := 'basic';
    new.subscribed_until := null;
    new.hidden := false;
    new.created_at := now();
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.verified := old.verified;
    new.plan := old.plan;
    new.subscribed_until := old.subscribed_until;
    new.hidden := old.hidden;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists listings_guard on listings;
create trigger listings_guard before insert or update on listings
  for each row execute function listings_guard();
