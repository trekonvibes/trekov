// Live-update bundle for the Android and iOS apps (src/lib/liveUpdate.js).
//
// Run after build-native.mjs. It
//   1. stamps dist-native/bundle-version.json, so a running app knows what it is;
//   2. zips dist-native into dist/updates/<version>.zip;
//   3. writes dist/updates/latest.json, which deploy.sh publishes with the site.
//
// The version is a hash of the app's files, so rebuilding unchanged code gives
// the same version and phones don't download it again.
//
// NATIVE_MIN is the oldest app (versionName) this web code can run in. Raise it
// only when the web code starts relying on something native — a new plugin or
// permission — and ship that app first; older apps then keep their current
// code and are told a new app is out.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const NATIVE_MIN = '1.1'
const NATIVE = 'dist-native'
const OUT = join('dist', 'updates')
const STAMP = 'bundle-version.json'

if (!existsSync(NATIVE)) {
  console.error('No dist-native/ — run build-native.mjs first.')
  process.exit(1)
}

// Hash every file except the stamp, in a stable order.
const hash = createHash('sha256')
const names = (await readdir(NATIVE, { recursive: true })).filter((n) => n !== STAMP).sort()
for (const name of names) {
  const path = join(NATIVE, name)
  if (!(await stat(path)).isFile()) continue
  hash.update(name).update('\0').update(await readFile(path))
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const version = `${pkg.version && pkg.version !== '0.0.0' ? pkg.version : '1.0.0'}-${hash.digest('hex').slice(0, 12)}`

// The newest app release, from the Android build file.
const gradle = await readFile(join('android', 'app', 'build.gradle'), 'utf8')
const nativeLatest = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? NATIVE_MIN

// When it was built, too: an app can carry newer code than the live update on
// the website (a release built before deploying), and must not swap it for
// the older one (src/lib/liveUpdate.js).
const builtAt = new Date().toISOString()
await writeFile(join(NATIVE, STAMP), JSON.stringify({ version, builtAt }) + '\n')

await mkdir(OUT, { recursive: true })
const zip = resolve(OUT, `${version}.zip`)
await rm(zip, { force: true })
execFileSync('zip', ['-qr', zip, '.', '-x', '*.DS_Store'], { cwd: NATIVE })

// The signed APK for that release, published with the site so the download
// page can offer it and a running app can point at a newer one. It comes from
// releases/ (git-ignored), so the binary never lands in the source repo — only
// in the gh-pages branch, which is rebuilt from scratch on every deploy.
const apk = resolve('releases', `trekov-${nativeLatest}-release.apk`)
let androidDownload = null
if (existsSync(apk)) {
  await mkdir(join('dist', 'download'), { recursive: true })
  const name = `trekov-${nativeLatest}.apk`
  await copyFile(apk, join('dist', 'download', name))
  androidDownload = `https://trekov.com/download/${name}`
}

// The landing page and the download page name the release. Their sources say
// %%ANDROID_VERSION%%, %%APK_SIZE%% and %%APK_URL%%, filled in here from the build
// that was actually published — so a new release can never leave the site
// offering an old version number, or a link to a file that is not there.
const apkSize = androidDownload ? `${((await stat(apk)).size / 1048576).toFixed(0)} MB` : 'coming soon'
for (const page of [join('dist', 'index.html'), join('dist', 'download', 'index.html')]) {
  if (!existsSync(page)) continue
  const html = (await readFile(page, 'utf8'))
    .replaceAll('%%ANDROID_VERSION%%', nativeLatest)
    .replaceAll('%%APK_SIZE%%', apkSize)
    .replaceAll('%%APK_URL%%', androidDownload ? `/download/trekov-${nativeLatest}.apk` : '/download/')
  await writeFile(page, html)
}

await writeFile(join(OUT, 'latest.json'), JSON.stringify({
  version,
  url: `https://trekov.com/updates/${version}.zip`,
  minNative: NATIVE_MIN,
  nativeLatest,
  // Set when the matching APK was published: the app then offers the new
  // version to anyone running an older one. Null when no APK was built for
  // this versionName, so nobody is sent to a download that does not exist.
  androidDownload,
  builtAt,
}, null, 2) + '\n')

const size = (await stat(zip)).size / 1048576
console.log(`✅ live update ${version} — ${size.toFixed(1)} MB, needs app ${NATIVE_MIN}+ (latest app ${nativeLatest})`)
console.log(androidDownload
  ? `✅ APK published at ${androidDownload}`
  : `⚠️  no releases/trekov-${nativeLatest}-release.apk — the download page will have nothing to offer`)
