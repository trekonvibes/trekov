// Demo content.
//
// A place is the first-class record here — posts hang off it. That mirrors how
// the app is used: you zoom to somewhere, then look at what people shot there.
//
// Placeholder imagery only — swap for real photos before this goes near a user.
import { defaultAvatar } from './avatar'

const photo = (slug) => `https://picsum.photos/seed/trekov-${slug}/900/1200`
const face = (who) => `https://i.pravatar.cc/200?u=trekov-${who}`

export const USERS = {
  // You start with a drawn initial, never a stranger's face.
  u_me:    { id: 'u_me',    name: 'You',            handle: 'you',           avatar: defaultAvatar('you') },
  u_aria:  { id: 'u_aria',  name: 'Aria Nandan',    handle: 'ariaflies',     avatar: face('1') },
  u_kabir: { id: 'u_kabir', name: 'Kabir Sethi',    handle: 'kabirshoots',   avatar: face('2') },
  u_mei:   { id: 'u_mei',   name: 'Mei Lin',        handle: 'meiwanders',    avatar: face('3') },
  u_tara:  { id: 'u_tara',  name: 'Tara Fernandes', handle: 'tarafromabove', avatar: face('4') },
  u_dev:   { id: 'u_dev',   name: 'Dev Rathore',    handle: 'devonfoot',     avatar: face('5') },
}

const P = (id, name, region, lat, lng, bestTime, blurb, country = 'India') =>
  ({ id, name, region, country, lat, lng, bestTime, blurb })

export const PLACES = [
  P('pangong',   'Pangong Tso',        'Ladakh',          33.750, 78.650, 'Jun–Sep', 'A 134km lake at 14,000ft that changes colour through the day. Most of it is in Tibet.'),
  P('nubra',     'Nubra Valley',       'Ladakh',          34.650, 77.550, 'Jun–Sep', 'Cold desert with dunes and double-humped camels, over the Khardung La.'),
  P('gurez',     'Gurez Valley',       'Kashmir',         34.630, 74.830, 'May–Oct', 'Two guesthouses, one road in, and the Kishanganga running through all of it.'),
  P('kutch',     'Rann of Kutch',      'Gujarat',         23.850, 69.860, 'Nov–Feb', 'White salt to the horizon in every direction. No scale reference anywhere.'),
  P('munnar',    'Munnar Tea Hills',   'Kerala',          10.090, 77.060, 'Sep–Mar', 'Tea rows that read like contour lines from the air.'),
  P('alleppey',  'Alleppey Backwaters','Kerala',           9.500, 76.340, 'Nov–Feb', 'Skip the big houseboats. A small country boat through the narrow canals is the thing.'),
  P('key',       'Key Monastery',      'Spiti Valley',    32.298, 78.012, 'Jun–Sep', 'Thousand-year-old monastery stacked on a hill at 13,600ft.'),
  P('chandratal','Chandratal Lake',    'Spiti Valley',    32.480, 77.610, 'Jun–Sep', 'Crescent-shaped lake reached on foot from the road. Camp on the far side.'),
  P('nohkalikai','Nohkalikai Falls',   'Meghalaya',       25.276, 91.685, 'Sep–Nov', 'Tallest plunge waterfall in the country, in one of the wettest places on earth.'),
  P('hampi',     'Hampi Boulders',     'Karnataka',       15.335, 76.460, 'Oct–Feb', 'Ruins and granite boulders for 40 square kilometres.'),
  P('gurudongmar','Gurudongmar Lake',  'Sikkim',          28.020, 88.710, 'Apr–Jun', 'One of the highest lakes in the world at 17,800ft. Permits take two days.'),
  P('radhanagar','Radhanagar Beach',   'Andaman Islands', 11.983, 92.953, 'Nov–Apr', 'Sunset side of Havelock. Empty by 7am if you can get out of bed.'),
  P('valleyflowers','Valley of Flowers','Uttarakhand',    30.728, 79.605, 'Jul–Aug', 'Only worth it in monsoon, which is exactly when it is hardest to reach.'),
  P('jaisalmer', 'Jaisalmer Fort',     'Rajasthan',       26.912, 70.912, 'Nov–Feb', 'A fort people still live inside. Go up at golden hour, stay for the blue hour.'),
]

