// The admin screen's calls (components/Admin.jsx). The server decides who may
// use them (supabase/admin.sql): only accounts in its `admins` table, on their
// active device — hiding the screen from everyone else is just tidiness.

import { supabase } from './supabase'

export const PAGE = 50

// Dev-only: window.__adminDemo[fn](args) answers instead of the server, so the
// screen can be checked with sample data. Stripped from production builds.
const demo = () => (import.meta.env.DEV ? window.__adminDemo : null)

async function call(fn, args) {
  if (demo()) return demo()[fn](args)
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message || 'Something went wrong.')
  return data
}

/** Is the signed-in account an admin? False signed out, or before admin.sql is applied. */
export async function amIAdmin() {
  if (demo()) return true
  if (!supabase) return false
  const { data, error } = await supabase.rpc('is_admin')
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return false
    throw new Error(error.message)
  }
  return data === true
}

// Two-step sign-in (Punit, 2026-09-11). Admin needs this session confirmed
// with a code from an authenticator app — Supabase MFA, assurance level aal2.
// The server refuses every admin call without it (admin_begin, admin-delete-user).

/** 'ok' (confirmed), 'challenge' (has an authenticator app, needs a code) or 'enroll' (none yet). */
export async function twoStepStatus() {
  if (demo()) return demo().two_step_status?.() ?? 'ok'
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw new Error(error.message)
  if (data.currentLevel === 'aal2') return 'ok'
  return data.nextLevel === 'aal2' ? 'challenge' : 'enroll'
}

/** Starts adding an authenticator app: { factorId, qr (image URL), secret (for typing in) }. */
export async function startTwoStep() {
  if (demo()) return demo().two_step_enroll()
  // A setup that was started but never finished would block a new one.
  const { data: list } = await supabase.auth.mfa.listFactors()
  for (const f of list?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {})
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Trekov admin' })
  if (error) throw new Error(error.message)
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
}

/** Checks a 6-digit code; afterwards this session is confirmed (aal2). */
export async function verifyTwoStep(code, factorId = null) {
  if (demo()) return demo().two_step_verify(code)
  let id = factorId
  if (!id) {
    const { data } = await supabase.auth.mfa.listFactors()
    id = data?.totp?.[0]?.id
    if (!id) throw new Error('No authenticator app is set up yet.')
  }
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code })
  if (error) {
    throw new Error(/invalid|expired|code/i.test(error.message)
      ? "That code didn't work. Use the newest code, and check your phone's clock is set automatically."
      : error.message)
  }
}

export const overview = () => call('admin_overview')

export const listUsers = (query = '', filter = 'all', offset = 0) =>
  call('admin_users', { p_query: query, p_filter: filter, p_limit: PAGE, p_offset: offset })

export const getUser = (id) => call('admin_user', { p_id: id })

/** The newest of everything people do; pass the last item's time for the next page. */
export const activity = (before = null) => call('admin_activity', { p_limit: PAGE, p_before: before })

export const content = (kind, query = '', offset = 0) =>
  call('admin_content', { p_kind: kind, p_query: query, p_limit: PAGE, p_offset: offset })

/** Removes a post, place, review, comment, listing or trip — and its photo files. */
export async function remove(kind, id) {
  const r = await call('admin_delete', { p_kind: kind, p_id: id })
  // The rows are gone; a file left behind is only wasted space, nothing links to it.
  const photos = (r?.photos ?? []).filter(Boolean)
  if (photos.length && supabase) await supabase.storage.from('photos').remove(photos).catch(() => {})
  return r
}

export const setFounding = (id, on) => call('admin_set_founding', { p_id: id, p_on: on })
export const setPlan = (id, plan, until) => call('admin_set_plan', { p_id: id, p_plan: plan, p_until: until || null })
/** days > 0 bans for that long; 0 lifts the ban. */
export const ban = (id, days) => call('admin_ban', { p_id: id, p_days: days })
export const signOutEverywhere = (id) => call('admin_sign_out', { p_id: id })
export const resetDevice = (id) => call('admin_reset_device', { p_id: id })

/**
 * Deletes someone's account for good (edge function admin-delete-user).
 * `confirm` is their @username as typed — the server checks it again.
 */
export async function deleteUser(id, confirm, reason = '') {
  if (demo()) return demo().admin_delete_user({ id, confirm, reason })
  const { data, error } = await supabase.functions.invoke('admin-delete-user', { body: { userId: id, confirm, reason } })
  if (error) {
    let body = null
    try { body = await error.context?.json?.() } catch { /* keep the default */ }
    throw new Error(body?.error || 'Could not delete the account. Check your connection and try again.')
  }
  return data
}

export const setListing =(id, { hidden = null, verified = null }) =>
  call('admin_listing', { p_id: id, p_hidden: hidden, p_verified: verified })

export const saveSettings = ({ paywall = null, offerEndsAt = null, riderPrice = null, businessPrice = null }) =>
  call('admin_settings', { p_paywall: paywall, p_offer_ends_at: offerEndsAt, p_rider: riderPrice, p_business: businessPrice })

export const auditLog = () => call('admin_log', { p_limit: 100 })

/** Reports people filed about posts, comments, reviews, profiles and rides (launch-hardening.sql). */
export const reports = (status = 'open') => call('admin_reports', { p_status: status, p_limit: 200 })
export const resolveReport = (id, status) => call('admin_resolve_report', { p_id: id, p_status: status })
