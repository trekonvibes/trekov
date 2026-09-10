import { useEffect, useRef, useState } from 'react'

// STOP / WAIT / LET'S GO — one tap tells everyone on the trip, and it has to
// cut through wind noise and a helmet: a full-screen flash, a loud tone made
// on the spot (no audio files, works offline), the alert spoken, and a buzz.

export const ALERT_LOOK = {
  stop: { label: 'STOP', say: 'Stop', btn: 'bg-rose text-white', screen: 'bg-rose text-white', size: 'text-[26vw] sm:text-[140px]' },
  wait: { label: 'WAIT', say: 'Wait', btn: 'bg-sun text-ink', screen: 'bg-sun text-ink', size: 'text-[26vw] sm:text-[140px]' },
  go:   { label: "LET'S GO", say: "Let's go", btn: 'bg-brand text-ink', screen: 'bg-brand text-ink', size: 'text-[17vw] sm:text-[96px]' },
}
const KINDS = ['stop', 'wait', 'go']

let ctx = null
/** Browsers only allow sound after a tap; call this from one. */
export function unlockAlertAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
  } catch { /* no Web Audio: the flash and the buzz still work */ }
}

function tone(freq, start, dur, type = 'square', peak = 0.9) {
  const t = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

const SOUNDS = {
  // Two-tone siren, three cycles — the one you cannot miss.
  stop: () => { for (let i = 0; i < 6; i++) tone(i % 2 ? 660 : 990, i * 0.28, 0.26) },
  // Two pairs of beeps: attention, not alarm.
  wait: () => { [0, 0.3, 0.9, 1.2].forEach((s) => tone(880, s, 0.2)) },
  // A rising chime.
  go: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.32, 'triangle')) },
}
const BUZZ = { stop: [400, 150, 400, 150, 600], wait: [250, 150, 250], go: [150, 80, 150, 80, 300] }

/** Sound, speech and vibration for an alert. */
export function playAlert(kind, name = 'Someone') {
  if (!KINDS.includes(kind)) return
  unlockAlertAudio()
  try { if (ctx) SOUNDS[kind]() } catch { /* ignore */ }
  try { navigator.vibrate?.(BUZZ[kind]) } catch { /* ignore */ }
  try {
    const say = new SpeechSynthesisUtterance(`${name} says ${ALERT_LOOK[kind].say}!`)
    say.volume = 1
    say.rate = 1.05
    window.speechSynthesis.cancel()
    setTimeout(() => window.speechSynthesis.speak(say), kind === 'stop' ? 1700 : 1300)
  } catch { /* ignore */ }
}

/** The three buttons. Big enough for gloves. */
export function AlertButtons({ onSend }) {
  const [sent, setSent] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  function send(kind) {
    unlockAlertAudio()
    onSend(kind)
    try { navigator.vibrate?.(60) } catch { /* ignore */ }
    setSent(kind)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSent(null), 1800)
  }

  return (
    <div className="grid grid-cols-3 gap-2 flex-1">
      {KINDS.map((k) => (
        <button key={k} onClick={() => send(k)} aria-label={`Tell the group: ${ALERT_LOOK[k].say}`}
                className={`rounded-xl py-2.5 text-sm font-black tracking-wide shadow-lg active:scale-95 transition
                            ${ALERT_LOOK[k].btn}`}>
          {sent === k ? 'Sent ✓' : ALERT_LOOK[k].label}
        </button>
      ))}
    </div>
  )
}

/** Full-screen alert when someone in the group sends one. Tap to dismiss. */
export function AlertOverlay({ alert, onDismiss }) {
  useEffect(() => {
    if (!alert) return
    const t = setTimeout(onDismiss, alert.kind === 'stop' ? 8000 : 5000)
    return () => clearTimeout(t)
  }, [alert, onDismiss])

  if (!alert) return null
  const look = ALERT_LOOK[alert.kind]
  return (
    <button onClick={onDismiss} role="alert" aria-live="assertive"
            className={`tk-alert fixed inset-0 z-[2000] flex flex-col items-center justify-center text-center px-6 ${look.screen}`}>
      <span className="text-base font-bold uppercase tracking-[0.3em] opacity-85">{alert.name} says</span>
      <span className={`tk-alert-word mt-4 font-black leading-none ${look.size}`}>{look.label}</span>
      <span className="mt-10 text-sm font-semibold opacity-75">Tap to dismiss</span>
    </button>
  )
}
