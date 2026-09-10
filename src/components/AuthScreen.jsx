import { useEffect, useRef, useState } from 'react'
import { hasSupabase, sendMagicLink } from '../lib/auth'
import { Wordmark } from './Icons'

// Sign up and sign in are one magic link underneath — Supabase creates the
// account the first time the link is used — so the two modes differ only in
// wording. The screen is its own page rather than a card on the profile, so
// arriving from "Sign up" feels like signing up.
const COPY = {
  signup: {
    title: 'Create your account',
    body: "Enter your email and we'll send you a link. Tap it and you're in — there's no password to set.",
    button: 'Send sign-up link',
    switchText: 'Already have an account?', switchTo: 'signin', switchLabel: 'Sign in',
  },
  signin: {
    title: 'Welcome back',
    body: "Enter the email you signed up with and we'll send you a sign-in link.",
    button: 'Send sign-in link',
    switchText: 'New to Trekov?', switchTo: 'signup', switchLabel: 'Create an account',
  },
}

export default function AuthScreen({ mode, notice = '', onModeChange, onClose }) {
  const copy = COPY[mode] ?? COPY.signin
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef(null)

  useEffect(() => { if (!sentTo) input.current?.focus() }, [mode, sentTo])

  async function send(e) {
    e.preventDefault()
    const address = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(address)) return setError('That email address looks incomplete.')
    setBusy(true); setError('')
    try {
      await sendMagicLink(address)
      setSentTo(address)
    } catch (err) {
      setError(/rate limit/i.test(err?.message ?? '')
        ? 'Too many emails just now. Please try again in a little while.'
        : err?.message || 'Could not send the link. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1500] bg-black flex justify-center" role="dialog" aria-modal="true" aria-label={copy.title}>
      <div className="tk-shell h-full w-full flex flex-col bg-ink sm:border-x sm:border-line">
        <header className="flex items-center justify-between px-4 h-14 border-b border-line">
          <Wordmark size={16} />
          <button onClick={onClose} aria-label="Close" className="text-mist hover:text-white p-1 text-lg leading-none">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 pt-12 pb-10 max-w-md w-full mx-auto">
          {!hasSupabase ? (
            <>
              <h1 className="text-2xl font-semibold">Accounts are off</h1>
              <p className="text-sm text-mist leading-relaxed mt-2">
                This build has no account server configured, so everything stays on this device.
              </p>
            </>
          ) : sentTo ? (
            <>
              <h1 className="text-2xl font-semibold">Check your inbox</h1>
              <p className="text-sm text-mist leading-relaxed mt-2">
                We sent a link to <span className="text-white font-medium break-all">{sentTo}</span>.
                Open it on this device and you'll be signed in. It can take a minute — check spam if it doesn't show.
              </p>
              <button onClick={() => { setSentTo(''); setError('') }}
                      className="mt-6 text-sm font-semibold text-brand hover:underline">
                Use a different email
              </button>
            </>
          ) : (
            <>
              {notice && (
                <p className="mb-6 rounded-xl border border-rose/40 bg-rose/10 px-3.5 py-2.5 text-sm text-rose">
                  That sign-in link didn't work ({notice}). Send yourself a fresh one below.
                </p>
              )}
              <h1 className="text-2xl font-semibold">{copy.title}</h1>
              <p className="text-sm text-mist leading-relaxed mt-2">{copy.body}</p>
              <form onSubmit={send} className="mt-7 space-y-3" noValidate>
                <input ref={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                       placeholder="you@email.com" autoComplete="email" aria-label="Email"
                       className="w-full bg-raised rounded-xl px-4 py-3 text-base outline-none
                                  placeholder:text-mist focus:ring-2 focus:ring-brand/50" />
                <button type="submit" disabled={busy || !email.trim()}
                        className="w-full rounded-xl bg-brand text-ink font-semibold py-3 disabled:opacity-40">
                  {busy ? 'Sending…' : copy.button}
                </button>
              </form>
              {error && <p className="text-sm text-rose mt-3">{error}</p>}
              <p className="text-sm text-mist mt-8">
                {copy.switchText}{' '}
                <button onClick={() => { onModeChange(copy.switchTo); setError('') }}
                        className="font-semibold text-brand hover:underline">
                  {copy.switchLabel}
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
