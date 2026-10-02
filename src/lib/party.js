import { supabase } from './supabase'

// Live location sharing between everyone on the same trip.
//
// Two transports behind one interface: Supabase Realtime when a project is
// configured (genuinely multi-device), BroadcastChannel otherwise (cross-tab
// on one machine). The local one is not dead code — it keeps group navigation
// demonstrable with no account and no network.
//
//   { join(room, onMessage) -> leave(), send(message) -> Promise<boolean> }
//
// send resolves false when the message did not get through, so alerts can retry.

//
// With no signal nothing can be sent or heard, so the app shows what it last
// knew: a companion not heard from in a minute stays on the map where they
// were last seen, greyed, with how long ago. Alerts pressed without signal
// wait and go out once there is one.

const STALE_MS = 60_000            // not heard from in a minute: shown as "last seen"
const FORGET_MS = 6 * 60 * 60_000  // keep a last-known spot this long
const BEAT_MS = 5_000              // re-announce ourselves this often
const SEND_GAP_MS = 2_000          // and send a change no more often than this
const MOVE_M = 5                   // closer than this to the last sent spot is not a change
const TURN_DEG = 15
const ALERT_TTL_MS = 10 * 60_000   // an alert older than this is no longer worth delivering

/** Works across tabs on one device. No server, no network. */
export function broadcastTransport() {
  return {
    join(room, onMessage) {
      const ch = new BroadcastChannel(`trekov-trip-${room}`)
      ch.onmessage = (e) => onMessage(e.data)
      this._ch = ch
      return () => ch.close()
    },
    send(message) {
      if (!this._ch) return Promise.resolve(false)
      // Ad recording (dev builds only): pretend the signal is gone.
      if (import.meta.env.DEV && window.__adDemo?.offline) return Promise.resolve(false)
      this._ch.postMessage(message)
      return Promise.resolve(true)
    },
  }
}

/** Multi-device presence over Supabase Realtime. */
export function realtimeTransport(supabase) {
  let channel = null
  return {
    join(room, onMessage) {
      // ack: the server confirms each message, so an alert sent into a dead
      // connection is known to have failed rather than assumed delivered.
      // private: only the trip's owner and members can join (RLS on
      // realtime.messages, supabase/security-hardening.sql).
      channel = supabase.channel(`trip:${room}`, { config: { private: true, broadcast: { self: false, ack: true } } })
      channel
        .on('broadcast', { event: 'pos' }, ({ payload }) => onMessage(payload))
        .on('broadcast', { event: 'leave' }, ({ payload }) => onMessage(payload))
        .on('broadcast', { event: 'alert' }, ({ payload }) => onMessage(payload))
        .subscribe()
      return () => { supabase.removeChannel(channel); channel = null }
    },
    send(message) {
      // Resolves 'ok', 'timed out' or 'error'; never worth throwing over. A
      // dropped position update is replaced by the next one in five seconds.
      if (!channel) return Promise.resolve(false)
      return channel.send({ type: 'broadcast', event: ['leave', 'alert'].includes(message.type) ? message.type : 'pos', payload: message })
        .then((r) => r === 'ok', () => false)
    },
  }
}

const COLOURS = ['#00C08B', '#FFB33E', '#FF5C7A', '#5AA9FF', '#C77DFF', '#3DDC97']
export const colourFor = (id) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLOURS[h % COLOURS.length]
}

/**
 * Join a trip's party.
 *
 * @param tripId    room key — everyone with the same trip link shares one
 * @param me        { id, name }
 * @param onMembers called with the current member list whenever it changes
 * @returns { update(position), leave() }
 */
/** Has a rider moved, turned, stopped or started, or changed how they look since `a`? */
function changedSince(a, b) {
  if (!a) return true
  const dy = (b.lat - a.lat) * 111_320
  const dx = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180)
  const turn = Math.abs((((b.heading ?? 0) - (a.heading ?? 0)) % 360 + 540) % 360 - 180)
  return Math.hypot(dx, dy) >= MOVE_M || turn >= TURN_DEG || a.moving !== b.moving ||
    a.vehicle !== b.vehicle || a.model !== b.model || a.colour !== b.colour ||
    String(a.hideFrom ?? '') !== String(b.hideFrom ?? '')
}

/** Alerts anyone on the trip can shout to everyone else. */
export const ALERT_KINDS = ['stop', 'wait', 'go']

