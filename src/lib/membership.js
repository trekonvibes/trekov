// Paid accounts — Rs 99/year for riders, Rs 499/year for businesses — and one
// device per account. The server decides both (supabase/memberships.sql);
// this file asks it, claims this device, notices when another device takes
// over, and runs Razorpay Checkout.
//
// Until the paywall is switched on (app_settings.paywall_since, set once
// Razorpay payments work) the server says everyone is a member, so nothing
// here gets in anyone's way.

import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { deviceId } from './device'

const OPEN = { paywallOn: false, offerActive: false, offerEndsAt: null, isMember: true, isBusiness: true, founding: false, memberUntil: null,
  businessUntil: null, activeDevice: null, riderPrice: 99, businessPrice: 499 }

/** "31 October 2026" — the last day of the pre-release offer, India time. */
export const offerLastDay = (endsAt) => endsAt
  ? new Date(Date.parse(endsAt) - 1).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })
  : ''

/** Public prices and whether the paywall is on — readable signed out. */
export async function getPricing() {
  if (!supabase) return { paywallOn: false, riderPrice: 99, businessPrice: 499 }
  const { data } = await supabase.from('app_settings')
    .select('paywall_since, offer_ends_at, rider_price_inr, business_price_inr').maybeSingle()
  if (!data) return { paywallOn: false, offerActive: false, offerEndsAt: null, riderPrice: 99, businessPrice: 499 }
  const offerActive = Boolean(data.offer_ends_at) && Date.now() < Date.parse(data.offer_ends_at)
  return {
    paywallOn: Boolean(data.paywall_since) && !offerActive, offerActive, offerEndsAt: data.offer_ends_at,
    riderPrice: data.rider_price_inr, businessPrice: data.business_price_inr,
  }
}

/** Your plan and device status. Signed out, just the prices. */
export async function getMembership() {
  if (!supabase) return OPEN
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ...OPEN, ...(await getPricing()), isMember: false, isBusiness: false, signedOut: true }
  const { data, error } = await supabase.rpc('my_membership')
  // Before memberships.sql is applied the function doesn't exist: stay open.
  if (error || !data) return { ...OPEN, unavailable: true }
  return {
    paywallOn: data.paywall_on, offerActive: Boolean(data.offer_active), offerEndsAt: data.offer_ends_at ?? null,
    isMember: data.is_member, isBusiness: data.is_business, founding: data.founding,
    memberUntil: data.member_until, businessUntil: data.business_until, activeDevice: data.active_device,
    riderPrice: data.rider_price_inr, businessPrice: data.business_price_inr,
  }
}

let current = null
const subscribers = new Set()
const publish = (m) => { current = m; subscribers.forEach((f) => f()) }
export const useMembership = () =>
  useSyncExternalStore((f) => { subscribers.add(f); return () => subscribers.delete(f) }, () => current)
export async function refreshMembership() { publish(await getMembership()); return current }

/** The latest sign-in wins: this device becomes the account's only one. */
export async function claimThisDevice() {
  if (!supabase) return
  const { error } = await supabase.rpc('claim_device', { p_device: deviceId() })
  if (error) { console.info('Trekov: device claim unavailable —', error.message); return }
  // Ends the other devices' sessions. Their current token lasts until it
  // expires, so they also check (watchDevice) and the server refuses their writes.
  await supabase.auth.signOut({ scope: 'others' }).catch(() => {})
}

/** A saved session on app start: claim if no device has yet, or report being replaced. */
export async function checkDevice() {
  const m = await getMembership()
  if (m.unavailable || m.signedOut) return 'ok'
  if (!m.activeDevice) { await claimThisDevice(); return 'ok' }
  return m.activeDevice === deviceId() ? 'ok' : 'replaced'
}

/** Calls onReplaced when another device takes the account over. */
export function watchDevice(onReplaced) {
  let stopped = false
  const check = async () => {
    if (stopped || document.hidden || !navigator.onLine) return
    const m = await getMembership()
    if (!stopped && !m.unavailable && !m.signedOut && m.activeDevice && m.activeDevice !== deviceId()) onReplaced()
  }
  const timer = setInterval(check, 30_000)
  const onVisible = () => { if (!document.hidden) check() }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', check)
  return () => {
    stopped = true
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', check)
  }
}

const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js'
const loadCheckout = () => (window.Razorpay ? Promise.resolve() : new Promise((ok, fail) => {
  const s = document.createElement('script')
  s.src = CHECKOUT_JS
  s.onload = ok
  s.onerror = () => fail(new Error('Could not open the payment window. Check your connection.'))
  document.head.appendChild(s)
}))

async function fnError(error, fallback) {
  try { const body = await error.context?.json?.(); return body?.error || fallback } catch { return fallback }
}

/** Pays for a plan with Razorpay; resolves with the date the plan now runs to. */
export async function buyPlan(plan, { name = '', email = '' } = {}) {
  const { data: order, error } = await supabase.functions.invoke('razorpay-order', { body: { plan } })
  if (error) throw new Error(await fnError(error, 'Payments are being set up — please try again soon.'))
  await loadCheckout()
  const paid = await new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: order.key_id, order_id: order.order_id, amount: order.amount, currency: order.currency,
      name: 'Trekov', description: plan === 'business' ? 'Business plan · 1 year' : 'Rider account · 1 year',
      prefill: { name, email: email || order.email || '' },
      theme: { color: '#00C08B' },
      handler: resolve,
      modal: { ondismiss: () => reject(new Error('Payment cancelled.')) },
    })
    checkout.on('payment.failed', (r) => reject(new Error(r?.error?.description || 'Payment failed.')))
    checkout.open()
  })
  // Confirm on the server. If Razorpay hasn't captured it yet, the webhook
  // finishes the job — so try a few times before saying so.
  for (let i = 0; i < 6; i++) {
    const { data, error: vErr } = await supabase.functions.invoke('razorpay-verify', { body: paid })
    if (vErr) throw new Error(await fnError(vErr, 'We could not confirm the payment yet. If you were charged, it will activate shortly.'))
    if (data?.ok) return data.validUntil
    await new Promise((r) => setTimeout(r, 2500))
  }
  throw new Error('Payment received — activation is taking a moment and will show here shortly.')
}
