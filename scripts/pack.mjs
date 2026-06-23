// Package MerScribe into a distributable Windows app + zip, assembled directly
// from the locally-installed Electron runtime (node_modules/electron/dist) — no
// network download and no code-signing tooling, so it builds anywhere without
// elevated privileges. The runtime only needs Electron + the static out/ bundle.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync, renameSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist')
const OUT_DIR = path.join(ROOT, 'dist')
const APP = path.join(OUT_DIR, 'MerScribe-win32-x64')
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

if (!existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
  console.error('Electron runtime not found at', ELECTRON_DIST, '\nRun: pnpm install (and let electron download its binary).')
  process.exit(1)
}
if (!existsSync(path.join(ROOT, 'out', 'index.html'))) {
  console.error('Static build not found in out/. Run "next build" first.')
  process.exit(1)
}

// Fresh output dir
rmSync(APP, { recursive: true, force: true })
mkdirSync(APP, { recursive: true })

// 1. Electron runtime, with the launcher renamed.
cpSync(ELECTRON_DIST, APP, { recursive: true })
renameSync(path.join(APP, 'electron.exe'), path.join(APP, 'MerScribe.exe'))

// 2. Our app replaces Electron's default app.
const RES = path.join(APP, 'resources')
rmSync(path.join(RES, 'default_app.asar'), { force: true })
const APPDIR = path.join(RES, 'app')
mkdirSync(APPDIR, { recursive: true })
cpSync(path.join(ROOT, 'electron'), path.join(APPDIR, 'electron'), { recursive: true })
cpSync(path.join(ROOT, 'out'), path.join(APPDIR, 'out'), { recursive: true })
// Minimal package.json — just the entry point (no dev metadata needed at runtime).
writeFileSync(
  path.join(APPDIR, 'package.json'),
  JSON.stringify({ name: 'merscribe', version: VERSION, main: 'electron/main.cjs' }, null, 2),
)

// 3. Brand the .exe (icon + version strings) if an rcedit binary is available.
const rceditCandidates = [
  path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign', '101515643', 'rcedit-x64.exe'),
  path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'),
]
const rcedit = rceditCandidates.find((p) => p && existsSync(p))
if (rcedit) {
  try {
    execFileSync(rcedit, [
      path.join(APP, 'MerScribe.exe'),
      '--set-icon', path.join(ROOT, 'electron', 'icon.ico'),
      '--set-version-string', 'ProductName', 'MerScribe',
      '--set-version-string', 'FileDescription', 'MerScribe',
      '--set-version-string', 'CompanyName', 'GreatWhiteJ',
      '--set-file-version', `${VERSION}.0`,
      '--set-product-version', `${VERSION}.0`,
    ], { stdio: 'inherit' })
    console.log('Branded MerScribe.exe (icon + version metadata)')
  } catch (e) {
    console.warn('rcedit failed — keeping default Electron icon:', e.message)
  }
} else {
  console.warn('rcedit not found — MerScribe.exe keeps the default Electron icon')
}

// 4. Zip for distribution (extract → run MerScribe.exe).
const zip = path.join(OUT_DIR, 'MerScribe-win-x64.zip')
rmSync(zip, { force: true })
execFileSync(
  'powershell',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${APP}' -DestinationPath '${zip}' -Force`],
  { stdio: 'inherit' },
)
console.log('\nDone:\n  app  →', APP, '\n  zip  →', zip)
