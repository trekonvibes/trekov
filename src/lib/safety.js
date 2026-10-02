// Reporting people's content and blocking people (Google Play's user-generated
// content policy; launch audit, 2026-09-14). The tables are in
// supabase/launch-hardening.sql: a report goes to Trekov's admins and nobody
// else; a block is private to the person who made it.

import { supabase } from './supabase'
import { forgetPendingBlock, getState, setBlocked } from './store'

export const REASONS = [
  ['spam', 'Spam or advertising'],
  ['abuse', 'Harassment or hate'],
  ['nudity', 'Nudity or sexual content'],
  ['violence', 'Violence or dangerous acts'],
  ['fake', 'Fake or misleading'],
  ['other', 'Something else'],
]

/** kind: post | comment | review | profile | ride. Resolves { ok, reason? }. */
export async function report({ kind, targetId, reason, note = '' }) {
  const account = getState().account
  if (!supabase || !account) return { ok: false, reason: 'Sign in to report.' }
  const { error } = await supabase.from('reports').insert({
    reporter_id: account.id, kind, target_id: String(targetId).slice(0, 80), reason, note: note.slice(0, 500),
  })
  // Reporting the same thing twice is not an error to the person doing it.
  if (error && error.code !== '23505') return { ok: false, reason: 'Could not send the report — try again.' }
  return { ok: true }
}

/** Tells the server about one block or unblock. True once it has it. */
export async function sendBlock(userId, on) {
  const account = getState().account
  if (!supabase || !account) return false
  const { error } = on
    ? await supabase.from('blocks').insert({ blocker_id: account.id, blocked_id: userId })
    : await supabase.from('blocks').delete().eq('blocker_id', account.id).eq('blocked_id', userId)
  const done = !error || error.code === '23505'
  if (done) forgetPendingBlock(userId, on)
  return done
}

/**
 * Hides them straight away on this phone, then tells the server. If the
 * server can't be reached, the next sync sends it — a block made with a weak
 * signal used to stay on the phone only, so the blocked person could still add
 * you to a trip (testing, 2026-09-14).
 */
export async function block(userId, on = true) {
  if (!userId) return { ok: false }
  setBlocked(userId, on)
  return { ok: true, synced: await sendBlock(userId, on) }
}

export const isBlocked = (userId) => (getState().blocked ?? []).includes(userId)
