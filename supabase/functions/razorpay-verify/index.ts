// Called by the app after Razorpay Checkout succeeds. Checks the signature
// (HMAC of order_id|payment_id with the key secret), that the order belongs
// to the caller, then records the payment and extends the plan.
import { caller, cors, fulfil, hmacHex, json, keys, sameHex } from '../_shared/razorpay.ts'

// Deployed with JWT verification off; caller() checks the session itself.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  const k = keys()
  if (!k) return json(req, { error: 'Payments are being set up — please try again soon.' }, 503)
  const { user } = await caller(req)
  if (!user) return json(req, { error: 'Sign in first.' }, 401)
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = await req.json().catch(() => ({}))
  if (!orderId || !paymentId || !signature) return json(req, { error: 'Missing payment details.' }, 400)
  if (!sameHex(await hmacHex(k.secret, `${orderId}|${paymentId}`), String(signature))) {
    return json(req, { error: 'Payment could not be verified.' }, 400)
  }
  try {
    const result = await fulfil(paymentId)
    if (result.ok && result.userId !== user.id) return json(req, { error: 'This payment belongs to another account.' }, 403)
    return json(req, result)
  } catch (e) {
    return json(req, { error: (e as Error).message }, 502)
  }
})
