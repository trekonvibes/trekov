import { useEffect, useRef, useState } from 'react'
import { joinVoice } from '../lib/voice'

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
      <button onClick={join} disabled={state === 'joining'}
              className="flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1
                         border border-line text-mist hover:border-brand hover:text-brand disabled:opacity-50">
        <MicIcon /> {state === 'joining' ? 'Connecting…' : 'Voice'}
      </button>
    )
  }

  if (state === 'denied' || state === 'failed') {
    return (
      <span className="text-[10px] text-sun leading-tight max-w-[130px]">
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
    <div className="flex items-center gap-1.5">
      {/* Who is on, and how the audio is actually reaching them. */}
      <span className="text-[10px] leading-tight text-mist max-w-[104px] truncate">
        {speaking.length > 0
          ? <span className="text-brand font-semibold">{speaking.map((p) => p.name).join(', ')}…</span>
          : connected.length === 0
            ? 'Waiting for others'
            : `${connected.length} on${anyLocal ? ' · local WiFi' : ''}`}
      </span>

      <button onClick={toggleDeaf}
              className={`rounded-full p-1.5 border ${deafened ? 'border-rose text-rose' : 'border-line text-mist'}`}
              aria-label={deafened ? 'Unmute others' : 'Mute others'}>
        {deafened ? <SpeakerOffIcon /> : <SpeakerIcon />}
      </button>

      {/* Hold to talk. Pointer events cover mouse and touch, and the window
          listener catches a release that happens off the button. */}
      <button
        onPointerDown={(e) => { e.preventDefault(); talk(true) }}
        onPointerUp={() => talk(false)}
        onPointerCancel={() => talk(false)}
        onPointerLeave={() => talking && talk(false)}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold select-none touch-none
                    ${talking ? 'bg-brand text-ink' : 'bg-raised text-white border border-line'}`}
        aria-pressed={talking}>
        <MicIcon /> {talking ? 'Live' : 'Hold'}
      </button>

      <button onClick={leave} className="text-[10px] text-mist hover:text-rose px-1" aria-label="Leave voice">
        End
      </button>
    </div>
  )
}

const MicIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
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
