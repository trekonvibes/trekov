// Lets a Trekov admin delete someone else's account for good (Punit,
// 2026-09-11): the admin screen's "Delete this account", after typing the
// person's @username.
//
// Everything is checked here, on the server: a valid session; the caller is in
// `admins` and confirmed this session with their authenticator app (two-step
// sign-in, as admin_begin() requires); the request comes from the caller's active device (the one-device
// rule, as admin_begin() does in admin.sql); the target is neither the caller
// nor another admin; and `confirm` is the target's exact @username. Then the
// same clean-up as delete-account: their photos (storage has no cascade), their
// business listings (owner_id is ON DELETE SET NULL, which would leave them
// live and ownerless), then the sign-in, which removes the profile and, by
// cascade, posts, likes, comments, reviews, saves, trips, products and payment
// records. The admin log keeps the username, counts and reason — not the email.
//
// Deployed with JWT verification off; caller() checks the session itself.
import { admin, caller, cors, json } from '../_shared/razorpay.ts'

type Db = ReturnType<typeof admin>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Was this session confirmed with an authenticator-app code (Supabase MFA,
 * "aal2")? Read from the token only after caller() has had Supabase validate
 * that same token, so the claim can be trusted.
 */
function twoStepDone(req: Request) {
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4))).aal === 'aal2'
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
  const { userId, confirm, reason } = await req.json().catch(() => ({}))
  if (typeof userId !== 'string' || !UUID.test(userId)) return json(req, { error: 'Pick an account to delete.' }, 400)

  const db = admin()
  const { data: isAdmin } = await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle()
  if (!isAdmin) return json(req, { error: 'Admins only.' }, 403)
  if (!twoStepDone(req)) return json(req, { error: 'Confirm with the code from your authenticator app first.' }, 403)
  const { data: me } = await db.from('profiles').select('active_device').eq('id', user.id).maybeSingle()
  if (me?.active_device && me.active_device !== (req.headers.get('x-device-id') ?? '')) {
    return json(req, { error: 'Your account is active on another device. Sign in here again to use admin.' }, 403)
  }
  if (userId === user.id) return json(req, { error: 'Delete your own account from your profile instead.' }, 400)

  const { data: target } = await db.from('profiles').select('handle').eq('id', userId).maybeSingle()
  if (!target) return json(req, { error: 'That account no longer exists.' }, 404)
  const { data: targetIsAdmin } = await db.from('admins').select('user_id').eq('user_id', userId).maybeSingle()
  if (targetIsAdmin) return json(req, { error: 'That account is an admin. Remove its admin access first (SQL editor).' }, 400)
  const typed = String(confirm ?? '').trim().replace(/^@/, '').toLowerCase()
  if (typed !== String(target.handle).toLowerCase()) return json(req, { error: `Type @${target.handle} to confirm.` }, 400)

  try {
    const paths = await photoPaths(db, userId)
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await db.storage.from('photos').remove(paths.slice(i, i + 100))
      if (error) throw error
    }
    const { data: listings, error: listingsError } = await db.from('listings').delete().eq('owner_id', userId).select('id')
    if (listingsError) throw listingsError
    const { error: userError } = await db.auth.admin.deleteUser(userId)
    if (userError) throw userError
    const note = String(reason ?? '').trim().slice(0, 300)
    await db.from('admin_actions').insert({
      admin_id: user.id, action: 'delete_user', target: userId,
      detail: { handle: target.handle, photos: paths.length, listings: listings?.length ?? 0, ...(note ? { reason: note } : {}) },
    })
    return json(req, { ok: true, handle: target.handle, photosRemoved: paths.length })
  } catch (e) {
    return json(req, { error: `Could not delete the account: ${(e as Error).message}` }, 500)
  }
})
