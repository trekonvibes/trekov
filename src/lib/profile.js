// Editing who you are.
//
// The profile is local first, like everything else here: it can be changed
// signed out and offline. When there is an account behind it the same change
// is pushed to `profiles`, because that table is what other travellers search
// when they invite someone to a trip — a handle that only exists on one device
// cannot be found by anyone.

import { supabase } from './supabase'
import { getState, updateProfile } from './store'

/** Handles address people, so keep them to what can be typed and spoken. */
export const HANDLE_HINT = '3–20 characters: lowercase letters, numbers, underscore'
export const normaliseHandle = (s) =>
  s.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
export const validHandle = (s) => /^[a-z0-9_]{3,20}$/.test(s)

// Lives in its own module so the store and the seed can use it without an
// import cycle (this file imports the store).
export { defaultAvatar } from './avatar'

/** Avatar side in pixels. Small enough to live in a text column comfortably. */
export const AVATAR_PX = 256

/**
 * Render a chosen square of a loaded image as the avatar.
 *
 * Deliberately not the blob-in-IndexedDB path that place photos use. Those are
 * full-size, many, and belong to a post that syncs on its own; an avatar is one
 * small square that has to render anywhere a name appears — including from
 * another device, where an IndexedDB key means nothing. At this size the data
 * URL is a few kilobytes and simply travels with the row.
 *
 * @param img   a loaded HTMLImageElement
 * @param crop  { sx, sy, size } in the image's own pixels — the square the
 *              cropper had inside its circle
 */
export function renderAvatar(img, { sx, sy, size }) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_PX
  const ctx = canvas.getContext('2d')
  // Clamp to the image: rounding in the cropper's transform can land a
  // fraction of a pixel outside it, which draws a transparent edge.
  const side = Math.min(size, img.width, img.height)
  const x = Math.max(0, Math.min(img.width - side, sx))
  const y = Math.max(0, Math.min(img.height - side, sy))
  ctx.drawImage(img, x, y, side, side, 0, 0, AVATAR_PX, AVATAR_PX)
  return canvas.toDataURL('image/jpeg', 0.82)
}

/**
 * Save the profile locally, then mirror it to the account when there is one.
 *
 * @returns { ok, synced, reason } — `ok` covers the local save, which is what
 *          the traveller actually sees; `synced` says whether others will see
 *          it too.
 */
export async function saveProfile(patch) {
  updateProfile(patch)

  const account = getState().account
  if (!supabase || !account) return { ok: true, synced: false }

  const { error } = await supabase
    .from('profiles')
    .update({ handle: patch.handle, name: patch.name, bio: patch.bio, avatar: patch.avatar })
    .eq('id', account.id)

  if (error) {
    // The handle is unique across everyone, so this is the one failure worth
    // naming precisely — anything else is a network or policy problem.
    const taken = error.code === '23505'
    return { ok: true, synced: false, reason: taken ? 'taken' : error.message }
  }
  return { ok: true, synced: true }
}
