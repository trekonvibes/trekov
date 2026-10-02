// Creates a Razorpay order for the signed-in user's plan. The price comes
// from app_settings in the database, never from the app.
import { caller, cors, json, keys, PLANS, razorpay } from '../_shared/razorpay.ts'

// Deployed with JWT verification off; caller() checks the session itself.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (!keys()) return json(req, { error: 'Payments are being set up — please try again soon.' }, 503)
  const { user, client } = await caller(req)
  if (!user) return json(req, { error: 'Sign in first.' }, 401)
  const { plan } = await req.json().catch(() => ({}))
  if (!PLANS.includes(plan)) return json(req, { error: 'Unknown plan.' }, 400)
  const { data: s, error } = await client.from('app_settings').select('rider_price_inr, business_price_inr').single()
  if (error || !s) return json(req, { error: 'Prices unavailable.' }, 500)
  const amount = (plan === 'business' ? s.business_price_inr : s.rider_price_inr) * 100
  try {
    const order = await razorpay('orders', {
      method: 'POST',
      body: JSON.stringify({ amount, currency: 'INR', receipt: `${plan}-${user.id.slice(0, 8)}-${Date.now()}`, notes: { user_id: user.id, plan } }),
    })
    return json(req, { order_id: order.id, amount, currency: 'INR', key_id: keys()!.id, plan, email: user.email ?? '' })
  } catch (e) {
    return json(req, { error: (e as Error).message }, 502)
  }
})
