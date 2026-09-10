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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()
  return {
    id: user.id,
    email: user.email,
    handle: profile?.handle ?? user.email?.split('@')[0] ?? 'traveller',
    name: profile?.name ?? '',
    avatar: profile?.avatar ?? '',
  }
}

export function onAuthChange(fn) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange(() => { currentAccount().then(fn) })
  return () => data.subscription.unsubscribe()
}
