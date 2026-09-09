import { supabase } from './supabase'

// Live location sharing between everyone on the same trip.
//
// Two transports behind one interface: Supabase Realtime when a project is
// configured (genuinely multi-device), BroadcastChannel otherwise (cross-tab
// on one machine). The local one is not dead code — it keeps group navigation
// demonstrable with no account and no network.
//
//   { join(room, onMessage) -> leave(), send(message) }

const STALE_MS = 60_000   // drop a member we have not heard from in a minute
const BEAT_MS = 5_000     // and re-announce ourselves this often

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
      this._ch?.postMessage(message)
    },
  }
}

/** Multi-device presence over Supabase Realtime. */
export function realtimeTransport(supabase) {
  let channel = null
  return {
    join(room, onMessage) {
      channel = supabase.channel(`trip:${room}`, { config: { broadcast: { self: false } } })
      channel
        .on('broadcast', { event: 'pos' }, ({ payload }) => onMessage(payload))
        .on('broadcast', { event: 'leave' }, ({ payload }) => onMessage(payload))
        .subscribe()
      return () => { supabase.removeChannel(channel); channel = null }
    },
    send(message) {
      // Realtime send is async and can reject while the socket reconnects;
      // a dropped position update is not worth surfacing to the traveller.
      channel?.send({ type: 'broadcast', event: message.type === 'leave' ? 'leave' : 'pos', payload: message })
        ?.catch?.(() => {})
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
export function joinParty(tripId, me, onMembers, transport) {
  transport = transport ?? defaultTransport()
  const members = new Map()
  let mine = null

  const publish = () => onMembers([...members.values()].sort((a, b) => a.name.localeCompare(b.name)))

  function prune() {
    const cutoff = Date.now() - STALE_MS
    let changed = false
    for (const [id, m] of members) {
      if (m.at < cutoff) { members.delete(id); changed = true }
    }
    if (changed) publish()
  }

  const leaveTransport = transport.join(tripId, (msg) => {
    if (!msg || msg.id === me.id) return
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
    members.set(msg.id, {
      id: msg.id, name: msg.name, lat: msg.lat, lng: msg.lng,
      // Carry how they look and whether they are rolling, or every companion
      // renders as a stationary green car regardless of what they sent.
      vehicle: msg.vehicle ?? 'car',
      colour: msg.colour ?? 'green',
      heading: msg.heading ?? 0,
      moving: Boolean(msg.moving),
      at: Date.now(),
    })
    publish()
    // A newcomer needs to learn where we are without waiting for the heartbeat.
    if (msg.hello && mine) transport.send({ ...mine, type: 'pos', hello: false })
  })

  const beat = setInterval(() => { if (mine) transport.send(mine); prune() }, BEAT_MS)

  return {
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
        vehicle: look.vehicle, colour: look.colour, heading: look.heading,
        moving: look.moving,
        hideFrom: look.hideFrom?.length ? look.hideFrom : undefined,
        hello: !mine,
      }
      transport.send(mine)
      mine = { ...mine, hello: false }
    },
    leave() {
      clearInterval(beat)
      transport.send({ type: 'leave', id: me.id })
      leaveTransport()
    },
  }
}

/** Realtime when a project is configured, cross-tab otherwise. */
export function defaultTransport() {
  return supabase ? realtimeTransport(supabase) : broadcastTransport()
}
