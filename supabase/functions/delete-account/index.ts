// Deletes the caller's account for good — required by the App Store and
// Google Play for any app that lets people sign up.
//
// Email confirmation first (Punit, 2026-09-11): the caller must have signed in
// through a link emailed to them in the last 15 minutes. The app sends that
// link when someone asks to delete their account, so a stolen or unlocked
// phone with a session on it cannot delete the account by itself.
//
// Order: their photos (storage has no cascade), their business listings
// (listings.owner_id is ON DELETE SET NULL, which would leave them live and
// ownerless), then the sign-in itself. Deleting the auth user removes the
// profile and, by cascade, posts, likes, comments, reviews, saves, trips,
// products and payment records. Places they added stay on the map without
// their name (places.added_by is ON DELETE SET NULL).
//
// Deployed with JWT verification off; caller() checks the session itself.
import { admin, caller, cors, json } from '../_shared/razorpay.ts'

type Db = ReturnType<typeof admin>

const CONFIRM_WINDOW_S = 15 * 60

/**
 * Did this session start from an emailed link or code within the window?
 * Read from the token's `amr` claim — only after caller() has had Supabase
 * validate that same token, so the claim can be trusted.
 */
function confirmedByEmail(req: Request) {
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)))
    const now = Math.floor(Date.now() / 1000)
    return (payload.amr ?? []).some((a: { method?: string; timestamp?: number }) =>
      (a.method === 'otp' || a.method === 'magiclink') && now - Number(a.timestamp) <= CONFIRM_WINDOW_S)
  } catch {
    return false
  }
}

/** Everything under photos/<uid>/ — the storage policy keeps uploads there. */
async function photoPaths(db: Db, uid: string) {
  const paths: string[] = []
  const walk = async (prefix: string, depth: number) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.storage.from('photos').list(prefix, { limit: 1000, offset })
      if (error) throw error
      for (const item of data ?? []) {
        const path = `${prefix}/${item.name}`
        // Folders come back without an id.
        if (item.id) paths.push(path)
        else if (depth < 3) await walk(path, depth + 1)
      }
      if (!data || data.length < 1000) break
    }
  }
  await walk(uid, 0)
  return paths
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405)
  const { user } = await caller(req)
  if (!user) return json(req, { error: 'Sign in first.' }, 401)
  const { confirm } = await req.json().catch(() => ({}))
  if (confirm !== 'DELETE') return json(req, { error: 'Confirm the deletion first.' }, 400)
  if (!confirmedByEmail(req)) {
    return json(req, { error: 'Confirm by email first — open the link we send you, then delete.', needsEmail: true }, 403)
  }

  const db = admin()
  try {
    const paths = await photoPaths(db, user.id)
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await db.storage.from('photos').remove(paths.slice(i, i + 100))
      if (error) throw error
    }
    const { error: listingsError } = await db.from('listings').delete().eq('owner_id', user.id)
    if (listingsError) throw listingsError
    const { error: userError } = await db.auth.admin.deleteUser(user.id)
    if (userError) throw userError
    return json(req, { ok: true, photosRemoved: paths.length })
  } catch (e) {
    return json(req, { error: `Could not delete the account: ${(e as Error).message}` }, 500)
  }
})
