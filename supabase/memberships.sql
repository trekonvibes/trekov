-- Paid accounts and one device per account (2026-09-11). Safe to run more than once.
-- Run after listings-selfserve.sql and listing-products.sql.
--
-- Pricing: a Trekov account costs Rs 99/year for riders and Rs 499/year for
-- businesses (unlimited listings and products; includes the rider account).
-- Without an account the app still works on the phone; only account
-- features (sync, posting, group trips, listings) need a plan. Accounts that
-- existed before the pre-release offer are founding members (profiles.founding)
-- and stay free; everyone is free until app_settings.offer_ends_at (31 Oct 2026).
--
-- The paywall only takes effect once app_settings.paywall_since is set (by
-- Trekov, once Razorpay payments work). Until then everything stays open, so
-- nobody is locked out before they can pay. Founding members are the explicit
-- profiles.founding flag (see prerelease-offer.sql).
--
-- One device at a time: the app sends its device id as the x-device-id
-- header; claim_device() makes a device the account's active one, and writes
-- from any other device are refused.

-- ------------------------------------------------------------------ settings
create table if not exists app_settings (
  id                 boolean primary key default true check (id),
  paywall_since      timestamptz,
  rider_price_inr    integer not null default 99,
  business_price_inr integer not null default 499
);
-- Pre-release offer: free for everyone until this moment (prerelease-offer.sql).
alter table app_settings add column if not exists offer_ends_at timestamptz;
insert into app_settings (id) values (true) on conflict (id) do nothing;
alter table app_settings enable row level security;
drop policy if exists read_settings on app_settings;
create policy read_settings on app_settings for select using (true);

-- ------------------------------------------------------------------ profiles
alter table profiles add column if not exists founding       boolean not null default false;
alter table profiles add column if not exists member_until   date;
alter table profiles add column if not exists business_until date;
alter table profiles add column if not exists active_device  text;

-- Plan and device columns are private; public reads see only the profile.
revoke select on profiles from anon, authenticated;
grant select (id, handle, name, bio, avatar, created_at) on profiles to anon, authenticated;

-- A user can edit their profile but never their own plan, founding status or
-- active device (the device changes only through claim_device()).
create or replace function profiles_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  new.founding := old.founding;
  new.member_until := old.member_until;
  new.business_until := old.business_until;
  if coalesce(current_setting('trekov.claiming', true), '') <> 'on' then
    new.active_device := old.active_device;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before update on profiles
  for each row execute function profiles_guard();

-- ------------------------------------------------------------------ checks
create or replace function is_member(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.paywall_since is null or p.founding
        or (s.offer_ends_at is not null and now() < s.offer_ends_at)
        or p.member_until >= current_date or p.business_until >= current_date
    from profiles p cross join app_settings s where p.id = uid), false)
$$;

create or replace function is_business(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.paywall_since is null or p.founding
        or (s.offer_ends_at is not null and now() < s.offer_ends_at)
        or p.business_until >= current_date
    from profiles p cross join app_settings s where p.id = uid), false)
$$;

-- The request comes from the account's active device (or none is set yet).
create or replace function device_ok(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active_device is null
        or p.active_device = (nullif(current_setting('request.headers', true), '')::json ->> 'x-device-id')
    from profiles p where p.id = uid), false)
$$;

create or replace function can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and is_member(auth.uid()) and device_ok(auth.uid())
$$;

-- The latest sign-in wins: this device becomes the only one that can write.
create or replace function claim_device(p_device text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_device !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'Bad device id.'; end if;
  perform set_config('trekov.claiming', 'on', true);
  update profiles set active_device = p_device where id = auth.uid();
  perform set_config('trekov.claiming', 'off', true);
end $$;
revoke all on function claim_device(text) from public, anon;
grant execute on function claim_device(text) to authenticated;

-- Your own plan status, for the app (the columns themselves are private).
create or replace function my_membership() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    -- "On" means someone can actually be asked to pay: switched on and the offer over.
    'paywall_on', s.paywall_since is not null and (s.offer_ends_at is null or now() >= s.offer_ends_at),
    'offer_ends_at', s.offer_ends_at,
    'offer_active', s.offer_ends_at is not null and now() < s.offer_ends_at,
    'rider_price_inr', s.rider_price_inr,
    'business_price_inr', s.business_price_inr,
    'founding', p.founding,
    'member_until', p.member_until,
    'business_until', p.business_until,
    'is_member', is_member(p.id),
    'is_business', is_business(p.id),
    'active_device', p.active_device)
  from profiles p cross join app_settings s where p.id = auth.uid()
$$;
revoke all on function my_membership() from public, anon;
grant execute on function my_membership() to authenticated;

