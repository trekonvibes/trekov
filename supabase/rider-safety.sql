-- The rider's emergency details (Punit, 2026-09-27). Safe to run more than once.
--
-- Blood group is health data, so it lives in its own table rather than in
-- profiles: profiles are readable by other riders (handles, names, avatars),
-- and nothing here should ever be. Only the rider reads or writes their own
-- row — not their group, not the host of a ride they are on.
--
-- The app shows these on the phone's lock screen while a ride is on, so that
-- whoever reaches a rider first can call the right person and tell a hospital
-- the blood group (supabase/../src/lib/riderId.js).

create table if not exists rider_safety (
  user_id         uuid primary key references profiles(id) on delete cascade,
  blood_group     text,
  emergency_name  text,
  emergency_phone text,
  insured         boolean not null default false,
  updated_at      timestamptz not null default now()
);

alter table rider_safety drop constraint if exists rider_safety_blood_check;
alter table rider_safety add constraint rider_safety_blood_check
  check (blood_group is null or blood_group in
    ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));
alter table rider_safety drop constraint if exists rider_safety_length_check;
alter table rider_safety add constraint rider_safety_length_check
  check (length(coalesce(emergency_name, '')) <= 80 and length(coalesce(emergency_phone, '')) <= 24);

alter table rider_safety enable row level security;

-- One policy, the rider's own row, for everything. No can_write() gate here on
-- purpose: an expired plan or a second phone must never stand between a rider
-- and their own emergency details.
drop policy if exists own_safety on rider_safety;
create policy own_safety on rider_safety for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Signed out means refused at the door, not merely filtered by the policy.
revoke all on table rider_safety from anon;

notify pgrst, 'reload schema';
