// Build the web app into a folder Capacitor can ship.
//
// Two differences from the web build, both deliberate:
//
//   1. The app is at the root. On the web, / is the marketing page and /app/
//      is the product; inside a native app nobody needs to be sold the thing
//      they have already installed, so /app/index.html becomes index.html.
//
//   2. The landing page and its assets are dropped, which keeps the shipped
//      bundle to what the app actually runs.

import { cp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'dist'
const OUT = 'dist-native'

if (!existsSync(SRC)) {
  console.error('No dist/ — run `npm run build` first.')
  process.exit(1)
}

await rm(OUT, { recursive: true, force: true })
await cp(SRC, OUT, { recursive: true })

const appHtml = join(OUT, 'app', 'index.html')
if (!existsSync(appHtml)) {
  console.error('No dist/app/index.html — the app page did not build.')
  process.exit(1)
}

// The app becomes the root document.
await writeFile(join(OUT, 'index.html'), await readFile(appHtml, 'utf8'))
await rm(join(OUT, 'app'), { recursive: true, force: true })

// The invite lander is a web concern: it exists to decide whether someone has
// the app. Someone running the app has already answered that.
await rm(join(OUT, 'i'), { recursive: true, force: true })

const files = await readdir(OUT)
console.log(`✅ ${OUT}/ ready — ${files.length} entries at the root:`, files.join(', '))
