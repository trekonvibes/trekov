// Starter content: real places with credited photos.
//
// src/lib/catalogue.json is ~300 of India's best-known travel places from
// Wikidata (CC0), each with an openly licensed Wikimedia Commons photo and
// its photographer credit — built by scripts/build-catalogue.py. There are no
// invented users, posts or reviews: the first real Trekov photo taken at a
// place becomes its banner.
import { defaultAvatar } from './avatar'
import CATALOGUE from './catalogue.json'

export const USERS = {
  // You start with a drawn initial, never a stranger's face.
  u_me: { id: 'u_me', name: 'You', handle: 'you', avatar: defaultAvatar('you') },
}

export const PLACES = CATALOGUE.map((p) => ({ bestTime: '', ...p, source: 'catalogue' }))
export const POSTS = []
export const SEED_REVIEWS = []

/** The made-up demo content earlier builds shipped, so load() can clear it out. */
export const RETIRED_DEMO = {
  users: ['u_aria', 'u_kabir', 'u_mei', 'u_tara', 'u_dev'],
  places: ['pangong', 'nubra', 'gurez', 'kutch', 'munnar', 'alleppey', 'key', 'chandratal', 'nohkalikai',
           'hampi', 'gurudongmar', 'radhanagar', 'valleyflowers', 'jaisalmer'],
}
