import { useEffect, useRef, useState } from 'react'
import {
  PASSWORD_MIN, hasSupabase, isHandleAvailable, looksLikeEmail, sendMagicLink,
  signInWithPassword, signUpWithPassword,
} from '../lib/auth'
import { HANDLE_HINT, normaliseHandle, validHandle } from '../lib/profile'
import { Wordmark } from './Icons'

// Three ways in:
//   signup — pick a username (the @handle people invite you by), email, password
//   signin — username or email, plus password
//   link   — emailed one-time link, for no password or a forgotten one
// Passwords go straight to Supabase; nothing here stores them.

const field = `w-full bg-raised rounded-xl px-4 py-3 text-base outline-none
               placeholder:text-mist focus:ring-2 focus:ring-brand/50`
const primary = 'w-full rounded-xl bg-brand text-ink font-semibold py-3 disabled:opacity-40'
const linkBtn = 'font-semibold text-brand hover:underline'

function PasswordInput({ value, onChange, autoComplete, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
             autoComplete={autoComplete} placeholder={placeholder} aria-label="Password"
             className={`${field} pr-16`} />
      <button type="button" onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-mist hover:text-white">
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

// Riders post photos, reviews and comments, so joining means agreeing to the
// rules on them — the App Store asks for exactly this (guideline 1.2).
function Agreement() {
  return (
    <p className="text-[11px] text-mist leading-relaxed text-center">
      By continuing you agree to Trekov's{' '}
      <a href="https://trekov.com/terms/" target="_blank" rel="noreferrer" className="underline">Terms</a>
      {' '}— no abusive, sexual or illegal content, and you must be 18 or over — and its{' '}
      <a href="https://trekov.com/privacy/" target="_blank" rel="noreferrer" className="underline">Privacy policy</a>.
    </p>
  )
}

export default function AuthScreen({ mode, notice = '', linkError = '', required = false, onModeChange, onClose }) {
  const [handle, setHandle] = useState('')
  const [handleFree, setHandleFree] = useState(null)   // null = unknown/checking
  const [email, setEmail] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(null)               // { kind: 'confirm' | 'link', to }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const first = useRef(null)

  useEffect(() => { setError(''); if (!sent) first.current?.focus() }, [mode, sent])

  // Check the username as it's typed, once it's a valid shape.
  useEffect(() => {
    setHandleFree(null)
    if (mode !== 'signup' || !validHandle(handle)) return
    let live = true
    const t = setTimeout(() => isHandleAvailable(handle).then((ok) => { if (live) setHandleFree(ok) }), 350)
    return () => { live = false; clearTimeout(t) }
  }, [handle, mode])

  const go = (m) => { setSent(null); setPassword(''); onModeChange(m) }

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn() } catch (err) { setError(friendly(err)) } finally { setBusy(false) }
  }

  const signUp = (e) => {
    e.preventDefault()
    if (!validHandle(handle)) return setError(HANDLE_HINT)
    if (handleFree === false) return setError(`@${handle} is taken — try another.`)
    if (!looksLikeEmail(email)) return setError('That email address looks incomplete.')
    if (password.length < PASSWORD_MIN) return setError(`Use a password of at least ${PASSWORD_MIN} characters.`)
    run(async () => {
      sessionStorage.setItem('trekov.takeover', '1')   // this device becomes the account's one device
      const { needsConfirmation } = await signUpWithPassword({ email, password, handle })
      if (needsConfirmation) setSent({ kind: 'confirm', to: email.trim() })
      // Otherwise the session arrived and the app closes this screen.
    })
  }

  const signIn = (e) => {
    e.preventDefault()
    if (!identifier.trim()) return setError('Enter your username or email.')
    if (!password) return setError('Enter your password.')
    run(() => { sessionStorage.setItem('trekov.takeover', '1'); return signInWithPassword(identifier, password) })
  }

  const emailLink = (e) => {
    e.preventDefault()
    if (!looksLikeEmail(email)) return setError('That email address looks incomplete.')
    run(async () => { await sendMagicLink(email); setSent({ kind: 'link', to: email.trim() }) })
  }

  const title = { signup: 'Create your account', signin: 'Welcome back', link: 'Email me a sign-in link' }[mode] ?? 'Welcome back'

  return (
    <div className="fixed inset-0 z-[1500] bg-black flex justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="tk-shell h-full w-full flex flex-col bg-ink sm:border-x sm:border-line pt-safe px-safe">
        <header className="flex items-center justify-between px-4 h-14 border-b border-line">
          <Wordmark size={16} />
          {required ? (
            // The app needs an account, so there is nothing to close back to.
            <a href="/" className="text-xs text-mist hover:text-white">About Trekov</a>
          ) : (
            <button onClick={onClose} aria-label="Close" className="grid place-items-center size-10 -mr-2 text-mist hover:text-white text-lg leading-none">✕</button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-6 pt-10 pb-10 max-w-md w-full mx-auto">
          {!hasSupabase ? (
            <>
              <h1 className="text-2xl font-semibold">Accounts are off</h1>
              <p className="text-sm text-mist leading-relaxed mt-2">
                This build has no account server configured, so everything stays on this device.
              </p>
            </>
          ) : sent ? (
            <>
              <h1 className="text-2xl font-semibold">Check your inbox</h1>
              <p className="text-sm text-mist leading-relaxed mt-2">
                {sent.kind === 'confirm'
                  ? <>We sent a confirmation link to <b className="text-white break-all">{sent.to}</b>. Tap it to finish
                      creating @{handle} — after that you can sign in with your username or email and password.</>
                  : <>We sent a sign-in link to <b className="text-white break-all">{sent.to}</b>. Open it on this device
                      and you'll be signed in. Once in, you can set a password from your profile.</>}
              </p>
              <p className="text-xs text-mist mt-3">It can take a minute — check spam if it doesn't show.</p>
              <button onClick={() => setSent(null)} className={`mt-6 text-sm ${linkBtn}`}>Use a different email</button>
            </>
          ) : (
            <>
              {linkError && (
                <p className="mb-6 rounded-xl border border-rose/40 bg-rose/10 px-3.5 py-2.5 text-sm text-rose">
                  That sign-in link didn't work ({linkError}). Sign in below or send yourself a fresh link.
                </p>
              )}
              {notice && (
                <p className="mb-6 rounded-xl border border-sun/40 bg-sun/10 px-3.5 py-2.5 text-sm text-sun">{notice}</p>
              )}
              <h1 className="text-2xl font-semibold">{title}</h1>
              {required && !notice && !linkError && (
                <p className="text-sm text-mist mt-2">Sign in or create an account to use Trekov.</p>
              )}

              {mode === 'signup' && (
                <form onSubmit={signUp} className="mt-6 space-y-3" noValidate>
                  <div>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-mist">@</span>
                      <input ref={first} value={handle} onChange={(e) => setHandle(normaliseHandle(e.target.value))}
                             placeholder="username" autoComplete="username" aria-label="Username"
                             autoCapitalize="none" spellCheck={false} className={`${field} pl-8`} />
                    </div>
                    <p className={`text-[11px] mt-1 ${handleFree === false ? 'text-rose' : handleFree ? 'text-brand' : 'text-mist'}`}>
                      {handleFree === false ? `@${handle} is taken`
                        : handleFree ? `@${handle} is yours — friends invite you by this`
                        : HANDLE_HINT}
                    </p>
                  </div>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                         placeholder="you@email.com" autoComplete="email" aria-label="Email" className={field} />
                  <PasswordInput value={password} onChange={setPassword} autoComplete="new-password"
                                 placeholder={`Password (${PASSWORD_MIN}+ characters)`} />
                  <button type="submit" disabled={busy} className={primary}>
                    {busy ? 'Creating…' : 'Create account'}
                  </button>
                  <Agreement />
                </form>
              )}

              {mode === 'signin' && (
                <form onSubmit={signIn} className="mt-6 space-y-3" noValidate>
                  <input ref={first} value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                         placeholder="Username or email" autoComplete="username" aria-label="Username or email"
                         autoCapitalize="none" spellCheck={false} className={field} />
                  <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" placeholder="Password" />
                  <button type="submit" disabled={busy} className={primary}>
                    {busy ? 'Signing in…' : 'Sign in'}
                  </button>
                  <button type="button" onClick={() => go('link')} className={`text-sm ${linkBtn}`}>
                    Forgot password, or never set one? Email me a sign-in link
                  </button>
                </form>
              )}

              {mode === 'link' && (
                <form onSubmit={emailLink} className="mt-6 space-y-3" noValidate>
                  <p className="text-sm text-mist leading-relaxed">
                    We'll email you a one-time link. After signing in you can set a new password from your profile.
                  </p>
                  <input ref={first} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                         placeholder="you@email.com" autoComplete="email" aria-label="Email" className={field} />
                  <button type="submit" disabled={busy} className={primary}>
                    {busy ? 'Sending…' : 'Send sign-in link'}
                  </button>
                  <Agreement />
                </form>
              )}

              {error && <p className="text-sm text-rose mt-3">{error}</p>}

              <p className="text-sm text-mist mt-8">
                {mode === 'signup'
                  ? <>Already have an account? <button onClick={() => go('signin')} className={linkBtn}>Sign in</button></>
                  : <>New to Trekov? <button onClick={() => go('signup')} className={linkBtn}>Create an account</button></>}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function friendly(err) {
  const m = err?.message ?? ''
  if (/rate limit/i.test(m)) return 'Too many attempts just now. Please try again in a little while.'
  return m || 'Something went wrong. Please try again.'
}