// [id, placeId, author, daysAgo, imageSlug, caption, tags, likes]
const RAW = [
  ['p1',  'pangong',    'u_aria',  4,  'himalaya-lake',      'Held the drone up for four minutes before my fingers gave out. Worth every second of the cold.', ['lake','aerial'], 2841],
  ['p2',  'pangong',    'u_dev',   9,  'pangong-shore',      'Shore camp on the Merak side. Far quieter than the Spangmik strip everyone drives to.', ['camping','lake'], 1120],
  ['p3',  'pangong',    'u_mei',   21, 'pangong-dawn',       'Woke at 5 for this. The colour holds for about twenty minutes and then it is just a blue lake.', ['sunrise'], 1980],
  ['p4',  'nubra',      'u_kabir', 6,  'nubra-dunes',        'Dunes at 10,000ft, which still makes no sense to me.', ['desert','dunes'], 903],
  ['p5',  'nubra',      'u_tara',  30, 'nubra-camel',        'The camels are real and the ride is short. Stay for the light instead.', ['culture'], 641],
  ['p6',  'gurez',      'u_kabir', 5,  'kashmir-valley',     'Almost nobody comes here. Carry cash, there is no ATM past Bandipora.', ['offbeat','valley'], 1203],
  ['p7',  'gurez',      'u_aria',  18, 'gurez-river',        'Habba Khatoon peak from the riverbed. Army permits still apply — carry ID.', ['river'], 770],
  ['p8',  'kutch',      'u_tara',  5,  'desert-saltflat',    'Full moon night on the salt. The drone shots look fake and I have stopped explaining.', ['saltflat','sunset'], 3492],
  ['p9',  'kutch',      'u_dev',   40, 'kutch-village',      'Bhungas in Hodka village, painted by hand every year.', ['culture','craft'], 812],
  ['p10', 'munnar',     'u_mei',   6,  'tea-plantation',     'Go on a weekday. The roads are a car park otherwise.', ['hills','aerial'], 1876],
  ['p11', 'munnar',     'u_kabir', 26, 'munnar-mist',        'Best light is right after the morning mist lifts, around 7:30.', ['mist'], 1004],
  ['p12', 'alleppey',   'u_kabir', 10, 'backwater-boat',     'A country boat at 5pm through the narrow canals is the actual thing.', ['boat','slow'], 2054],
  ['p13', 'alleppey',   'u_tara',  33, 'alleppey-canal',     'The canals behind the main channel are where people actually live.', ['village'], 690],
  ['p14', 'key',        'u_dev',   7,  'monastery-himalaya', 'Stayed the night. The monks feed you dal at 6am and nobody asks for anything.', ['monastery','culture'], 2210],
  ['p15', 'key',        'u_mei',   28, 'key-winter',         'Same building in March. The road opens late — check before you commit.', ['winter'], 880],
  ['p16', 'chandratal', 'u_aria',  12, 'chandratal-camp',    'Camp on the far side, away from the road. Sound carries across the whole basin.', ['lake','camping'], 1450],
  ['p17', 'nohkalikai', 'u_aria',  8,  'waterfall-cliff',    'It rains here more than almost anywhere on earth. Plan for grey and be surprised.', ['waterfall','monsoon'], 1544],
  ['p18', 'nohkalikai', 'u_dev',   35, 'nohkalikai-pool',    'The plunge pool turns green in dry months and brown after heavy rain.', ['monsoon'], 522],
  ['p19', 'hampi',      'u_tara',  9,  'hampi-ruins',        'Rent a cycle, get lost on purpose. The boulders make no geological sense.', ['ruins','unesco'], 987],
  ['p20', 'hampi',      'u_mei',   24, 'hampi-sunrise',      'Matanga Hill for sunrise. Twenty minutes up in the dark, worth the alarm.', ['sunrise'], 1310],
  ['p21', 'gurudongmar','u_mei',   11, 'mountain-lake',      'Permits take two days — start them before you arrive in Gangtok.', ['high-altitude','permit'], 3110],
  ['p22', 'gurudongmar','u_kabir', 44, 'gurudongmar-frozen', 'Frozen edge in April. You get about an hour up here before the guides move you on.', ['winter'], 1188],
  ['p23', 'radhanagar', 'u_dev',   13, 'beach-sunset',       'Empty by 7am if you can drag yourself out.', ['beach','sunset'], 1699],
  ['p24', 'radhanagar', 'u_aria',  38, 'radhanagar-palm',    'The tree line comes right down to the sand on the north end.', ['island'], 745],
  ['p25', 'valleyflowers','u_tara',15, 'valley-flowers',     'Four hours up from Ghangaria and only open in monsoon. Bring real rain gear.', ['trek','monsoon'], 1622],
  ['p26', 'jaisalmer',  'u_kabir', 16, 'jaisalmer-fort',     'A fort people still live inside. Go up at golden hour, stay for the blue hour.', ['fort','desert'], 2088],
  ['p27', 'jaisalmer',  'u_dev',   48, 'jaisalmer-dunes',    'Sam dunes are a circus at sunset. Drive another 40 minutes for silence.', ['dunes'], 934],
]

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString()

