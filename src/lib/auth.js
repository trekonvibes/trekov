// Signing in: username-or-email + password, with the emailed one-time link
// kept for anyone who has no password or has forgotten it. Passwords are typed
// into this app and go straight to Supabase; the app never stores one.

import { hasSupabase, supabase } from './supabase'

export { hasSupabase }

const redirect = () => `${location.origin}/app/`
export const looksLikeEmail = (s) => /^\S+@\S+\.\S+$/.test(s.trim())
export const PASSWORD_MIN = 8

export async function sendMagicLink(email) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirect() },
  })
  if (error) throw error
}

/** Is this handle free? null when the check itself failed. */
export async function isHandleAvailable(handle) {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('handle_available', { p_handle: handle })
  return error ? null : data
}

/**
 * Create an account with a handle and password. The handle rides along as
 * user metadata and the sign-up trigger gives it to the new profile row.
 * @returns { needsConfirmation } — true while the email is unconfirmed
 */
export async function signUpWithPassword({ email, password, handle }) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(), password,
    options: { emailRedirectTo: redirect(), data: { handle } },
  })
  if (error) throw new Error(/registered|exists/i.test(error.message) ? 'That email already has an account — sign in instead.' : error.message)
  // Supabase answers an already-registered email with a user that has no
  // identities (so it can't be used to test which emails exist).
  if (data.user && data.user.identities?.length === 0) throw new Error('That email already has an account — sign in instead.')
  return { needsConfirmation: !data.session }
}

/** Sign in with @handle or email, plus password. */
export async function signInWithPassword(identifier, password) {
  if (!supabase) throw new Error('Supabase is not configured')
  let email = identifier.trim()
  if (!looksLikeEmail(email)) {
    // The server returns the email only when the password is right, so a
    // handle never reveals whose email is behind it.
    const { data, error } = await supabase.rpc('email_for_login', { p_handle: email, p_password: password })
    if (error) {
      throw new Error(/too_many_attempts/.test(error.message)
        ? 'Too many wrong tries. Wait 15 minutes, or use “Email me a sign-in link”.'
        : 'Could not sign in right now. Please try again.')
    }
    if (!data) throw new Error('Wrong username or password.')
    email = data
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(/not confirmed/i.test(error.message) ? 'Confirm your email first — the link is in your inbox.'
      : /invalid/i.test(error.message) ? 'Wrong username or password.' : error.message)
  }
}

/** Set or change the signed-in user's password. */
export async function setPassword(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

export async function signOut() {
  await supabase?.auth.signOut()
}

/** The signed-in user plus their profile row, or null. */
export async function currentAccount() {
  if (!supabase) return null
  // The session saved on this device, not a server round-trip: the app requires
  // sign-in, and a rider who is signed in must still get in with no signal.
  // (The server checks the token on every request regardless.)
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('id, handle, name, bio, avatar').eq('id', user.id).single()
    .then((r) => r, () => ({ data: null }))
  return {
    id: user.id,
    email: user.email,
    handle: profile?.handle ?? user.email?.split('@')[0] ?? 'traveller',
    name: profile?.name ?? '',
    avatar: profile?.avatar ?? '',
  }
}

/**
 * Emails a one-time sign-in link to the account's address. Opening it brings
 * the person back to the deletion screen with a fresh email sign-in, which
 * the delete-account function requires (within 15 minutes).
 */
export async function sendDeletionLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/app/?delete-account&confirm=1` },
  })
  if (error) throw new Error(/rate|seconds/i.test(error.message) ? 'Please wait a minute before asking for another email.' : error.message)
}

/**
 * Deletes this account for good (supabase/functions/delete-account): photos,
 * posts, reviews, trips, listings and the sign-in. Cannot be undone.
 */
export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } })
  if (error) {
    let body = null
    try { body = await error.context?.json?.() } catch { /* keep the default */ }
    throw Object.assign(new Error(body?.error || 'Could not delete the account. Check your connection and try again.'),
      { needsEmail: Boolean(body?.needsEmail) })
  }
  try { sessionStorage.setItem('trekov.deleted', '1') } catch { /* ignore */ }
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
}

/** Signs out this device only — another device has taken the account over. */
export async function signOutHere() {
  if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
}

export function onAuthChange(fn) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange(() => { currentAccount().then(fn) })
  return () => data.subscription.unsubscribe()
}
