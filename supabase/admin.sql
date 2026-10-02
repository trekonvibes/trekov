-- Trekov admin (Punit, 2026-09-11): one place to see sign-ups and what people
-- are doing, and to run the app. Safe to run more than once. Run after
-- memberships.sql, prerelease-offer.sql, trip-invites.sql and security-hardening.sql.
--
-- Who is an admin lives in `admins`, which the app can neither read nor
-- write: admins are added in the SQL editor (see the end of this file), never
-- from the app. Everything the admin screen shows or changes goes through the
-- admin_* functions below. Each one checks that the caller is an admin, on
-- their account's active device (the one-device rule applies to admins too),
-- and every change is recorded in admin_actions.
--
-- Some columns are guarded against the app: plans, founding, the active
-- device, and a listing's verified/hidden flags. The guards let a change
-- through only when an admin function makes it — admin_begin() sets
-- trekov.admin for that transaction, and the guard re-checks is_admin().

-- ------------------------------------------------------------------ who and what
create table if not exists admins (
  user_id  uuid primary key references auth.users on delete cascade,
  added_at timestamptz not null default now()
);
alter table admins enable row level security;
revoke all on admins from anon, authenticated;

create table if not exists admin_actions (
  id       bigint generated always as identity primary key,
  admin_id uuid references auth.users on delete set null,
  action   text not null,
  target   text not null default '',
  detail   jsonb not null default '{}',
  at       timestamptz not null default now()
);
create index if not exists admin_actions_at_idx on admin_actions (at desc);
create index if not exists admin_actions_target_idx on admin_actions (target);
alter table admin_actions enable row level security;
revoke all on admin_actions from anon, authenticated;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from admins where user_id = auth.uid())
$$;
revoke all on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated;

-- True only inside an admin function's transaction (see admin_begin).
create or replace function admin_writing() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('trekov.admin', true), '') = 'on' and is_admin()
$$;
revoke all on function admin_writing() from public, anon;
grant execute on function admin_writing() to authenticated;