-- ------------------------------------------------------------------ payments
create table if not exists payments (
  id           text primary key,          -- razorpay_payment_id
  order_id     text not null,
  user_id      uuid not null references profiles(id) on delete cascade,
  plan         text not null check (plan in ('rider', 'business')),
  amount_paise integer not null,
  status       text not null,
  valid_until  date not null,
  created_at   timestamptz not null default now()
);
alter table payments enable row level security;
drop policy if exists read_own_payments on payments;
create policy read_own_payments on payments for select using (auth.uid() = user_id);

-- Records a verified payment and extends the plan by a year. Called only by
-- the Razorpay edge functions (service role). The same payment id counts once.
create or replace function grant_plan(p_user uuid, p_plan text, p_payment text, p_order text, p_amount integer)
returns date language plpgsql security definer set search_path = public as $$
declare until date; starts date;
begin
  if p_plan not in ('rider', 'business') then raise exception 'Unknown plan %', p_plan; end if;
  insert into payments (id, order_id, user_id, plan, amount_paise, status, valid_until)
    values (p_payment, p_order, p_user, p_plan, p_amount, 'captured', current_date)
    on conflict (id) do nothing;
  if not found then
    select valid_until into until from payments where id = p_payment;
    return until;
  end if;
  -- A plan bought during the pre-release offer starts when the offer ends.
  select greatest(current_date, coalesce((offer_ends_at at time zone 'Asia/Kolkata')::date, current_date))
    into starts from app_settings;
  if p_plan = 'business' then
    update profiles set business_until = (greatest(starts, coalesce(business_until, starts)) + interval '1 year')::date
      where id = p_user returning business_until into until;
  else
    update profiles set member_until = (greatest(starts, coalesce(member_until, starts)) + interval '1 year')::date
      where id = p_user returning member_until into until;
  end if;
  if until is null then raise exception 'No such account'; end if;
  update payments set valid_until = until where id = p_payment;
  return until;
end $$;
revoke all on function grant_plan(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function grant_plan(uuid, text, text, text, integer) to service_role;

-- ------------------------------------------------------------------ writes need a plan and the active device
drop policy if exists add_places on places;
create policy add_places on places for insert with check (auth.uid() = added_by and can_write());
drop policy if exists edit_own_place on places;
create policy edit_own_place on places for update using (auth.uid() = added_by) with check (auth.uid() = added_by and can_write());

drop policy if exists add_own_post on posts;
create policy add_own_post on posts for insert with check (auth.uid() = author_id and can_write());

drop policy if exists own_like on likes;
create policy own_like on likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id and can_write());
drop policy if exists own_comment on comments;
create policy own_comment on comments for all using (auth.uid() = user_id) with check (auth.uid() = user_id and can_write());
drop policy if exists own_review on reviews;
create policy own_review on reviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id and can_write());
drop policy if exists own_saves on saves;
create policy own_saves on saves for all using (auth.uid() = user_id) with check (auth.uid() = user_id and can_write());

drop policy if exists write_own_trip on trips;
create policy write_own_trip on trips for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id and can_write());
drop policy if exists manage_members on trip_members;
create policy manage_members on trip_members for all
  using (exists (select 1 from trips where id = trip_id and owner_id = auth.uid()))
  with check (exists (select 1 from trips where id = trip_id and owner_id = auth.uid()) and can_write());

-- Storage doesn't pass the app's headers, so uploads check the plan only;
-- the post that uses the photo is still checked for the active device.
drop policy if exists write_own_photos on storage.objects;
create policy write_own_photos on storage.objects for insert
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text and is_member(auth.uid()));

-- Businesses: the business plan covers unlimited listings and products.
drop policy if exists read_listings on listings;
create policy read_listings on listings for select
  using ((hidden = false and is_business(owner_id)) or auth.uid() = owner_id);
drop policy if exists manage_own_listing on listings;
create policy manage_own_listing on listings for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id and can_write() and is_business(auth.uid()));

drop policy if exists read_products on listing_products;
create policy read_products on listing_products for select using (
  auth.uid() = owner_id or exists (
    select 1 from listings l where l.id = listing_id and l.hidden = false and is_business(l.owner_id)));
drop policy if exists manage_own_products on listing_products;
create policy manage_own_products on listing_products for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id and can_write() and is_business(auth.uid()));

-- No cap on listings any more ("no limit of listing" on the business plan).
create or replace function listings_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
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

-- Products come with the business plan (the Rs 299/month products plan is retired).
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
  if not is_business(auth.uid()) then
    raise exception 'Listing products needs the Trekov business plan.';
  end if;
  new.owner_id := auth.uid();
  return new;
end $$;
