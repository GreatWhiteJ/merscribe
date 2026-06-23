const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')

app.setName('MerScribe') // stable userData path for the saved session

// Locate the static export (out/). Different packagings place it differently:
//  - electron-builder: copied via extraResources → <resources>/out
//  - pack.mjs / dev:    alongside the app           → <__dirname>/../out
const OUT = [
  path.join(process.resourcesPath || '', 'out'),
  path.join(__dirname, '..', 'out'),
].find((p) => fs.existsSync(path.join(p, 'index.html'))) || path.join(__dirname, '..', 'out')
let savePath = null
let mainWindow = null
let fileWatcher = null
let lastWrittenMd = null // the .md we last wrote — used to ignore our own writes
let watchTimer = null

// Session persistence (full canvas state + last save path) in app userData.
// This is what lets the app reopen your last work; the .md stays a clean export.
const sessionFile = () => path.join(app.getPath('userData'), 'session.json')
function readSession() {
  try { return JSON.parse(fs.readFileSync(sessionFile(), 'utf8')) } catch { return null }
}
function writeSession(obj) {
  try { fs.writeFileSync(sessionFile(), JSON.stringify(obj), 'utf8') } catch { /* ignore */ }
}

// ── Live file watching ───────────────────────────────────────────────────────
// Watch the linked .md so external edits (an agent, or another editor) flow into
// the canvas in real time. Our own auto-saves are ignored via lastWrittenMd.
function emitFileChange() {
  if (watchTimer) clearTimeout(watchTimer)
  watchTimer = setTimeout(() => {
    let content
    try { content = fs.readFileSync(savePath, 'utf8') } catch { return }
    if (content === lastWrittenMd) return // our own write echoing back
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-changed', content)
    }
  }, 150)
}
function watchSavePath() {
  if (fileWatcher) { try { fileWatcher.close() } catch { /* ignore */ } fileWatcher = null }
  if (!savePath) return
  try {
    // Watch the directory (more robust than watching a single file on Windows,
    // where editors replace files via rename), filtering to our basename.
    const dir = path.dirname(savePath)
    const base = path.basename(savePath)
    fileWatcher = fs.watch(dir, (_event, filename) => {
      if (!filename || path.basename(String(filename)) === base) emitFileChange()
    })
  } catch { /* ignore */ }
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.map': 'application/json', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
}

// Serve the static Next export (out/) from a localhost port.
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
        if (urlPath.endsWith('/')) urlPath += 'index.html'
        let filePath = path.normalize(path.join(OUT, urlPath))
        if (!filePath.startsWith(OUT)) { res.writeHead(403); res.end(); return }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          const idx = path.join(filePath, 'index.html')
          filePath = fs.existsSync(idx) ? idx : path.join(OUT, 'index.html')
        }
        const ext = path.extname(filePath).toLowerCase()
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
        fs.createReadStream(filePath).pipe(res)
      } catch (e) {
        res.writeHead(500); res.end(String(e))
      }
    })
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function createWindow() {
  const port = await startServer()
  const sess = readSession()
  savePath = (sess && sess.savePath) || path.join(app.getPath('downloads'), 'diagram.md')
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'MerScribe',
    backgroundColor: '#E0E5EC',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setMenuBarVisibility(false)
  mainWindow = win
  win.loadURL(`http://127.0.0.1:${port}/`)
  watchSavePath()
}

// ── Auto-save IPC ────────────────────────────────────────────────────────────
ipcMain.handle('get-save-path', () => savePath)

// Returns the previously-saved full canvas state (or null) for restore on launch.
ipcMain.handle('load-session', () => {
  const s = readSession()
  return s && s.state ? s.state : null
})

// Returns the raw .md text currently on disk (the canonical artifact an agent
// may have edited while the app was closed), or null if it doesn't exist yet.
ipcMain.handle('load-file', () => {
  try { return fs.readFileSync(savePath, 'utf8') } catch { return null }
})

// Pick a .md to open/link. Uses an Open dialog (not Save) so there's no
// "overwrite?" warning — selecting a file opens it, then auto-save tracks it.
ipcMain.handle('choose-save-path', async () => {
  const r = await dialog.showOpenDialog({
    defaultPath: savePath,
    properties: ['openFile', 'createDirectory', 'promptToCreate'],
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (!r.canceled && r.filePaths && r.filePaths[0]) {
    savePath = r.filePaths[0]
    writeSession({ ...(readSession() || {}), savePath })
    watchSavePath() // follow the newly-linked file
    return savePath
  }
  return null
})

// Writes the clean .md export to disk and persists the full state for restore.
ipcMain.handle('save', async (_e, md, state) => {
  if (!savePath) return false
  lastWrittenMd = md // mark as ours so the watcher ignores this write
  await fs.promises.writeFile(savePath, md, 'utf8')
  writeSession({ savePath, state })
  return true
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