-- Every admin function starts here. With an action, it is also logged.
create or replace function admin_begin(p_action text default null, p_target text default '', p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  -- Two-step sign-in (Punit, 2026-09-11): the session must have been confirmed
  -- with a code from the admin's authenticator app (Supabase MFA, aal2).
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Confirm with the code from your authenticator app first.' using errcode = '42501';
  end if;
  if not device_ok(auth.uid()) then
    raise exception 'Your account is active on another device. Sign in here again to use admin.' using errcode = '42501';
  end if;
  perform set_config('trekov.admin', 'on', true);
  if p_action is not null then
    insert into admin_actions (admin_id, action, target, detail)
      values (auth.uid(), p_action, coalesce(p_target, ''), coalesce(p_detail, '{}'::jsonb));
  end if;
end $$;
revoke all on function admin_begin(text, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ guards (admin bypass added)
create or replace function profiles_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') or admin_writing() then
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

create or replace function listings_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') or admin_writing() then
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

-- ------------------------------------------------------------------ numbers
-- Signed in, or had the app open (each session refresh leaves a new refresh token).
create or replace function admin_active_users(p_since interval) returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from (
    select id from auth.users where last_sign_in_at >= now() - p_since
    union
    select user_id::uuid from auth.refresh_tokens
     where created_at >= now() - p_since and user_id ~ '^[0-9a-fA-F-]{36}$'
  ) a
$$;
revoke all on function admin_active_users(interval) from public, anon, authenticated;

create or replace function admin_overview() returns json
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date; out json;
begin
  perform admin_begin();
  select json_build_object(
    'users',           (select count(*) from profiles),
    'signups_today',   (select count(*) from profiles where (created_at at time zone 'Asia/Kolkata')::date = today),
    'signups_7d',      (select count(*) from profiles where created_at >= now() - interval '7 days'),
    'signups_30d',     (select count(*) from profiles where created_at >= now() - interval '30 days'),
    'active_24h',      admin_active_users(interval '1 day'),
    'active_7d',       admin_active_users(interval '7 days'),
    'founding',        (select count(*) from profiles where founding),
    'paid_riders',     (select count(*) from profiles where member_until >= current_date),
    'paid_business',   (select count(*) from profiles where business_until >= current_date),
    'banned',          (select count(*) from auth.users where banned_until > now()),
    'admins',          (select count(*) from admins),
    'posts',           (select count(*) from posts),
    'posts_7d',        (select count(*) from posts where created_at >= now() - interval '7 days'),
    'places_added',    (select count(*) from places where added_by is not null),
    'places_7d',       (select count(*) from places where added_by is not null and added_at >= now() - interval '7 days'),
    'trips',           (select count(*) from trips),
    'group_trips',     (select count(distinct trip_id) from trip_members where status = 'accepted'),
    'pending_invites', (select count(*) from trip_members where status = 'pending'),
    'reviews',         (select count(*) from reviews),
    'comments',        (select count(*) from comments),
    'listings',        (select count(*) from listings),
    'listings_hidden', (select count(*) from listings where hidden),
    'payments',        (select count(*) from payments where status = 'captured'),
    'revenue_paise',   (select coalesce(sum(amount_paise), 0) from payments where status = 'captured'),
    'settings',        (select json_build_object('paywall_since', paywall_since, 'offer_ends_at', offer_ends_at,
                          'rider_price_inr', rider_price_inr, 'business_price_inr', business_price_inr) from app_settings),
    'signups_by_day',  (select json_agg(json_build_object('day', d.day, 'n', coalesce(c.n, 0)) order by d.day)
                          from (select today - i as day from generate_series(0, 29) i) d
                          left join (select (created_at at time zone 'Asia/Kolkata')::date as day, count(*) as n
                                       from profiles group by 1) c on c.day = d.day)
  ) into out;
  return out;
end $$;

-- ------------------------------------------------------------------ people
create or replace function admin_users(p_query text default '', p_filter text default 'all',
                                       p_limit integer default 50, p_offset integer default 0)
returns json language plpgsql security definer set search_path = public as $$
declare q text := lower(btrim(coalesce(p_query, ''))); out json;
begin
  perform admin_begin();
  with matched as (
    select p.id, p.handle, p.name, p.created_at, u.email, u.last_sign_in_at, u.email_confirmed_at,
           u.banned_until, p.founding, p.member_until, p.business_until,
           p.active_device is not null as has_device,
           exists (select 1 from admins a where a.user_id = p.id) as is_admin
      from profiles p join auth.users u on u.id = p.id
     where (q = '' or position(q in lower(p.handle || ' ' || p.name || ' ' || coalesce(u.email, ''))) > 0)
       and case coalesce(p_filter, 'all')
             when 'founding' then p.founding
             when 'paid'     then coalesce(p.member_until >= current_date or p.business_until >= current_date, false)
             when 'banned'   then coalesce(u.banned_until > now(), false)
             when 'admins'   then exists (select 1 from admins a where a.user_id = p.id)
             else true end
  )
  select json_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((select json_agg(r) from (
        select m.*, (select count(*) from posts where author_id = m.id) as posts,
                    (select count(*) from trips where owner_id = m.id) as trips
          from matched m order by m.created_at desc
         limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::json)
  ) into out;
  return out;
end $$;

create or replace function admin_user(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare out json;
begin
  perform admin_begin();
  if not exists (select 1 from profiles where id = p_id) then raise exception 'No such account.'; end if;
  select json_build_object(
    'user', (select row_to_json(x) from (
        select p.id, p.handle, p.name, p.bio, p.created_at, u.email, u.last_sign_in_at, u.email_confirmed_at,
               u.banned_until, p.founding, p.member_until, p.business_until,
               p.active_device is not null as has_device,
               exists (select 1 from admins a where a.user_id = p.id) as is_admin
          from profiles p join auth.users u on u.id = p.id where p.id = p_id) x),
    'counts', json_build_object(
        'posts',    (select count(*) from posts where author_id = p_id),
        'places',   (select count(*) from places where added_by = p_id),
        'trips',    (select count(*) from trips where owner_id = p_id),
        'reviews',  (select count(*) from reviews where user_id = p_id),
        'comments', (select count(*) from comments where user_id = p_id),
        'saves',    (select count(*) from saves where user_id = p_id),
        'listings', (select count(*) from listings where owner_id = p_id)),
    'posts', coalesce((select json_agg(x) from (
        select po.id, po.photo_path, po.caption, po.created_at, pl.name as place
          from posts po join places pl on pl.id = po.place_id
         where po.author_id = p_id order by po.created_at desc limit 30) x), '[]'::json),
    'trips', coalesce((select json_agg(x) from (
        select t.id, t.title, t.updated_at, jsonb_array_length(t.stops) as stops,
               (select count(*) from trip_members m where m.trip_id = t.id and m.status = 'accepted') as members
          from trips t where t.owner_id = p_id order by t.updated_at desc limit 30) x), '[]'::json),
    'listings', coalesce((select json_agg(x) from (
        select id, name, category, hidden, verified, created_at
          from listings where owner_id = p_id order by created_at desc) x), '[]'::json),
    'payments', coalesce((select json_agg(x) from (
        select id, plan, amount_paise, status, valid_until, created_at
          from payments where user_id = p_id order by created_at desc) x), '[]'::json),
    'log', coalesce((select json_agg(x) from (
        select a.action, a.detail, a.at, pr.handle as admin_handle
          from admin_actions a left join profiles pr on pr.id = a.admin_id
         where a.target = p_id::text order by a.at desc limit 20) x), '[]'::json)
  ) into out;
  return out;
end $$;

-- ------------------------------------------------------------------ activity
-- The newest of everything people do, one feed. Page with p_before (the last item's time).
create or replace function admin_activity(p_limit integer default 50, p_before timestamptz default null)
returns json language plpgsql security definer set search_path = public as $$
declare lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
        before timestamptz := coalesce(p_before, 'infinity'); out json;
begin
  perform admin_begin();
  select coalesce(json_agg(e), '[]'::json) into out from (
    select u.*, pr.handle from (
      (select 'signup'::text as kind, p.created_at as at, p.id as user_id, p.id::text as ref,
              ''::text as title, ''::text as body, ''::text as photo_path
         from profiles p where p.created_at < before order by p.created_at desc limit lim)
      union all
      (select 'post', po.created_at, po.author_id, po.id, pl.name, po.caption, po.photo_path
         from posts po join places pl on pl.id = po.place_id
        where po.created_at < before order by po.created_at desc limit lim)
      union all
      (select 'place', pl.added_at, pl.added_by, pl.id, pl.name,
              concat_ws(', ', nullif(pl.region, ''), nullif(pl.country, '')), ''
         from places pl where pl.added_by is not null and pl.added_at < before order by pl.added_at desc limit lim)
      union all
      (select 'trip', t.updated_at, t.owner_id, t.id, t.title, jsonb_array_length(t.stops)::text || ' stops', ''
         from trips t where t.updated_at < before order by t.updated_at desc limit lim)
      union all
      (select 'invite', m.invited_at, m.invited_by, m.trip_id, t.title, '@' || ip.handle || ' · ' || m.status, ''
         from trip_members m join trips t on t.id = m.trip_id join profiles ip on ip.id = m.user_id
        where m.invited_at < before order by m.invited_at desc limit lim)
      union all
      (select 'review', r.created_at, r.user_id, r.id, pl.name, r.note, ''
         from reviews r join places pl on pl.id = r.place_id
        where r.created_at < before order by r.created_at desc limit lim)
      union all
      (select 'comment', c.created_at, c.user_id, c.id, '', c.body, ''
         from comments c where c.created_at < before order by c.created_at desc limit lim)
      union all
      (select 'listing', l.created_at, l.owner_id, l.id, l.name, l.category, l.photo_path
         from listings l where l.created_at < before order by l.created_at desc limit lim)
      union all
      (select 'payment', pa.created_at, pa.user_id, pa.id, pa.plan,
              'Rs ' || (pa.amount_paise / 100)::text || ' · ' || pa.status, ''
         from payments pa where pa.created_at < before order by pa.created_at desc limit lim)
    ) u left join profiles pr on pr.id = u.user_id
    order by u.at desc limit lim
  ) e;
  return out;
end $$;

-- ------------------------------------------------------------------ content lists
create or replace function admin_content(p_kind text, p_query text default '',
                                         p_limit integer default 50, p_offset integer default 0)
returns json language plpgsql security definer set search_path = public as $$
declare
  q   text := lower(btrim(coalesce(p_query, '')));
  lim int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  off int  := greatest(coalesce(p_offset, 0), 0);
  out json;
begin
  perform admin_begin();
  if p_kind = 'posts' then
    with m as (
      select po.id, po.photo_path, po.caption, po.created_at, po.located_distance_m,
             pl.name as place, po.author_id as user_id, pr.handle
        from posts po join places pl on pl.id = po.place_id join profiles pr on pr.id = po.author_id
       where q = '' or position(q in lower(po.caption || ' ' || pl.name || ' ' || pr.handle)) > 0)
    select json_build_object('total', (select count(*) from m), 'rows', coalesce((select json_agg(x) from (
      select * from m order by created_at desc limit lim offset off) x), '[]'::json)) into out;
  elsif p_kind = 'places' then
    -- Catalogue places (wd_…) ship with the app and aren't listed here.
    with m as (
      select pl.id, pl.name, pl.region, pl.country, pl.added_at as created_at, pl.added_by as user_id, pr.handle,
             (select count(*) from posts where place_id = pl.id) as posts
        from places pl left join profiles pr on pr.id = pl.added_by
       where left(pl.id, 3) <> 'wd_'
         and (q = '' or position(q in lower(pl.name || ' ' || pl.region || ' ' || pl.country || ' ' || coalesce(pr.handle, ''))) > 0))
    select json_build_object('total', (select count(*) from m), 'rows', coalesce((select json_agg(x) from (
      select * from m order by created_at desc limit lim offset off) x), '[]'::json)) into out;
  elsif p_kind = 'listings' then
    with m as (
      select l.id, l.name, l.category, l.phone, l.address, l.photo_path, l.hidden, l.verified, l.plan,
             l.created_at, l.owner_id as user_id, pr.handle
        from listings l left join profiles pr on pr.id = l.owner_id
       where q = '' or position(q in lower(l.name || ' ' || l.address || ' ' || l.category || ' ' || coalesce(pr.handle, ''))) > 0)
    select json_build_object('total', (select count(*) from m), 'rows', coalesce((select json_agg(x) from (
      select * from m order by created_at desc limit lim offset off) x), '[]'::json)) into out;
  elsif p_kind = 'reviews' then
    with m as (
      select r.id, r.note, r.ratings, r.created_at, pl.name as place, r.user_id, pr.handle
        from reviews r join places pl on pl.id = r.place_id join profiles pr on pr.id = r.user_id
       where q = '' or position(q in lower(r.note || ' ' || pl.name || ' ' || pr.handle)) > 0)
    select json_build_object('total', (select count(*) from m), 'rows', coalesce((select json_agg(x) from (
      select * from m order by created_at desc limit lim offset off) x), '[]'::json)) into out;
  elsif p_kind = 'comments' then
    with m as (
      select c.id, c.body, c.created_at, c.post_id, c.user_id, pr.handle
        from comments c join profiles pr on pr.id = c.user_id
       where q = '' or position(q in lower(c.body || ' ' || pr.handle)) > 0)
    select json_build_object('total', (select count(*) from m), 'rows', coalesce((select json_agg(x) from (
      select * from m order by created_at desc limit lim offset off) x), '[]'::json)) into out;
  elsif p_kind = 'trips' then
    with m as (
      select t.id, t.title, t.updated_at as created_at, t.starts_on, jsonb_array_length(t.stops) as stops,
             (select count(*) from trip_members tm where tm.trip_id = t.id and tm.status = 'accepted') as members,
             (select count(*) from trip_members tm where tm.trip_id = t.id and tm.status = 'pending') as pending,
             t.owner_id as user_id, pr.handle
        from trips t join profiles pr on pr.id = t.owner_id
       where q = '' or position(q in lower(t.title || ' ' || pr.handle)) > 0)
    select json_build_object('total', (select count(*) from m), 'rows', coalesce((select json_agg(x) from (
      select * from m order by created_at desc limit lim offset off) x), '[]'::json)) into out;
  else
    raise exception 'Unknown kind %', p_kind;
  end if;
  return out;
end $$;

-- ------------------------------------------------------------------ actions
-- Removes one thing and returns the photo files that went with it, for the
-- app to delete from storage (SQL can't remove storage files).
create or replace function admin_delete(p_kind text, p_id text) returns json
language plpgsql security definer set search_path = public as $$
declare photos text[] := '{}'; snap jsonb;
begin
  perform admin_begin();
  if p_kind = 'post' then
    delete from posts where id = p_id
      returning array[photo_path], jsonb_build_object('author', author_id, 'place', place_id, 'caption', caption)
      into photos, snap;
  elsif p_kind = 'place' then
    if left(p_id, 3) = 'wd_' then
      raise exception 'That place is part of the Trekov catalogue and ships with the app, so it can''t be removed here.';
    end if;
    select coalesce(array_agg(photo_path), '{}') into photos from posts where place_id = p_id;
    delete from places where id = p_id
      returning jsonb_build_object('name', name, 'added_by', added_by, 'photos', cardinality(photos)) into snap;
  elsif p_kind = 'review' then
    delete from reviews where id = p_id
      returning jsonb_build_object('user', user_id, 'place', place_id, 'note', note) into snap;
  elsif p_kind = 'comment' then
    delete from comments where id = p_id
      returning jsonb_build_object('user', user_id, 'post', post_id, 'body', body) into snap;
  elsif p_kind = 'listing' then
    delete from listings where id = p_id
      returning case when photo_path <> '' then array[photo_path] else '{}'::text[] end,
                jsonb_build_object('name', name, 'owner', owner_id)
      into photos, snap;
  elsif p_kind = 'trip' then
    delete from trips where id = p_id
      returning jsonb_build_object('title', title, 'owner', owner_id) into snap;
  else
    raise exception 'Unknown kind %', p_kind;
  end if;
  if snap is null then raise exception 'It was already removed.'; end if;
  insert into admin_actions (admin_id, action, target, detail) values (auth.uid(), 'delete_' || p_kind, p_id, snap);
  return json_build_object('photos', coalesce(photos, '{}'));
end $$;

create or replace function admin_set_founding(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform admin_begin(case when p_on then 'founding_on' else 'founding_off' end, p_id::text);
  update profiles set founding = coalesce(p_on, false) where id = p_id;
  if not found then raise exception 'No such account.'; end if;
end $$;

-- Gives (or takes away) a plan without a payment — a gift, a refund, a fix.
create or replace function admin_set_plan(p_id uuid, p_plan text, p_until date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_plan not in ('rider', 'business') then raise exception 'Unknown plan %', p_plan; end if;
  perform admin_begin('set_plan', p_id::text, jsonb_build_object('plan', p_plan, 'until', p_until));
  if p_plan = 'business' then
    update profiles set business_until = p_until where id = p_id;
  else
    update profiles set member_until = p_until where id = p_id;
  end if;
  if not found then raise exception 'No such account.'; end if;
end $$;

-- Blocks sign-in for p_days (0 or null lifts the ban) and ends their sessions.
-- A phone that is already signed in keeps its current token for up to an hour.
create or replace function admin_ban(p_id uuid, p_days integer) returns void
language plpgsql security definer set search_path = public as $$
declare banning boolean := coalesce(p_days, 0) > 0;
begin
  if p_id = auth.uid() then raise exception 'You can''t ban your own account.'; end if;
  if banning and exists (select 1 from admins where user_id = p_id) then
    raise exception 'That account is an admin. Remove its admin access first (SQL editor).';
  end if;
  perform admin_begin(case when banning then 'ban' else 'unban' end, p_id::text,
                      case when banning then jsonb_build_object('days', p_days) else '{}'::jsonb end);
  update auth.users set banned_until = case when banning then now() + make_interval(days => p_days) end
   where id = p_id;
  if not found then raise exception 'No such account.'; end if;
  if banning then delete from auth.sessions where user_id = p_id; end if;
end $$;

create or replace function admin_sign_out(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_id = auth.uid() then raise exception 'Use Sign out on your own account instead.'; end if;
  perform admin_begin('sign_out', p_id::text);
  delete from auth.sessions where user_id = p_id;
end $$;

-- Lets someone who lost their phone sign in on a new one without being refused.
create or replace function admin_reset_device(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_id = auth.uid() then raise exception 'Sign in again on the device you want instead.'; end if;
  perform admin_begin('reset_device', p_id::text);
  update profiles set active_device = null where id = p_id;
  if not found then raise exception 'No such account.'; end if;
end $$;

create or replace function admin_listing(p_id text, p_hidden boolean default null, p_verified boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_begin('listing', p_id, jsonb_strip_nulls(jsonb_build_object('hidden', p_hidden, 'verified', p_verified)));
  update listings set hidden = coalesce(p_hidden, hidden), verified = coalesce(p_verified, verified) where id = p_id;
  if not found then raise exception 'No such listing.'; end if;
end $$;

-- The paywall switch, the pre-release offer's end and the prices. Nulls leave a setting as it is.
create or replace function admin_settings(p_paywall boolean default null, p_offer_ends_at timestamptz default null,
                                          p_rider integer default null, p_business integer default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_rider is not null and p_rider not between 1 and 100000 then raise exception 'Rider price must be Rs 1–100000.'; end if;
  if p_business is not null and p_business not between 1 and 100000 then raise exception 'Business price must be Rs 1–100000.'; end if;
  perform admin_begin('settings', 'app_settings', jsonb_strip_nulls(jsonb_build_object(
    'paywall', p_paywall, 'offer_ends_at', p_offer_ends_at, 'rider_price_inr', p_rider, 'business_price_inr', p_business)));
  update app_settings set
    paywall_since      = case when p_paywall is null then paywall_since
                              when p_paywall then coalesce(paywall_since, now()) end,
    offer_ends_at      = coalesce(p_offer_ends_at, offer_ends_at),
    rider_price_inr    = coalesce(p_rider, rider_price_inr),
    business_price_inr = coalesce(p_business, business_price_inr);
end $$;

create or replace function admin_log(p_limit integer default 100) returns json
language plpgsql security definer set search_path = public as $$
declare out json;
begin
  perform admin_begin();
  select coalesce(json_agg(x), '[]'::json) into out from (
    select a.id, a.action, a.target, a.detail, a.at, pr.handle as admin_handle,
           (select handle from profiles t where t.id::text = a.target) as target_handle
      from admin_actions a left join profiles pr on pr.id = a.admin_id
     order by a.at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x;
  return out;
end $$;

-- ------------------------------------------------------------------ who may call them
revoke all on function admin_overview() from public, anon;
revoke all on function admin_users(text, text, integer, integer) from public, anon;
revoke all on function admin_user(uuid) from public, anon;
revoke all on function admin_activity(integer, timestamptz) from public, anon;
revoke all on function admin_content(text, text, integer, integer) from public, anon;
revoke all on function admin_delete(text, text) from public, anon;
revoke all on function admin_set_founding(uuid, boolean) from public, anon;
revoke all on function admin_set_plan(uuid, text, date) from public, anon;
revoke all on function admin_ban(uuid, integer) from public, anon;
revoke all on function admin_sign_out(uuid) from public, anon;
revoke all on function admin_reset_device(uuid) from public, anon;
revoke all on function admin_listing(text, boolean, boolean) from public, anon;
revoke all on function admin_settings(boolean, timestamptz, integer, integer) from public, anon;
revoke all on function admin_log(integer) from public, anon;
-- Signed-in accounts may call them; each one refuses anyone who isn't an admin.
grant execute on function admin_overview() to authenticated;
grant execute on function admin_users(text, text, integer, integer) to authenticated;
grant execute on function admin_user(uuid) to authenticated;
grant execute on function admin_activity(integer, timestamptz) to authenticated;
grant execute on function admin_content(text, text, integer, integer) to authenticated;
grant execute on function admin_delete(text, text) to authenticated;
grant execute on function admin_set_founding(uuid, boolean) to authenticated;
grant execute on function admin_set_plan(uuid, text, date) to authenticated;
grant execute on function admin_ban(uuid, integer) to authenticated;
grant execute on function admin_sign_out(uuid) to authenticated;
grant execute on function admin_reset_device(uuid) to authenticated;
grant execute on function admin_listing(text, boolean, boolean) to authenticated;
grant execute on function admin_settings(boolean, timestamptz, integer, integer) to authenticated;
grant execute on function admin_log(integer) to authenticated;

-- ------------------------------------------------------------------ photo files
-- Removing a post removes its file too; admins may delete any file in the bucket.
drop policy if exists admin_read_photos on storage.objects;
create policy admin_read_photos on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_admin());
drop policy if exists admin_delete_photos on storage.objects;
create policy admin_delete_photos on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

notify pgrst, 'reload schema';

-- ------------------------------------------------------------------ the admins
-- Add an existing account as an admin (the account must have signed up first):
--   insert into admins (user_id) select id from auth.users where lower(email) = lower('someone@example.com')
--   on conflict do nothing;
-- Remove one:
--   delete from admins where user_id = (select id from auth.users where lower(email) = lower('someone@example.com'));
-- Admin needs two-step sign-in: the admin screen sets up an authenticator app
-- the first time. An admin who lost that phone can't get in — remove their
-- authenticator here, and the admin screen offers to set up a new one:
--   delete from auth.mfa_factors where user_id = (select id from auth.users where lower(email) = lower('someone@example.com'));
