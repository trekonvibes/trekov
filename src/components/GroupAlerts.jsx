import { useEffect, useRef, useState } from 'react'

// STOP / WAIT / LET'S GO — one tap tells everyone on the trip, and it has to
// cut through wind noise and a helmet: a full-screen flash, a loud tone made
// on the spot (no audio files, works offline), and a buzz.
//
// No spoken announcement. Speech took a second to start, arrived after the
// sound it was explaining, and saying whose alert it was told a rider nothing
// they needed at 60 km/h — the screen already says who. The sound is what
// matters, so it got louder instead (Punit, 2026-09-12).

// The word scales with the shorter side too, so it still fits a landscape phone.
export const ALERT_LOOK = {
  stop: { label: 'STOP', btn: 'bg-rose text-white', screen: 'bg-rose text-white', size: 'text-[length:clamp(3rem,min(26vw,28dvh),140px)]' },
  wait: { label: 'WAIT', btn: 'bg-sun text-ink', screen: 'bg-sun text-ink', size: 'text-[length:clamp(3rem,min(26vw,28dvh),140px)]' },
  go:   { label: "LET'S GO", btn: 'bg-brand text-ink', screen: 'bg-brand text-ink', size: 'text-[length:clamp(2.5rem,min(17vw,20dvh),96px)]' },
}
const KINDS = ['stop', 'wait', 'go']

let ctx = null
let chainIn = null                      // tones connect here
/** Browsers only allow sound after a tap; call this from one. */
export function unlockAlertAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    if (!chainIn) {
      // Everything goes through a compressor into a gain above unity. A single
      // oscillator at full scale is as loud as a phone will play it; squashing
      // the peaks first leaves room to push the whole thing harder, which is
      // what makes it carry over an engine.
      const squash = ctx.createDynamicsCompressor()
      squash.threshold.setValueAtTime(-18, ctx.currentTime)
      squash.ratio.setValueAtTime(12, ctx.currentTime)
      squash.attack.setValueAtTime(0.002, ctx.currentTime)
      squash.release.setValueAtTime(0.12, ctx.currentTime)
      // 1.25 measured out about 60% louder than the old alarm (RMS 0.17 against
      // 0.11) while barely touching the ceiling; higher just turned the siren
      // into distortion — half the waveform was clipped flat at 2.4.
      const loud = ctx.createGain()
      loud.gain.setValueAtTime(1.25, ctx.currentTime)
      squash.connect(loud).connect(ctx.destination)
      chainIn = squash
    }
    if (ctx.state === 'suspended') ctx.resume()
  } catch { /* no Web Audio: the flash and the buzz still work */ }
}

function tone(freq, start, dur, type = 'square', peak = 1) {
  const t = ctx.currentTime + start
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  gain.connect(chainIn ?? ctx.destination)
  // The note and the octave below it together: the low one gives it body a
  // phone speaker can actually move air with, which reads as louder than the
  // same note alone at the same level.
  for (const [f, level] of [[freq, 1], [freq / 2, 0.55]]) {
    const osc = ctx.createOscillator()
    const mix = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(f, t)
    mix.gain.setValueAtTime(level, t)
    osc.connect(mix).connect(gain)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }
}

const SOUNDS = {
  // Two-tone siren, five cycles — the one you cannot miss.
  stop: () => { for (let i = 0; i < 10; i++) tone(i % 2 ? 660 : 990, i * 0.26, 0.25) },
  // Three pairs of beeps: attention, not alarm.
  wait: () => { [0, 0.3, 0.9, 1.2, 1.8, 2.1].forEach((s) => tone(880, s, 0.2)) },
  // A rising chime.
  go: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.32, 'triangle')) },
}
const BUZZ = {
  stop: [500, 120, 500, 120, 500, 120, 800],
  wait: [300, 140, 300, 140, 300],
  go: [150, 80, 150, 80, 300],
}

/** Sound and vibration for an alert. Who sent it is on the screen. */
export function playAlert(kind) {
  if (!KINDS.includes(kind)) return
  unlockAlertAudio()
  try { if (ctx) SOUNDS[kind]() } catch { /* ignore */ }
  try { navigator.vibrate?.(BUZZ[kind]) } catch { /* ignore */ }
}

/** The three buttons. Big enough for gloves. */
export function AlertButtons({ onSend, waiting }) {
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

  // Fire on the finger lifting, not on the click that follows it. On iPhone the
  // navigation screen is redrawing all the time — the vehicle, the next-turn
  // chip — and WebKit drops the synthesised click when the page changes during
  // a tap, so STOP looked dead in the iOS app (found on the simulator,
  // 2026-09-13). A click still sends when it comes from the keyboard
  // (detail 0); one that follows a pointer press is the same press, ignored.
  const pressed = useRef(null)

  return (
    <div className="grid grid-cols-3 gap-2 flex-1 min-w-0">
      {KINDS.map((k) => (
        <button key={k}
                onPointerDown={() => { pressed.current = k }}
                onPointerUp={() => { if (pressed.current === k) { pressed.current = null; send(k) } }}
                onPointerCancel={() => { pressed.current = null }}
                onPointerLeave={() => { if (pressed.current === k) pressed.current = null }}
                onClick={(e) => { if (e.detail === 0) send(k) }}
                aria-label={`Tell the group: ${ALERT_LOOK[k].label}`}
                className={`rounded-xl py-2.5 text-sm font-black tracking-wide shadow-lg active:scale-95 transition
                            ${ALERT_LOOK[k].btn}`}>
          {waiting === k ? 'Queued' : sent === k ? 'Sent ✓' : ALERT_LOOK[k].label}
        </button>
      ))}
    </div>
  )
}

// An alert that waited for signal says how old it is: a STOP from eight
// minutes ago means something different from one sent just now.
const late = (at) => {
  const s = Math.round((Date.now() - (at ?? Date.now())) / 1000)
  return s < 30 ? '' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`
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
      {late(alert.at) && <span className="mt-6 text-base font-bold opacity-85">Sent {late(alert.at)} — delayed by signal</span>}
      <span className="mt-10 text-sm font-semibold opacity-75">Tap to dismiss</span>
    </button>
  )
}
