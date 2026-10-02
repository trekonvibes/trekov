// Shared by the Razorpay functions. Secrets come from the function's
// environment (Supabase dashboard → Edge Functions → Secrets), entered by
// the account owner — never from the app and never from source.
import { createClient } from 'npm:@supabase/supabase-js@2'

export const PLANS = ['rider', 'business'] as const
export type Plan = (typeof PLANS)[number]

const ALLOWED = ['https://trekov.com', 'https://www.trekov.com', 'http://localhost:5173', 'http://localhost:4173']
export function cors(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : 'https://trekov.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } })

export function keys() {
  const id = Deno.env.get('RAZORPAY_KEY_ID') ?? ''
  const secret = Deno.env.get('RAZORPAY_KEY_SECRET') ?? ''
  return id && secret ? { id, secret } : null
}

export async function razorpay(path: string, init: RequestInit = {}) {
  const k = keys()!
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    ...init,
    headers: { Authorization: 'Basic ' + btoa(`${k.id}:${k.secret}`), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error?.description ?? `Razorpay ${res.status}`)
  return body
}

export async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** Constant-time comparison, so a forged signature can't be guessed byte by byte. */
export function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// Projects on the new API keys get SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS
// (JSON, by key name); older ones SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
function envKey(legacy: string, modern: string) {
  const v = Deno.env.get(legacy)
  if (v) return v
  try {
    const all = JSON.parse(Deno.env.get(modern) ?? '{}')
    return String(all.default ?? Object.values(all)[0] ?? '')
  } catch { return '' }
}

/**
 * The caller, from their own JWT. The functions are deployed with the
 * gateway's JWT check off (it does not accept every signing-key setup), so
 * this is the check: no valid session, no user.
 */
export async function caller(req: Request) {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, envKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data } = await client.auth.getUser()
  return { user: data?.user ?? null, client }
}

/** Service-role client (injected by Supabase into every function) — used only to record a verified payment. */
export const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, envKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS'), { auth: { persistSession: false } })

/**
 * Records a captured payment and extends the plan by a year. Idempotent: the
 * same payment id is only ever counted once (grant_plan in memberships.sql).
 */
export async function fulfil(paymentId: string) {
  const payment = await razorpay(`payments/${paymentId}`)
  if (payment.status !== 'captured') return { ok: false, pending: payment.status === 'authorized', status: payment.status }
  const order = await razorpay(`orders/${payment.order_id}`)
  const userId = order?.notes?.user_id
  const plan = order?.notes?.plan
  if (!userId || !PLANS.includes(plan)) throw new Error('Order is missing its Trekov account or plan.')
  if (payment.amount !== order.amount || payment.currency !== 'INR') throw new Error('Payment does not match the order.')
  const { data, error } = await admin().rpc('grant_plan', {
    p_user: userId, p_plan: plan, p_payment: payment.id, p_order: payment.order_id, p_amount: payment.amount,
  })
  if (error) throw new Error(error.message)
  return { ok: true, userId, plan, validUntil: data }
}
