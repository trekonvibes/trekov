// Razorpay → Trekov, for payment.captured. A backstop for when the app was
// closed before it could call razorpay-verify. Verifies X-Razorpay-Signature
// (HMAC of the raw body with the webhook secret) before trusting anything.
// Deploy with JWT verification off: Razorpay doesn't send a Supabase token.
import { fulfil, hmacHex, keys, sameHex } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? ''
  if (!secret || !keys()) return new Response('not configured', { status: 503 })
  const raw = await req.text()
  const signature = req.headers.get('X-Razorpay-Signature') ?? ''
  if (!sameHex(await hmacHex(secret, raw), signature)) return new Response('bad signature', { status: 400 })
  const event = JSON.parse(raw)
  if (event?.event !== 'payment.captured') return new Response('ignored', { status: 200 })
  try {
    await fulfil(event.payload.payment.entity.id)
    return new Response('ok', { status: 200 })
  } catch (e) {
    // Razorpay retries on non-2xx, which is what we want for a transient failure.
    return new Response((e as Error).message, { status: 500 })
  }
})
