-- Paid products for business listings (2026-09-11). Safe to run more than once.
-- Run after listings-selfserve.sql.
--
-- Sign-up and the basic business listing stay free. Listing products or
-- services with prices (rooms, rental bikes, a menu, repairs) needs the
-- monthly products plan: one flat fee, unlimited products.
--
-- `listings.products_until` says the plan is live. Only Trekov sets it (from
-- the dashboard now, from a payment webhook once online payment exists); the
-- guards below ignore any attempt by an owner to set it. When it lapses the
-- products stop showing and the free listing carries on.

alter table listings add column if not exists products_until date;

create table if not exists listing_products (
  id          text primary key,
  listing_id  text not null references listings(id) on delete cascade,
  owner_id    uuid not null references profiles(id) on delete cascade,
  name        text not null,
  price_inr   integer not null,
  unit        text not null default '',
  description text not null default '',
  available   boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists listing_products_listing_idx on listing_products (listing_id, position);

alter table listing_products drop constraint if exists listing_products_name_len;
alter table listing_products add constraint listing_products_name_len check (char_length(btrim(name)) between 2 and 80);
alter table listing_products drop constraint if exists listing_products_price;
alter table listing_products add constraint listing_products_price check (price_inr between 0 and 10000000);
alter table listing_products drop constraint if exists listing_products_text_len;
alter table listing_products add constraint listing_products_text_len check (char_length(unit) <= 30 and char_length(description) <= 300);

alter table listing_products enable row level security;

-- Shown while the listing is visible and its plan is live; owners always see their own.
drop policy if exists read_products on listing_products;
create policy read_products on listing_products for select using (
  auth.uid() = owner_id or exists (
    select 1 from listings l
    where l.id = listing_id and l.hidden = false and l.products_until >= current_date));

drop policy if exists manage_own_products on listing_products;
create policy manage_own_products on listing_products for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Adding or editing a product needs your own listing with a live plan.
-- Deleting is always allowed.
create or replace function listing_products_guard() returns trigger
language plpgsql set search_path = public as $$
declare l listings%rowtype;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.listing_id := old.listing_id;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  select * into l from listings where id = new.listing_id;
  if not found or l.owner_id is distinct from auth.uid() then
    raise exception 'You can only add products to your own listing.';
  end if;
  if l.products_until is null or l.products_until < current_date then
    raise exception 'Listing products needs the monthly products plan. Request it from your listing.';
  end if;
  new.owner_id := auth.uid();
  return new;
end $$;

drop trigger if exists listing_products_guard on listing_products;
create trigger listing_products_guard before insert or update on listing_products
  for each row execute function listing_products_guard();

-- The listings guard, now also keeping `products_until` Trekov's to set.
create or replace function listings_guard() returns trigger
language plpgsql set search_path = public as $$
begin
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
    new.products_until := null;
    new.hidden := false;
    new.created_at := now();
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.verified := old.verified;
    new.plan := old.plan;
    new.subscribed_until := old.subscribed_until;
    new.products_until := old.products_until;
    new.hidden := old.hidden;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
