-- Where to reach a rider's phone when Trekov is closed (Punit, 2026-09-12).
-- Safe to run more than once. Run after memberships.sql and trip-invites.sql.
--
-- One row per phone: the Firebase token, and who it belongs to. A rider may
-- have several (phone and tablet); signing out drops that phone's row, and
-- deleting the account takes them all.
--
-- The app never touches the table directly — it calls the two functions below.
-- That keeps tokens unreadable (a token is only useful for sending, which is
-- the push-send edge function's job, with the service key) and still lets a
-- phone re-claim its own token when a different account signs in on it, which
-- plain row rules cannot express: claiming means updating a row you are not
-- allowed to see.

create table if not exists push_tokens (
  token      text primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  platform   text not null default 'android' check (platform in ('android', 'ios', 'web')),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on push_tokens (user_id);

alter table push_tokens enable row level security;
revoke all on push_tokens from anon, authenticated;

/* This phone, for this account. Firebase hands the same token to whoever signs
   in on it, so registering always takes the token over. */
create or replace function save_push_token(p_token text, p_platform text default 'android')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_token is null or length(p_token) not between 20 and 4096 then raise exception 'That is not a push token.'; end if;
  insert into push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(),
          case when p_platform in ('android', 'ios', 'web') then p_platform else 'android' end,
          now())
  on conflict (token) do update
    set user_id = auth.uid(), platform = excluded.platform, updated_at = now();
end $$;
revoke all on function save_push_token(text, text) from public, anon;
grant execute on function save_push_token(text, text) to authenticated;

/* Signing out. By token alone: the phone holding it is the one asking, and by
   then its session may already be gone. The worst a stranger who somehow knew a
   token could do is stop that phone's notifications. */
create or replace function drop_push_token(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from push_tokens where token = p_token
$$;
revoke all on function drop_push_token(text) from public;
grant execute on function drop_push_token(text) to anon, authenticated;

notify pgrst, 'reload schema';
