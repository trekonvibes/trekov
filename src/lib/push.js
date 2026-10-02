// Notifications that reach the phone when Trekov is closed (Punit's Firebase
// project, 2026-09-12).
//
// The app asks Android for permission, registers with Firebase and keeps the
// resulting token in `push_tokens` so the server can reach this phone — one row
// per phone, deleted on sign-out. Nothing here runs on the web, where a rider
// who has the app closed has nothing to receive with.
//
// Alerts still travel over Realtime while apps are open, and a live trip raises
// its own local notification (lib/native.js). This is only for the closed app.

import { isNativeApp, platform } from './platform'
import { supabase } from './supabase'

let token = null
let started = false

async function saveToken(value) {
  if (!supabase) return
  const { data } = await supabase.auth.getSession()
  if (!data?.session) return
  token = value
  // Through a function, not the table: tokens are never readable, and the same
  // phone can take its token over when a different account signs in (push.sql).
  const { error } = await supabase.rpc('save_push_token', { p_token: value, p_platform: platform })
  if (error) console.info('Trekov: could not save the push token —', error.message)
}

/** Ask once, register with Firebase, and remember this phone. */
export async function startPush(onOpenTrip) {
  if (!isNativeApp || !supabase || started) return
  started = true
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    let allowed = (await PushNotifications.checkPermissions()).receive
    if (allowed !== 'granted') allowed = (await PushNotifications.requestPermissions()).receive
    if (allowed !== 'granted') { started = false; return }

    // Android 8+ files every notification under a channel, and the channel —
    // not the message — decides whether it makes a sound or slides in over what
    // you are doing. Ours is high importance so a rider asking to join actually
    // interrupts the host; the person can still turn it down in Settings.
    try {
      // No `sound` key: Capacitor reads that as the name of a file in res/raw,
      // so 'default' pointed at a resource we don't ship and the channel played
      // nothing at all (found on the Fold, 2026-09-12). Left out, the channel
      // uses the phone's own notification sound.
      //
      // A channel's settings are fixed once Android has seen it, so correcting
      // this needs a new id; the first one is deleted so it doesn't sit in
      // Settings confusing anyone.
      await PushNotifications.deleteChannel({ id: 'trekov-alerts' }).catch(() => {})
      await PushNotifications.createChannel({
        id: 'trekov-rides', name: 'Trips and riders',
        description: 'Invites, riders asking to join, and alerts from a group trip.',
        importance: 5, visibility: 1, vibration: true, lights: true,
      })
    } catch { /* iOS, or an Android that manages channels itself */ }

    await PushNotifications.addListener('registration', (t) => saveToken(t.value))
    await PushNotifications.addListener('registrationError', (e) =>
      console.info('Trekov: push registration failed —', e?.error ?? e))
    // Tapped from the shade: open what it is about.
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const tripId = notification?.data?.tripId
      if (tripId) onOpenTrip?.(tripId)
      else window.location.hash = 'trips'
    })
    await PushNotifications.register()
  } catch (e) {
    started = false
    console.info('Trekov: push unavailable —', e?.message ?? e)
  }
}

/** Signing out: this phone stops being reachable for that account. */
export async function stopPush() {
  started = false
  if (!isNativeApp || !supabase || !token) return
  const gone = token
  token = null
  await supabase.rpc('drop_push_token', { p_token: gone })
}

/**
 * Reach the others on a trip whose Trekov is closed (edge function push-send;
 * it checks the sender really is on that trip). Best effort: while their apps
 * are open, Realtime has already told them, and a failure here must never stop
 * an alert going out.
 */
export async function pushToTrip({ tripId, kind = 'alert', title, body, toUserId }) {
  if (!supabase || !tripId || !title) return
  try {
    await supabase.functions.invoke('push-send', { body: { tripId, kind, title, body, toUserId } })
  } catch {
    // Notifications aren't set up, or the phone is offline. Nothing to do.
  }
}
