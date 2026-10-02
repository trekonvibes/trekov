// Added to the Home Screen from this page: open the app, not the pitch.
if (navigator.standalone || matchMedia('(display-mode: standalone)').matches) location.replace('/app/')

// Landing-page sign up: mails the same one-time link the app's account card
// does, straight from trekov.com. Supabase creates the account on first use,
// and the link lands the visitor in /app/ already signed in.
//
// The auth module (and supabase-js with it) is imported on submit, so the
// landing page stays light for everyone who only reads it.

const form = document.getElementById('signup')
const input = document.getElementById('email')
const button = document.getElementById('signup-btn')
const msg = document.getElementById('msg')

const say = (text, bad = false) => {
  msg.style.color = bad ? '#FF5C7A' : 'var(--brand)'
  msg.textContent = text
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const email = input.value.trim()
  if (!/^\S+@\S+\.\S+$/.test(email)) return say('That email address looks incomplete.', true)

  button.disabled = true
  const label = button.textContent
  button.textContent = 'Sending…'
  try {
    const { hasSupabase, sendMagicLink } = await import('./lib/auth')
    if (!hasSupabase) throw new Error('Sign-up is not switched on yet.')
    await sendMagicLink(email)
    form.reset()
    say(`Check ${email} — the link signs you in and opens Trekov.`)
  } catch (err) {
    const text = /rate limit/i.test(err?.message ?? '')
      ? 'Too many sign-up emails just now. Please try again in a little while.'
      : err?.message || 'Could not send the link. Please try again.'
    say(text, true)
  } finally {
    button.disabled = false
    button.textContent = label
  }
})