export const POSTS = RAW.map(([id, placeId, authorId, days, slug, caption, tags, likes]) => ({
  id, placeId, authorId,
  createdAt: daysAgo(days),
  media: { type: 'image', src: photo(slug) },
  caption, tags, likes,
  comments: [],
}))

const byId = (id) => POSTS.find((p) => p.id === id)

;(byId('p1') ?? POSTS[0]).comments = [
  { id: 'c1', userId: 'u_dev', text: 'The colour shift around 4pm here is unreal.', createdAt: daysAgo(3) },
  { id: 'c2', userId: 'u_mei', text: 'How bad was the altitude on day one?',        createdAt: daysAgo(3) },
]
;(byId('p6') ?? POSTS[1]).comments = [
  { id: 'c3', userId: 'u_aria', text: 'Adding this immediately.', createdAt: daysAgo(4) },
]

// A few seeded opinions so ratings are not blank on a first run.
// [placeId, userId, view, cleanliness, access, safety, facilities, note, facts]
const RAW_REVIEWS = [
  ['pangong',    'u_dev',   5, 4, 2, 4, 2, 'Unreal water. Bring layers, the wind is relentless.', ['car','limited','carry','permit']],
  ['pangong',    'u_mei',   5, 3, 2, 4, 2, 'Toilets are basic at best. Worth it anyway.', ['car','limited','carry','permit']],
  ['gurez',      'u_aria',  5, 5, 2, 3, 2, 'Almost nobody here. Carry cash.', ['car','limited','carry','yes']],
  ['kutch',      'u_tara',  5, 4, 4, 4, 3, 'Go on a full moon. The tent city has real facilities.', ['car','plenty','available','permit']],
  ['munnar',     'u_kabir', 4, 4, 5, 5, 4, 'Easy roads, plenty of stays. Crowded on weekends.', ['car','plenty','available','no']],
  ['alleppey',   'u_tara',  4, 3, 5, 4, 4, 'Water is not clean near the main jetty.', ['public','plenty','available','no']],
  ['key',        'u_mei',   5, 4, 3, 4, 2, 'Stay the night if they let you.', ['bike','limited','carry','permit']],
  ['hampi',      'u_dev',   5, 4, 4, 4, 3, 'Cycle everywhere. Bring your own water.', ['bike','plenty','carry','yes']],
  ['gurudongmar','u_kabir', 5, 5, 1, 3, 1, 'Permits and altitude are the whole difficulty.', ['4x4','none','carry','no']],
  ['radhanagar', 'u_aria',  5, 4, 4, 5, 4, 'Cleanest beach I have seen in India.', ['public','plenty','available','no']],
  ['jaisalmer',  'u_dev',   4, 3, 5, 4, 4, 'The fort is crowded and worth it at sunrise.', ['car','plenty','available','no']],
  ['nohkalikai', 'u_mei',   5, 4, 3, 3, 2, 'Viewpoint railing is solid. Expect rain.', ['car','limited','carry','no']],
]

export const SEED_REVIEWS = RAW_REVIEWS.map(([placeId, userId, view, cleanliness, access, safety, facilities, note, facts = []], i) => ({
  id: `sr_${i}`,
  placeId, userId,
  ratings: { view, cleanliness, access, safety, facilities },
  facts: { transport: facts[0], food: facts[1], water: facts[2], camping: facts[3] },
  note,
  createdAt: daysAgo(i + 2),
}))