// Everything a rider receives comes from other phones and ends up inside
// map-marker HTML, so it is checked here, where it arrives: coordinates and
// heading must be numbers in range, ids and vehicle names plain words, names
// short text (escaped again where they are shown). Anything else is dropped.
const WORD = /^[\w-]{1,64}$/
const num = (v, min, max) => {
  const n = typeof v === 'number' ? v : Number.NaN
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}
const word = (v, fallback) => (typeof v === 'string' && WORD.test(v) ? v : fallback)
function cleanMember(msg) {
  if (typeof msg?.id !== 'string' || !WORD.test(msg.id)) return null
  const lat = num(msg.lat, -90, 90)
  const lng = num(msg.lng, -180, 180)
  if (lat == null || lng == null) return null
  return {
    id: msg.id,
    name: String(msg.name ?? 'Rider').slice(0, 40),
    lat, lng,
    vehicle: word(msg.vehicle, 'car'),
    model: word(msg.model, undefined),
    colour: word(msg.colour, 'green'),
    heading: num(msg.heading, -360, 720) ?? 0,
    moving: msg.moving === true,
  }
}

export function joinParty(tripId, me, onMembers, transport, onAlert, onPending) {
  transport = transport ?? defaultTransport()
  const key = `${SAVED}${tripId}`
  sweepSaved()
  const members = new Map(restore(key))
  let mine = null

  const publish = () => {
    const now = Date.now()
    // The same rider can briefly exist twice — an old id kept on this phone as
    // "last seen" and their current one live. Once they are live, drop the old.
    const liveNames = new Set([...members.values()].filter((m) => now - m.at <= STALE_MS).map((m) => m.name))
    for (const [id, m] of members) if (now - m.at > STALE_MS && liveNames.has(m.name)) members.delete(id)
    onMembers([...members.values()]
      .map((m) => {
        const stale = now - m.at > STALE_MS
        return { ...m, stale, moving: m.moving && !stale }
      })
      .sort((x, y) => x.stale - y.stale || x.name.localeCompare(y.name)))
    save(key, members)
  }

  let staleCount = 0
  let beats = 0
  function prune() {
    const now = Date.now()
    let changed = false
    let stale = 0
    for (const [id, m] of members) {
      if (now - m.at > FORGET_MS) { members.delete(id); changed = true } else if (now - m.at > STALE_MS) stale++
    }
    // Publish when someone goes quiet, and every half minute while anyone
    // is, so "last seen 4 min ago" keeps counting.
    if (changed || stale !== staleCount || (stale && ++beats % 6 === 0)) publish()
    staleCount = stale
  }

  const heard = new Set()
  const leaveTransport = transport.join(tripId, (msg) => {
    if (!msg || msg.id === me.id) return
    if (msg.type === 'alert') {
      if (!ALERT_KINDS.includes(msg.kind)) return
      // A queued alert can arrive twice (it got through but the confirmation
      // was lost with the signal) and late: the id keeps it to once, and the
      // time it was pressed says how late.
      if (msg.aid) {
        if (heard.has(msg.aid)) return
        heard.add(msg.aid)
      }
      const at = Math.min(Number(msg.at) || Date.now(), Date.now())
      if (Date.now() - at > ALERT_TTL_MS) return
      onAlert?.({ kind: msg.kind, name: String(msg.name || 'Someone').slice(0, 40), at })
      return
    }
    if (msg.type === 'leave') {
      if (members.delete(msg.id)) publish()
      return
    }
    if (msg.type !== 'pos') return
    // Someone has hidden themselves from this rider specifically. Honoured
    // rather than enforced: a broadcast channel reaches everyone, so this
    // depends on the receiving app respecting it. Switching sharing off
    // entirely is the enforceable one — nothing is sent at all.
    if (Array.isArray(msg.hideFrom) && msg.hideFrom.includes(me.id)) {
      if (members.delete(msg.id)) publish()
      return
    }
    // Carry how they look and whether they are rolling, or every companion
    // renders as a stationary green car regardless of what they sent.
    const clean = cleanMember(msg)
    if (!clean) return
    members.set(clean.id, { ...clean, at: Date.now() })
    publish()
    // A newcomer needs to learn where we are without waiting for the heartbeat.
    if (msg.hello && mine) transport.send({ ...mine, type: 'pos', hello: false })
  })

  // The newest alert we pressed that has not reached the group yet. Only one:
  // a STOP followed by LET'S GO should arrive as LET'S GO, not as both.
  let pending = null
  let flushing = false
  let shown = null
  async function flush() {
    if (!pending || flushing) return
    flushing = true
    const a = pending
    let ok = false
    if (Date.now() - a.at <= ALERT_TTL_MS) {
      try { ok = (await transport.send(a)) !== false } catch { ok = false }
    }
    flushing = false
    if (pending !== a) return flush()          // a newer alert came in meanwhile
    if (ok || Date.now() - a.at > ALERT_TTL_MS) pending = null
    // Tell the screen only when this changes: the first failed try, and
    // when it finally goes (or is given up on).
    if ((pending?.aid ?? null) !== shown) {
      shown = pending?.aid ?? null
      onPending?.(pending && { kind: pending.kind, at: pending.at })
    }
  }

  // What we last sent, and when (see update).
  let sent = null
  let sentAt = 0
  const beat = setInterval(() => {
    if (mine) { transport.send(mine); sent = mine; sentAt = Date.now() }
    prune(); flush()
  }, BEAT_MS)
  // Signal is back: send what is waiting, and show everyone where we are.
  const onOnline = () => { flush(); if (mine) transport.send(mine) }
  globalThis.addEventListener?.('online', onOnline)
  if (members.size) publish()

  return {
    /**
     * Tell everyone on the trip to stop, wait, or get going. With no signal
     * it waits and goes out when there is — unless it is ALERT_TTL_MS old by then.
     */
    alert(kind) {
      if (!ALERT_KINDS.includes(kind)) return
      const at = Date.now()
      pending = { type: 'alert', id: me.id, name: me.name, kind, at, aid: `${me.id}:${at.toString(36)}${Math.random().toString(36).slice(2, 6)}` }
      flush()
    },
    /**
     * @param look.share  false stops the broadcast outright — the position
     *                    never leaves the device, and the heartbeat has
     *                    nothing to repeat.
     * @param look.hideFrom  member ids who should not be shown this position.
     */
    update(position, look = {}) {
      if (look.share === false) {
        // Tell the others to drop the stale marker rather than leaving it
        // frozen on their map, which reads as "stopped" rather than "hidden".
        if (mine) { transport.send({ type: 'leave', id: me.id }); mine = null }
        return
      }
      mine = {
        type: 'pos', id: me.id, name: me.name,
        lat: position.lat, lng: position.lng,
        vehicle: look.vehicle, model: look.model, colour: look.colour, heading: look.heading,
        moving: look.moving,
        hideFrom: look.hideFrom?.length ? look.hideFrom : undefined,
        hello: !mine,
      }
      // Navigation calls this on every render, not only on a new GPS fix, and it
      // re-renders whenever a companion's message arrives — so sending every
      // call made phones answer each other in a loop (found 2026-09-11), a few
      // messages a second each, which would have hit Supabase's Realtime limit
      // with about four riders. Send a real change at most every SEND_GAP_MS;
      // the heartbeat carries the latest spot every BEAT_MS regardless.
      if (mine.hello || (changedSince(sent, mine) && Date.now() - sentAt >= SEND_GAP_MS)) {
        transport.send(mine)
        sent = mine
        sentAt = Date.now()
      }
      mine = { ...mine, hello: false }
    },
    leave() {
      clearInterval(beat)
      globalThis.removeEventListener?.('online', onOnline)
      pending = null
      transport.send({ type: 'leave', id: me.id })
      leaveTransport()
    },
  }
}

