// The rider's ID on a locked phone (Punit, 2026-09-27).
//
// Whoever reaches a rider who has come off the bike has the phone in front of
// them and no way into it. Android lets an app put two things in front of a
// locked screen, and this uses both while a ride is on:
//
//   - an ongoing notification the lock screen shows in full, with a one-tap
//     dial of the emergency contact (android TrekovSafetyPlugin);
//   - the lock wallpaper, which the rider can set to the card drawn below —
//     the only one that still shows on a phone set to hide notifications.
//
// Neither is possible on an iPhone: no app may write to the lock screen or to
// Apple's own Medical ID. On iOS this stays in the app, and Account points the
// rider at Medical ID instead (Health app -> Medical ID -> Show When Locked).

import { registerPlugin } from '@capacitor/core'
import { isNativeApp, platform } from './platform'

const Safety = registerPlugin('TrekovSafety')

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

/** Only Android can put any of this on a locked phone. */
export const canShowOnLockScreen = () => isNativeApp && platform === 'android'

/** Worth showing when there is anything a stranger could act on. */
export const hasRiderId = (safety) =>
  Boolean(safety && (safety.bloodGroup || safety.emergencyPhone))

const insuranceLine = (safety) => (safety.insured ? 'Insured: yes' : 'Insured: no')

/**
 * What the lock screen reads. Blood group first after the name: it is the one
 * thing a hospital needs and nobody else can supply.
 */
export function riderIdText(profile, safety) {
  const name = (profile?.name || '').trim() || 'Trekov rider'
  const blood = safety.bloodGroup ? `Blood group ${safety.bloodGroup}` : 'Blood group not set'
  const who = (safety.emergencyName || '').trim()
  const contact = safety.emergencyPhone
    ? `Emergency contact: ${who ? `${who} ` : ''}${safety.emergencyPhone}`
    : 'Emergency contact: not set'
  return {
    title: `${name} · ${safety.bloodGroup || '—'}`,
    text: [blood, contact, insuranceLine(safety)].join('\n'),
    phone: safety.emergencyPhone || '',
    callLabel: who ? `Call ${who.split(' ')[0]}` : 'Call contact',
  }
}

/**
 * Put it on the lock screen for the length of a ride. Resolves what actually
 * happened, so the app can tell a rider whose notifications are switched off
 * that their details are not showing.
 */
export async function showRiderId(profile, safety) {
  if (!canShowOnLockScreen() || !hasRiderId(safety)) return { shown: false, reason: 'off' }
  try {
    return await Safety.show(riderIdText(profile, safety))
  } catch (e) {
    console.warn('Trekov: the rider ID could not be shown —', e?.message ?? e)
    return { shown: false, reason: 'failed' }
  }
}

export async function hideRiderId() {
  if (!canShowOnLockScreen()) return
  try { await Safety.hide() } catch { /* nothing was showing */ }
}

/**
 * The card for the lock wallpaper, drawn at the phone's own screen size so it
 * is not stretched. Everything sits in the lower half: the clock, the date and
 * the phone's own shortcuts own the top.
 */
export function drawIdCard(profile, safety) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const w = Math.round((window.screen?.width || 1080) * dpr)
  const h = Math.round((window.screen?.height || 1920) * dpr)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const u = w / 1080                                  // one unit of a 1080-wide phone
  const font = (px, weight = 600) => `${weight} ${Math.round(px * u)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`

  ctx.fillStyle = '#0B0F0E'
  ctx.fillRect(0, 0, w, h)
  // A soft brand wash, so it reads as a card rather than a black screen.
  const wash = ctx.createRadialGradient(w / 2, h * 0.72, 0, w / 2, h * 0.72, w * 0.9)
  wash.addColorStop(0, 'rgba(0,192,139,.16)')
  wash.addColorStop(1, 'rgba(0,192,139,0)')
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, w, h)

  const left = Math.round(90 * u)
  let y = Math.round(h * 0.50)
  ctx.textAlign = 'left'

  ctx.fillStyle = '#00C08B'
  ctx.font = font(34, 700)
  ctx.fillText('IN AN EMERGENCY', left, y)

  y += Math.round(78 * u)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = font(66, 700)
  ctx.fillText((profile?.name || 'Trekov rider').slice(0, 22), left, y)

  const row = (label, value, tone = '#FFFFFF') => {
    y += Math.round(86 * u)
    ctx.fillStyle = 'rgba(255,255,255,.55)'
    ctx.font = font(30, 600)
    ctx.fillText(label.toUpperCase(), left, y)
    y += Math.round(46 * u)
    ctx.fillStyle = tone
    ctx.font = font(52, 700)
    ctx.fillText(value, left, y)
  }

  row('Blood group', safety.bloodGroup || 'Not set', safety.bloodGroup ? '#FF6B7A' : '#FFFFFF')
  row('Emergency contact', safety.emergencyPhone || 'Not set')
  if (safety.emergencyName) {
    y += Math.round(40 * u)
    ctx.fillStyle = 'rgba(255,255,255,.72)'
    ctx.font = font(36, 600)
    ctx.fillText(safety.emergencyName.slice(0, 26), left, y)
  }
  row('Insurance', safety.insured ? 'Yes' : 'No')

  ctx.fillStyle = 'rgba(255,255,255,.4)'
  ctx.font = font(28, 600)
  ctx.fillText('Set by Trekov · this phone is locked', left, h - Math.round(70 * u))

  return canvas.toDataURL('image/png')
}

/** Ask Android to use the card as the lock screen wallpaper. */
export async function setLockCard(profile, safety) {
  if (!canShowOnLockScreen()) throw new Error('not-android')
  await Safety.setLockWallpaper({ png: drawIdCard(profile, safety) })
}

/** Put the phone's own lock wallpaper back. */
export async function clearLockCard() {
  if (!canShowOnLockScreen()) return
  await Safety.clearLockWallpaper()
}
