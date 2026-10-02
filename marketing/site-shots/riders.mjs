// The Ladakh Ride's rider list, for the landing page. Run after shoot.mjs,
// in the same headless Chrome (the trip and its riders are still seeded).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from '../ad-60s/cdp.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const { ev, wait, shot } = await connect()
// "Stop navigating" is an aria-label on an icon button, not its text.
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((e) => /Stop navigating/i.test(e.getAttribute('aria-label') || e.innerText)); if (b) b.click(); return b ? 'stopped' : 'not navigating' })()`)
await wait(1500)
await ev(`location.hash = '#trips'`); await wait(1500)
// Trips reopens the trip you were last on, so only open it from the list if the list is what shows.
await ev(`(() => {
  if (/Travelling with/i.test(document.body.innerText)) return 'already open'
  const b = [...document.querySelectorAll('button')].find((e) => /^Ladakh Ride/.test(e.innerText.trim()) && !/Go live/i.test(e.innerText))
  if (b) b.click()
  return b ? 'opened' : 'no trip button'
})()`)
await wait(3500)
const found = await ev(`(() => {
  const h = [...document.querySelectorAll('h2')].find((e) => /Travelling with/i.test(e.innerText))
  if (!h) return 'no rider panel'
  h.scrollIntoView({ block: 'start' })
  const s = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).sort((a, b) => b.clientHeight - a.clientHeight)[0]
  if (s) s.scrollTop -= 70
  return h.innerText
})()`)
await wait(1200)
console.log(found)
await shot(path.join(HERE, 'riders.png'))
process.exit(0)