/** "4 min ago", or "4m ago" when short. */
export function seenAgo(at, short = false) {
  const min = Math.floor((Date.now() - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return short ? `${min}m ago` : `${min} min ago`
  const h = Math.floor(min / 60)
  return short ? `${h}h ago` : `${h} h ${min % 60} min ago`
}

// Last-known positions are kept on the phone, so reopening the app with no
// signal still shows where everyone was. Only what companions chose to share
// with this rider, and only for FORGET_MS.
const SAVED = 'trekov.party.'
function restore(key) {
  try {
    const cutoff = Date.now() - FORGET_MS
    // Checked like live messages: what was saved came from other phones too.
    return (JSON.parse(localStorage.getItem(key)) ?? [])
      .map((m) => { const c = cleanMember(m); return c && typeof m.at === 'number' && m.at > cutoff ? [c.id, { ...c, at: m.at }] : null })
      .filter(Boolean)
  } catch { return [] }
}
function save(key, members) {
  try {
    if (members.size) localStorage.setItem(key, JSON.stringify([...members.values()]))
    else localStorage.removeItem(key)
  } catch { /* storage full or blocked: live positions still work */ }
}
function sweepSaved() {
  try {
    const cutoff = Date.now() - FORGET_MS
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k?.startsWith(SAVED)) continue
      const list = JSON.parse(localStorage.getItem(k) || '[]')
      if (!list.some((m) => m?.at > cutoff)) localStorage.removeItem(k)
    }
  } catch { /* ignore */ }
}

/** Realtime when a project is configured, cross-tab otherwise. */
export function defaultTransport() {
  return supabase ? realtimeTransport(supabase) : broadcastTransport()
}
