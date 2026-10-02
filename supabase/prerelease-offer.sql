-- Pre-release offer (Punit, 2026-09-11): Trekov is free for everyone until the
-- end of 31 October 2026, India time. Nobody can be charged before then, even
-- if the paywall switch (app_settings.paywall_since) is turned on early, and a
-- plan bought during the offer starts when the offer ends.
--
-- Founding members become an explicit flag: the accounts that existed before
-- the offer stay free for good. memberships.sql used to count every account
-- created before the paywall switch as founding, which would have made every
-- pre-release sign-up free for good. memberships.sql now carries the same
-- definitions; this file applies the change to a database that already ran it.
-- Safe to run more than once.

alter table app_settings add column if not exists offer_ends_at timestamptz;
update app_settings set offer_ends_at = '2026-11-01 00:00:00+05:30' where offer_ends_at is null;

-- The accounts that existed before the offer was announced.
update profiles set founding = true where created_at < '2026-09-11 18:00:00+05:30' and not founding;

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
