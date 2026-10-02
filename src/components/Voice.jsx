import { useEffect, useRef, useState } from 'react'
import { joinVoice } from '../lib/voice'
import { buzz } from '../lib/native'

/**
 * Push-to-talk for everyone on the trip.
 *
 * Sits in the navigation screen because that is where it is used: gloves on,
 * eyes on the road, one big button. Holding it transmits; releasing stops.
 * Nothing is transmitted until it is held.
 */
export default function Voice({ tripId, me }) {
  const [peers, setPeers] = useState([])
  const [state, setState] = useState('off')   // off | joining | on | denied | failed
  const [talking, setTalking] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const channel = useRef(null)

  // Leaving the navigation screen must release the microphone. Without this
  // the mic indicator stays lit after the ride is over.
  useEffect(() => () => { channel.current?.leave(); channel.current = null }, [])

  async function join() {
    setState('joining')
    try {
      channel.current = await joinVoice(tripId, me, setPeers)
      setState('on')
    } catch (e) {
      setState(e?.name === 'NotAllowedError' ? 'denied' : 'failed')
    }
  }

  function leave() {
    channel.current?.leave()
    channel.current = null
    setPeers([])
    setTalking(false)
    setState('off')
  }

  const talk = (on) => {
    if (state !== 'on') return
    setTalking(on)
    channel.current?.setTalking(on)
  }

  const toggleDeaf = () => {
    const next = !deafened
    setDeafened(next)
    channel.current?.setDeafened(next)
  }

  if (state === 'off' || state === 'joining') {
    return (
      // Sized like the alert buttons beside it: this is reached for with gloves on.
      <button onClick={join} disabled={state === 'joining'}
              className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black tracking-wide
                         bg-raised text-white border border-line shadow-lg active:scale-95 transition
                         hover:border-brand hover:text-brand disabled:opacity-50">
        <MicIcon size={16} /> {state === 'joining' ? 'CONNECTING…' : 'VOICE'}
      </button>
    )
  }

  if (state === 'denied' || state === 'failed') {
    return (
      <span className="block w-full text-center text-xs text-sun leading-tight py-2">
        {state === 'denied'
          ? 'Microphone blocked — allow it in site settings.'
          : 'Voice unavailable here.'}
      </span>
    )
  }

  const connected = peers.filter((p) => p.state === 'connected')
  const anyLocal = connected.some((p) => p.path === 'local')
  const speaking = peers.filter((p) => p.talking)

  return (
    <div className="w-full flex items-center gap-2">
      {/* Who is on, and how the audio is actually reaching them. */}
      <span className="text-[11px] leading-tight text-mist max-w-[96px] truncate shrink-0">
        {speaking.length > 0
          ? <span className="text-brand font-semibold">{speaking.map((p) => p.name).join(', ')}…</span>
          : connected.length === 0
            ? 'Waiting for others'
            : `${connected.length} on${anyLocal ? ' · local WiFi' : ''}`}
      </span>

      {/* A 40px target around the same small ring. */}
      <button onClick={toggleDeaf} className="grid place-items-center size-10 -m-1.5 shrink-0"
              aria-label={deafened ? 'Unmute others' : 'Mute others'}>
        <span className={`rounded-full p-1.5 border ${deafened ? 'border-rose text-rose' : 'border-line text-mist'}`}>
          {deafened ? <SpeakerOffIcon /> : <SpeakerIcon />}
        </span>
      </button>

      {/* Hold to talk. Pointer events cover mouse and touch, and the window
          listener catches a release that happens off the button. */}
      <button
        onPointerDown={(e) => { e.preventDefault(); buzz('heavy'); talk(true) }}
        onPointerUp={() => talk(false)}
        onPointerCancel={() => talk(false)}
        onPointerLeave={() => talking && talk(false)}
        className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black tracking-wide
                    shadow-lg select-none touch-none transition
                    ${talking ? 'bg-brand text-ink scale-[0.98]' : 'bg-raised text-white border border-line'}`}
        aria-pressed={talking}>
        <MicIcon size={16} /> {talking ? 'LIVE — TALKING' : 'HOLD TO TALK'}
      </button>

      <button onClick={leave} className="min-h-10 min-w-10 text-xs font-semibold text-mist hover:text-rose px-1 shrink-0" aria-label="Leave voice">
        End
      </button>
    </div>
  )
}

const MicIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
  </svg>
)
const SpeakerIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" />
  </svg>
)
const SpeakerOffIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="m17 9 4 6M21 9l-4 6" />
  </svg>
)
