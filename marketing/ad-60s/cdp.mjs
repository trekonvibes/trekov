// Minimal Chrome DevTools Protocol client (no dependencies) for recording the
// app in a separate headless Chrome: evaluate JS, take screenshots, and record
// the page with Page.startScreencast into a 1080x1920 clip.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const TMP = '/private/tmp/claude-501/-Users-punit/b012c678-123c-498a-8f12-6393691edd09/scratchpad'
export const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'rec')

export async function connect(port = 9333) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
  let id = 0
  const pending = new Map(), handlers = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { ok, no } = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? no(new Error(msg.error.message)) : ok(msg.result)
    } else if (msg.method) (handlers.get(msg.method) || []).forEach((h) => h(msg.params))
  }
  const send = (method, params = {}) => new Promise((ok, no) => {
    const i = ++id; pending.set(i, { ok, no }); ws.send(JSON.stringify({ id: i, method, params }))
  })
  const on = (evName, h) => handlers.set(evName, [...(handlers.get(evName) || []), h])
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(data, 'base64')); return file
  }

  // Recording: frames arrive only when the page repaints, each with its own
  // timestamp, so the clip keeps real time however uneven the frame rate.
  let rec = null
  on('Page.screencastFrame', (p) => {
    send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {})
    if (!rec) return
    const f = path.join(rec.dir, `f${String(rec.frames.length).padStart(5, '0')}.jpg`)
    fs.writeFileSync(f, Buffer.from(p.data, 'base64'))
    rec.frames.push({ f, t: p.metadata.timestamp })
  })
  const record = {
    async start(name) {
      const dir = path.join(TMP, `rec-${name}`)
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
      rec = { name, dir, frames: [], t0: Date.now() / 1000 }
      await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 })
    },
    async stop() {
      const r = rec; const tEnd = Date.now() / 1000
      await send('Page.stopScreencast'); rec = null
      if (!r.frames.length) throw new Error('no frames recorded')
      const lines = []
      r.frames.forEach((fr, i) => {
        const next = i + 1 < r.frames.length ? r.frames[i + 1].t : tEnd
        lines.push(`file '${fr.f}'`, `duration ${Math.max(0.001, next - fr.t).toFixed(4)}`)
      })
      lines.push(`file '${r.frames.at(-1).f}'`)
      fs.writeFileSync(path.join(r.dir, 'list.txt'), lines.join('\n'))
      fs.mkdirSync(OUT, { recursive: true })
      const out = path.join(OUT, `${r.name}.mp4`)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(r.dir, 'list.txt'),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0B100F,fps=30,format=yuv420p',
        '-c:v', 'libx264', '-crf', '16', out])
      const secs = tEnd - r.frames[0].t
      console.log(`${r.name}: ${r.frames.length} frames over ${secs.toFixed(1)}s (${(r.frames.length / secs).toFixed(1)} fps) -> ${out}`)
      return out
    },
  }
  return { send, on, ev, wait, shot, record, close: () => ws.close() }
}
