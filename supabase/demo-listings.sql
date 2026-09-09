-- Trekov — demo partner listings
--
-- Every row is named "Trekov Demo — …" so nobody mistakes these for real
-- businesses. Phone numbers are non-routable placeholders. Delete with:
--
--     delete from listings where id like 'demo_%';
--
-- owner_id stays null: these are admin-seeded, not claimed by any account.
-- The read policy only checks subscribed_until, so they are publicly visible
-- without an owner.
--
-- Placed within ~3km of seeded places, inside the app's 8km search radius:
--   Gurez Valley (34.630, 74.830) · Hampi (15.335, 76.460)
--   Jaisalmer (26.912, 70.912)    · Munnar (10.090, 77.060)

insert into listings (id, category, name, description, phone, address, lat, lng, url, plan, subscribed_until, verified)
values
  -- Gurez Valley — one of every category, so the whole Nearby grid is populated
  ('demo_gz_stay',   'hotel',        'Trekov Demo — Gurez Base Lodge',
   'Riverside rooms, hot water, covered parking for bikes.',
   '+911950000001', 'Dawar, Gurez Valley',      34.6320, 74.8340, '', 'gold',  current_date + 365, true),

  ('demo_gz_food',   'food',         'Trekov Demo — Kishanganga Kitchen',
   'Kashmiri thali, open through the season.',
   '+911950000002', 'Main Bazaar, Dawar',       34.6295, 74.8312, '', 'basic', current_date + 365, false),

  ('demo_gz_street', 'street_food',  'Trekov Demo — Habba Khatoon Chai Stall',
   'Noon chai and kulcha by the bridge.',
   '',              'Bridge Road, Dawar',       34.6338, 74.8287, '', 'basic', current_date + 180, false),

  ('demo_gz_bike',   'bike_service', 'Trekov Demo — Gurez Moto Works',
   'Punctures, chains and spares for Himalayans and Classics.',
   '+911950000004', 'Bandipora Road, Dawar',    34.6270, 74.8360, '', 'gold',  current_date + 365, true),

  ('demo_gz_car',    'car_service',  'Trekov Demo — Valley Auto Garage',
   'Recovery and repairs on the Razdan Pass road.',
   '+911950000005', 'Kanzalwan, Gurez',         34.6410, 74.8205, '', 'basic', current_date + 90,  false),

  ('demo_gz_rental', 'rental',       'Trekov Demo — Razdan Rentals',
   'Bikes and 4x4s, permits arranged.',
   '+911950000006', 'Dawar Market, Gurez',      34.6301, 74.8329, '', 'gold',  current_date + 365, true),

  -- Hampi
  ('demo_hp_stay',   'hotel',        'Trekov Demo — Boulder View Guest House',
   'Rooftop rooms facing the Virupaksha gopuram.',
   '+918390000001', 'Hampi Bazaar',             15.3355, 76.4610, '', 'gold',  current_date + 365, true),

  ('demo_hp_rental', 'rental',       'Trekov Demo — Tungabhadra Scooter Hire',
   'Scooters and cycles by the day, helmets included.',
   '+918390000002', 'Janata Plot, Hampi',       15.3330, 76.4585, '', 'basic', current_date + 365, false),

  -- Jaisalmer
  ('demo_js_stay',   'hotel',        'Trekov Demo — Fort Haveli Rooms',
   'Inside the fort walls, courtyard rooms.',
   '+912992000001', 'Fort Road, Jaisalmer',     26.9125, 70.9128, '', 'gold',  current_date + 365, true),

  ('demo_js_car',    'car_service',  'Trekov Demo — Thar Desert Motors',
   'Desert-road servicing and tyre work.',
   '+912992000002', 'Sam Road, Jaisalmer',      26.9098, 70.9090, '', 'basic', current_date + 270, false),

  -- Munnar
  ('demo_mn_food',   'food',         'Trekov Demo — Tea Estate Canteen',
   'Kerala breakfast from 6am, packed lunches for treks.',
   '+914865000001', 'Munnar–Top Station Road',  10.0915, 77.0620, '', 'basic', current_date + 365, false),

  ('demo_mn_bike',   'bike_service', 'Trekov Demo — Hill Road Motorcycles',
   'Brake and chain work for the ghat sections.',
   '+914865000002', 'Old Munnar',               10.0880, 77.0570, '', 'gold',  current_date + 365, true),

  -- Deliberately lapsed: proves read_live_listings hides expired subscriptions.
  -- If this ever appears in the app, the RLS policy has regressed.
  ('demo_expired',   'hotel',        'Trekov Demo — Expired Guest House',
   'Subscription ended yesterday. This row must NOT appear in the app.',
   '',              'Dawar, Gurez Valley',      34.6310, 74.8300, '', 'basic', current_date - 1,   false)

on conflict (id) do update set
  category         = excluded.category,
  name             = excluded.name,
  description      = excluded.description,
  phone            = excluded.phone,
  address          = excluded.address,
  lat              = excluded.lat,
  lng              = excluded.lng,
  plan             = excluded.plan,
  subscribed_until = excluded.subscribed_until,
  verified         = excluded.verified;

-- Expect 12 visible, 1 hidden.
select
  count(*) filter (where subscribed_until >= current_date) as visible_in_app,
  count(*) filter (where subscribed_until <  current_date) as hidden_expired
from listings where id like 'demo_%';
