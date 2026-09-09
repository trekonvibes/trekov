// Group voice for people riding together.
//
// A mesh of direct WebRTC audio connections between everyone on the trip, with
// push-to-talk. Small groups only — every rider holds one connection per other
// rider, which is fine at six and wasteful well before twenty.
//
// What "offline" honestly means here
// ---------------------------------
// The audio itself never goes through a server. When two riders are on the
// same WiFi — one phone's hotspot, typically — ICE picks host candidates and
// the voice path is phone-to-phone across that network. No internet is
// involved in carrying it, and the call survives losing signal entirely.
//
// Setting the call up is the part that needs a connection: two browsers cannot
// find each other without exchanging an SDP offer first, and a browser has no
// way to discover a peer on the local network by itself — there is no mDNS, no
// UDP broadcast, no WiFi Direct in the web sandbox. So the group connects
// while it still has bars, and then keeps talking after they are gone.
//
// Bluetooth is not an option at all: Web Bluetooth reaches BLE data
// characteristics only, never the audio profiles, and iOS does not implement
// it. Phone-to-phone Bluetooth audio needs a native app on both ends.
//
// There is also no TURN server, so two riders on different mobile networks may
// fail to connect where carrier NAT refuses to be traversed. Same WiFi always
// works; across networks usually does.

import { supabase } from './supabase'

const RTC = {
  // STUN only discovers a public address; it carries no audio, and failing to
  // reach it offline is harmless — host candidates are gathered regardless.
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

const MIC = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
}

/**
 * Signalling only — offers, answers and candidates. Never audio.
 *
 * Outbound messages are queued until the channel is actually subscribed.
 * Realtime accepts a send on a socket that is up but a channel that is not yet
 * joined, and silently drops what comes back: the newcomer's "hello" would
 * arrive, and the replies to it would land before it could hear them. Live
 * positions survive that race because they repeat every few seconds. A
 * handshake happens once, so it does not.
 */
function signalling(tripId) {
  if (supabase) {
    let ch = null
    let ready = false
    const queue = []
    const push = (msg) => ch?.send({ type: 'broadcast', event: 'sig', payload: msg })?.catch?.(() => {})
    return {
      join(onMessage) {
        ready = false
        ch = supabase.channel(`voice:${tripId}`, { config: { broadcast: { self: false } } })
        ch.on('broadcast', { event: 'sig' }, ({ payload }) => onMessage(payload))
          .subscribe((status) => {
            if (status !== 'SUBSCRIBED') { ready = false; return }
            ready = true
            queue.splice(0).forEach(push)
          })
        return () => { supabase.removeChannel(ch); ch = null; ready = false; queue.length = 0 }
      },
      send(msg) {
        if (ready) push(msg)
        else queue.push(msg)
      },
    }
  }
  // Cross-tab fallback, so the whole flow stays testable with no project.
  return {
    join(onMessage) {
      const ch = new BroadcastChannel(`trekov-voice-${tripId}`)
      ch.onmessage = (e) => onMessage(e.data)
      this._ch = ch
      return () => ch.close()
    },
    send(msg) { this._ch?.postMessage(msg) },
  }
}

/**
 * How the audio for this connection is actually travelling.
 *
 * Reported rather than assumed: 'local' only when both ends of the chosen
 * candidate pair are host addresses, which is what same-network really means.
 */
async function describePath(pc) {
  try {
    const stats = await pc.getStats()
    let pair = null
    stats.forEach((s) => {
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated !== false) pair = s
    })
    if (!pair) return null
    const local = stats.get(pair.localCandidateId)
    const remote = stats.get(pair.remoteCandidateId)
    if (!local || !remote) return null
    return local.candidateType === 'host' && remote.candidateType === 'host' ? 'local' : 'internet'
  } catch {
    return null
  }
}

/**
 * Join the trip's voice channel.
 *
 * @param tripId   room key — the same one the live positions use
 * @param me       { id, name }
 * @param onPeers  called with the peer list whenever anything about it changes
 * @returns { setTalking, setDeafened, leave }
 */
