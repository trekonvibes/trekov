// Sends a notification to the other riders on a trip, for the times Trekov
// isn't open on their phone (Punit's Firebase project, 2026-09-12).
//
// While apps are open, alerts travel over Realtime and need none of this. This
// is the closed-app path: Firebase holds a token per phone (push_tokens), and
// the only way to use one is from here, with the service key.
//
// Who may send: a rider on that trip, and only to the others on it. An invite
// goes to the person invited, and only the host can send that. The caller's own
// phones are skipped — nobody needs their own STOP back.
//
// Needs the secret FCM_SERVICE_ACCOUNT: the JSON key of a Firebase service
// account (Firebase console → Project settings → Service accounts → Generate
// new private key), pasted into Supabase → Edge Functions → Secrets. Without it
// the function answers 503 and the app carries on.
//
// Deployed with JWT verification off; caller() checks the session itself.
import { admin, caller, cors, json } from '../_shared/razorpay.ts'

type Db = ReturnType<typeof admin>

function serviceAccount() {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? ''
  if (!raw) return null
  try {
    const sa = JSON.parse(raw)
    return sa.client_email && sa.private_key && sa.project_id ? sa : null
  } catch {
    return null
  }
}

const urlSafe = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Firebase wants an OAuth token, signed with the service account's key. */
async function firebaseToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000)
  const part = (o: unknown) => urlSafe(btoa(JSON.stringify(o)))
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)))
  const jwt = `${unsigned}.${urlSafe(btoa(String.fromCharCode(...signature)))}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error_description ?? 'Firebase refused the service account')
  return body.access_token as string
}

/** One message per phone. A token Firebase no longer knows is deleted. */
async function deliver(db: Db, projectId: string, bearer: string, rows: { token: string }[], payload: {
  title: string; body: string; data: Record<string, string>
}) {
  let sent = 0
  const dead: string[] = []
  for (const { token } of rows) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          data: payload.data,
          android: {
            priority: 'HIGH',
            notification: {
              sound: 'default',
              // The app makes this channel at startup with high importance, so
              // these land as a heads-up with sound instead of a silent line in
              // the shade (lib/push.js).
              channel_id: 'trekov-rides',
              notification_priority: 'PRIORITY_HIGH',
              default_vibrate_timings: true,
            },
          },
        },
      }),
    })
    if (res.ok) { sent += 1; continue }
    const error = await res.json().catch(() => ({}))
    const status = error?.error?.status ?? ''
    // The app was uninstalled, or Firebase rotated the token.
    if (res.status === 404 || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT') dead.push(token)
  }
  if (dead.length) await db.from('push_tokens').delete().in('token', dead)
  return { sent, dropped: dead.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405)

  const sa = serviceAccount()
  if (!sa) return json(req, { error: 'Notifications are being set up.' }, 503)

  const { user } = await caller(req)
  if (!user) return json(req, { error: 'Sign in first.' }, 401)

  const { tripId, kind, title, body, toUserId } = await req.json().catch(() => ({}))
  if (typeof tripId !== 'string' || !tripId) return json(req, { error: 'Which trip?' }, 400)
  if (!title || !body) return json(req, { error: 'Nothing to say.' }, 400)

  const db = admin()

  // One account can't flood other people's phones (launch audit, 2026-09-14):
  // at most 20 notifications a minute and 200 an hour. Needs push_log from
  // supabase/launch-hardening.sql; without that table the limit is skipped.
  const since = (s: number) => new Date(Date.now() - s * 1000).toISOString()
  const recent = await db.from('push_log').select('sent_at', { count: 'exact', head: true })
    .eq('sender_id', user.id).gte('sent_at', since(60))
  if (!recent.error) {
    const hour = await db.from('push_log').select('sent_at', { count: 'exact', head: true })
      .eq('sender_id', user.id).gte('sent_at', since(3600))
    if ((recent.count ?? 0) >= 20 || (hour.count ?? 0) >= 200) {
      return json(req, { error: 'Too many notifications — try again in a minute.' }, 429)
    }
  }

  const { data: trip } = await db.from('trips').select('id, owner_id, title').eq('id', tripId).maybeSingle()
  if (!trip) return json(req, { error: 'No such trip.' }, 404)
  const { data: riders } = await db.from('trip_members').select('user_id, status, invited_by, invited_at, responded_at').eq('trip_id', tripId)
  const accepted = (riders ?? []).filter((r) => r.status === 'accepted').map((r) => r.user_id)
  const asked = (riders ?? []).filter((r) => r.status === 'requested').map((r) => r.user_id)
  const onTrip = new Set([trip.owner_id, ...accepted])
  // Someone asking to come along isn't on the trip yet, but the host should
  // hear about it. That is the one thing they may send, it goes to the host
  // alone, and the words are written here rather than by them.
  const asking = kind === 'join' && asked.includes(user.id)
  if (!onTrip.has(user.id) && !asking) return json(req, { error: 'You are not on this trip.' }, 403)

  let recipients: string[]
  let text = { title: String(title).slice(0, 80), body: String(body).slice(0, 160) }
  if (asking) {
    const { data: me } = await db.from('profiles').select('handle').eq('id', user.id).maybeSingle()
    recipients = [trip.owner_id]
    text = { title: `@${me?.handle ?? 'Someone'} wants to join`, body: trip.title }
  } else if (kind === 'join') {
    return json(req, { error: 'Ask to join first.' }, 403)
  } else if (kind === 'invite') {
    // Only the host invites, and the notification goes to that person alone —
    // someone the host really did just invite or let in. It used to go to any
    // user id at all, with words the caller chose (launch audit, 2026-09-14).
    if (trip.owner_id !== user.id) return json(req, { error: 'Only the host can invite.' }, 403)
    if (typeof toUserId !== 'string' || !/^[0-9a-f-]{36}$/i.test(toUserId)) return json(req, { error: 'Invite whom?' }, 400)
    const row = (riders ?? []).find((r) => r.user_id === toUserId)
    const when = row ? Date.parse(String(row.status === 'pending' ? row.invited_at : (row.responded_at ?? row.invited_at))) : 0
    if (!row || !['pending', 'accepted'].includes(row.status) || !(when > Date.now() - 15 * 60_000)) {
      return json(req, { error: 'Invite them first.' }, 403)
    }
    const { data: blocked } = await db.from('blocks').select('blocker_id')
      .or(`and(blocker_id.eq.${toUserId},blocked_id.eq.${user.id}),and(blocker_id.eq.${user.id},blocked_id.eq.${toUserId})`).limit(1)
    if (blocked?.length) return json(req, { ok: true, sent: 0 })
    const { data: me } = await db.from('profiles').select('handle').eq('id', user.id).maybeSingle()
    recipients = [toUserId]
    text = row.status === 'pending'
      ? { title: `@${me?.handle ?? 'Someone'} invited you on a trip`, body: trip.title }
      : { title: `@${me?.handle ?? 'Someone'} added you to the ride`, body: trip.title }
  } else {
    recipients = [...onTrip].filter((id) => id !== user.id)
  }
  if (!recipients.length) return json(req, { ok: true, sent: 0 })

  await db.from('push_log').insert({ sender_id: user.id, kind: String(kind ?? 'alert') }).then(() => {}, () => {})
  const { data: tokens } = await db.from('push_tokens').select('token').in('user_id', recipients)
  if (!tokens?.length) return json(req, { ok: true, sent: 0 })

  try {
    const bearer = await firebaseToken(sa)
    const result = await deliver(db, sa.project_id, bearer, tokens, {
      ...text,
      data: { tripId, kind: String(kind ?? 'alert') },
    })
    return json(req, { ok: true, ...result })
  } catch (e) {
    return json(req, { error: `Could not send: ${(e as Error).message}` }, 500)
  }
})
