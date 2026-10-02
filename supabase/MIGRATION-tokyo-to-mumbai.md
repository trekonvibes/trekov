# Moving the database from Tokyo to Mumbai

Trekov's Supabase project sits in Northeast Asia (Tokyo, `ap-northeast-1`).
Every database call from an Indian rider crosses to Japan and back — roughly
120–150 ms, against 20–40 ms to Mumbai. Sign-in, sync and the live group map
are where that is felt.

Supabase fixes a project's region when it is created and gives no way to move
it. The only route is a new project in **South Asia (Mumbai, `ap-south-1`)**
and a migration into it. This is the plan for that day.

Written 2026-09-21, from an inventory of the live project (`jqvesreqazrympexqqmt`).

## The one thing that decides the timing

**A new project has a new JWT secret, so every signed-in rider is logged out.**
There is no way around it. Password hashes move, so nobody has to reset a
password — but everyone signs in again.

That is why this waits until the Play closed test has cleared its 14 days: the
count needs 12 testers opted in and staying, and logging them all out mid-count
is the one avoidable way to lose them.

## What is actually moving

Taken from the live database on 2026-09-21 — it is a small project, so the work
is the auth users and the cutover, not the data.

| | |
|---|---|
| Postgres | 17.6 |
| Auth users | 19 |
| Tables | 12 — places 314 rows, profiles 19, push_log 12, push_tokens 7, trip_members 6, admin_actions 6, trips 5 |
| RLS policies | 34 (public + storage) |
| Functions | 49 in `public` |
| Storage | one bucket, `photos` (public) — 1 object, 0.2 MB |
| Edge functions | `push-send`, `delete-account`, `admin-delete-user`, `razorpay-order`, `razorpay-verify`, `razorpay-webhook`, `_shared` |

## Steps

### 1. Create the project

Same org, region **South Asia (Mumbai) `ap-south-1`**, Free tier. Keep its
project URL and anon key to hand.

Check first that the org can hold a second project — the free tier allows two
active ones, and the Tokyo project must stay up throughout.

### 2. Build the schema from source, not from a dump

Every migration is in this directory. Run them in the SQL editor in this order;
dependencies matter:

```
schema.sql → memberships.sql → username-login.sql → trip-invites.sql
→ trip-roles.sql → trip-visibility.sql → post-location.sql → push.sql
→ admin.sql → listings-selfserve.sql → listing-products.sql
→ prerelease-offer.sql → demo-listings.sql → catalogue-places.sql
→ launch-hardening.sql → security-hardening.sql → trip-links.sql
→ fix-2026-09-18-login-and-links.sql → trip-completed.sql
→ trip-captain-edit.sql → rider-safety.sql
```

Replaying the source is cleaner than restoring a schema dump: it is the code
already in review, and it rebuilds all 34 policies and 49 functions as written.

**Do not skip the last two.** `trip-links.sql` is short trip links, and
`fix-2026-09-18-login-and-links.sql` is the fix for the ambiguous `ip` column
that broke every username sign-in. A migration that quietly reintroduces that
bug is worse than no migration.

### 3. Move the data

Data only — the schema is already there from step 2:

```bash
pg_dump "$OLD_DB_URL" --data-only --no-owner --no-privileges \
  --schema=public --schema=auth \
  --exclude-table-data='auth.sessions' \
  --exclude-table-data='auth.refresh_tokens' \
  --exclude-table-data='storage.*' \
  -f trekov-data.sql

psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f trekov-data.sql
```

`auth.users` has to land before `public.profiles` — the dump orders it that
way, and an FK error there means it did not. Sessions are left out on purpose:
they are void the moment the secret changes.

Both connection strings carry the database password, so these two commands
belong to whoever owns the project.

### 4. Copy the photos

Create the `photos` bucket as **public** in the new project, then move the
objects. At one object the dashboard's download and upload is enough; if the
bucket has grown by then, loop over `storage.objects` with the storage API
instead. Check a photo URL loads from the new project before moving on.

### 5. Redeploy the edge functions and set their secrets

Secrets do not travel with a deploy.

```bash
supabase functions deploy --project-ref NEW_REF
supabase secrets set FCM_SERVICE_ACCOUNT=... RAZORPAY_WEBHOOK_SECRET=... --project-ref NEW_REF
```

Those two values are the Firebase service account JSON and the Razorpay webhook
secret; they are pasted by their owner, not read out of anywhere.

### 6. Point the app at the new project

Change `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`, then
`./deploy.sh`.

Both live in the web bundle, so **a live update carries this to every installed
app — no Play release needed**, which is what makes the cutover quick.

`vite.config.js` also allow-lists the Supabase host by name in the
Content-Security-Policy; without that edit the new host is blocked and the app
loads with no data at all.

### 7. Repoint the outside world

- The **Razorpay webhook** URL, to the new functions host.
- **Google Cloud**, if any API key restriction names the old host.

## Cutover

Pick a quiet hour. Then: dump → restore → copy photos → deploy → verify.

Anything a rider writes between the dump and the deploy lands in Tokyo and is
lost, so that window is minutes, not hours.

**Verify before telling anyone it moved:**

- Sign in with a **username** — proves the auth users and `email_for_login` moved.
- Open a trip and **share** it — proves short links and `create_trip_link`.
- **Post a photo** — proves storage and its policies.
- **Send yourself a push** — proves the function and its secret.

**Rollback** is pointing `.env.local` back at Tokyo and deploying again. The old
project stays up and untouched throughout — leave it running a fortnight before
deleting anything.