export async function joinVoice(tripId, me, onPeers) {
  const mic = await navigator.mediaDevices.getUserMedia(MIC)
  const track = mic.getAudioTracks()[0]
  // Nobody transmits until they hold the button. Joining a channel should not
  // put a hot mic in someone's pocket.
  track.enabled = false

  const sig = signalling(tripId)
  const peers = new Map()
  let deafened = false

  const publish = () => onPeers([...peers.values()]
    .map(({ id, name, state, path, talking }) => ({ id, name, state, path, talking }))
    .sort((a, b) => a.name.localeCompare(b.name)))

  function peer(id, name) {
    const found = peers.get(id)
    if (found) {
      if (name) found.name = name
      return found
    }

    const pc = new RTCPeerConnection(RTC)
    const audio = new Audio()
    audio.autoplay = true
    audio.playsInline = true
    audio.muted = deafened

    const entry = { id, name: name || id.slice(-4), pc, audio, state: 'connecting', path: null, talking: false }
    peers.set(id, entry)

    pc.addTrack(track, mic)

    pc.onicecandidate = (e) => {
      if (e.candidate) sig.send({ k: 'ice', from: me.id, to: id, candidate: e.candidate.toJSON() })
    }

    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0]
      // Autoplay is allowed here because joining was a button press, but a
      // rejected play() must not take the connection down with it.
      audio.play().catch(() => {})
    }

    pc.onconnectionstatechange = async () => {
      const s = pc.connectionState
      entry.state = s === 'connected' ? 'connected'
        : s === 'failed' ? 'failed'
        : s === 'disconnected' ? 'reconnecting'
        : entry.state
      if (s === 'connected') entry.path = await describePath(pc)
      publish()
    }

    publish()
    return entry
  }

  async function offer(id) {
    const { pc } = peer(id)
    const sdp = await pc.createOffer()
    await pc.setLocalDescription(sdp)
    sig.send({ k: 'offer', from: me.id, name: me.name, to: id, sdp: pc.localDescription })
  }

  function drop(id) {
    const entry = peers.get(id)
    if (!entry) return
    entry.pc.close()
    entry.audio.srcObject = null
    peers.delete(id)
    publish()
  }

  const leaveSig = sig.join(async (m) => {
    if (!m || m.from === me.id || (m.to && m.to !== me.id)) return

    // Exactly one side of each pair offers, decided by id order, so two people
    // joining at once do not both offer and collide.
    if (m.k === 'hello') {
      peer(m.from, m.name)
      sig.send({ k: 'hi', from: me.id, name: me.name, to: m.from })
      if (me.id < m.from) offer(m.from)
      return
    }
    if (m.k === 'hi') {
      peer(m.from, m.name)
      if (me.id < m.from) offer(m.from)
      return
    }
    if (m.k === 'offer') {
      const { pc } = peer(m.from, m.name)
      await pc.setRemoteDescription(m.sdp)
      await pc.setLocalDescription(await pc.createAnswer())
      sig.send({ k: 'answer', from: me.id, to: m.from, sdp: pc.localDescription })
      return
    }
    if (m.k === 'answer') {
      const entry = peers.get(m.from)
      if (entry && !entry.pc.currentRemoteDescription) await entry.pc.setRemoteDescription(m.sdp)
      return
    }
    if (m.k === 'ice') {
      const entry = peers.get(m.from)
      // A candidate can arrive before the answer is applied; dropping it is
      // survivable, throwing is not.
      try { await entry?.pc.addIceCandidate(m.candidate) } catch {}
      return
    }
    if (m.k === 'talk') {
      const entry = peers.get(m.from)
      if (entry) { entry.talking = m.on; publish() }
      return
    }
    if (m.k === 'bye') drop(m.from)
  })

  sig.send({ k: 'hello', from: me.id, name: me.name })

  return {
    /** Hold to transmit. The track is gated locally, so nothing leaves the phone. */
    setTalking(on) {
      track.enabled = on
      sig.send({ k: 'talk', from: me.id, on })
    },
    /** Stop hearing the others without leaving. */
    setDeafened(on) {
      deafened = on
      peers.forEach((p) => { p.audio.muted = on })
    },
    leave() {
      sig.send({ k: 'bye', from: me.id })
      peers.forEach((p) => { p.pc.close(); p.audio.srcObject = null })
      peers.clear()
      mic.getTracks().forEach((t) => t.stop())
      leaveSig()
      onPeers([])
    },
  }
}
