'use client'

import { useEffect, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import { useFlowStore, type FlowNodeData } from '@/lib/store'
import { parseDocument, type ParseResult } from '@/lib/parser'
import { serializeDocument } from '@/lib/serializer'
import { autoArrange } from '@/lib/mermaidLayout'

const NEU_BG = 'var(--neu-bg)'

// Electron preload bridge (present only in the desktop app).
interface DesktopBridge {
  getSavePath: () => Promise<string>
  openFile: () => Promise<{ path: string; content: string | null } | null>
  openPath: (p: string) => Promise<{ path: string; content: string | null } | null>
  newFile: () => Promise<string | null>
  getRecents: () => Promise<string[]>
  saveAs: () => Promise<string | null>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadSession: () => Promise<any>
  loadFile: () => Promise<string | null>
  save: (md: string, state: string) => Promise<boolean>
  onFileChanged?: (cb: (content: string) => void) => () => void
}

// Merge parsed (.md-canonical) nodes with previous layout: keep a node's saved
// position/size when its id AND parent are unchanged; new/reparented nodes take
// the parser's fresh layout. Used for both restore-on-launch and live updates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function overlayPositions(parsed: Node<FlowNodeData>[], prev: any[]): Node<FlowNodeData>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prevById = new Map<string, any>((prev ?? []).map((n) => [n.id, n]))
  return parsed.map((n) => {
    const p = prevById.get(n.id)
    const samePar = p && (p.parentId ?? null) === (n.parentId ?? null)
    if (!samePar) return n
    return {
      ...n,
      position: p.position ?? n.position,
      ...(p.width != null ? { width: p.width, height: p.height } : {}),
      ...(p.style ? { style: p.style } : {}),
      data: { ...n.data, ...(p.data?.fontSize != null ? { fontSize: p.data.fontSize } : {}) },
    }
  })
}

// A signature of the graph topology — node id set + directed edges. Layout (rank
// order, left/right) is a function of BOTH, so a flipped/added/removed edge must
// trigger a re-layout even when the node set is unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function topoSig(nodes: any[], edges: any[]): string {
  const n = (nodes ?? []).map((x) => x.id).sort().join(',')
  const e = (edges ?? []).map((x) => `${x.source}>${x.target}`).sort().join('|')
  return `${n}#${e}`
}

// Decide node positions for an incoming .md:
//  - identical topology (only labels / cosmetics changed) → keep the existing
//    layout, so a rename never reshuffles a diagram you've arranged.
//  - any node OR edge change → re-layout with Mermaid's engine so the canvas
//    follows a clean, crossing-free flow (upstream→downstream, sensible left/
//    right) that matches the Mermaid Live preview. Falls back to the parser's
//    Dagre layout if the Mermaid render fails.
async function layoutDoc(
  parsed: ParseResult,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prevNodes: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prevEdges: any[],
): Promise<Node<FlowNodeData>[]> {
  if (topoSig(parsed.nodes, parsed.edges) === topoSig(prevNodes, prevEdges)) {
    return overlayPositions(parsed.nodes, prevNodes)
  }
  return autoArrange(parsed.nodes, parsed.edges, {
    direction: parsed.direction,
    theme: parsed.theme,
    look: parsed.look,
    curveStyle: parsed.curveStyle,
  })
}

// Full canvas state for restore-on-launch (kept separate from the clean .md).
function snapshot(): string {
  const s = useFlowStore.getState()
  return JSON.stringify({
    version: 1,
    nodes: s.nodes,
    edges: s.edges,
    direction: s.direction,
    theme: s.theme,
    look: s.look,
    curveStyle: s.curveStyle,
  })
}
// The clean .md, serialized from the live store (not a possibly-stale prop), so
// a write issued right after an import/restore captures the new state, not the old.
function currentSyntax(): string {
  const s = useFlowStore.getState()
  return serializeDocument(s.nodes, s.edges, {
    direction: s.direction,
    theme: s.theme,
    look: s.look,
    curveStyle: s.curveStyle,
  })
}
function getDesktop(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).desktop ?? null
}
const baseName = (p: string) => p.split(/[\\/]/).pop() || p

const NO_DIAGRAM_MSG =
  'No diagram was found. MerScribe expects a ```mermaid block containing a flowchart or erDiagram.'

// Parse raw .md and either load it onto the canvas or raise a loadError. Returns
// true on success. A non-empty file that parses to an error OR to zero nodes is
// treated as corrupt/unsupported: we warn (with the raw text for Copy-for-LLM)
// and leave the file on disk untouched (the empty-canvas auto-save guard). An
// empty file is a legitimately empty diagram — no warning.
async function applyDocText(text: string): Promise<boolean> {
  // parseDocument *returns* soft errors, but a hard throw (a layout engine
  // choking on an odd-but-legal diagram, say) used to escape here and leave the
  // user staring at a window where nothing happened. Treat it as a load error.
  let parsed: ParseResult
  try {
    parsed = parseDocument(text)
  } catch (err) {
    useFlowStore.getState().setLoadError({
      message: `MerScribe hit an unexpected error reading this file: ${err instanceof Error ? err.message : String(err)}`,
      content: text,
    })
    return false
  }
  if (text.trim() && (parsed.error || parsed.nodes.length === 0)) {
    useFlowStore.getState().setLoadError({ message: parsed.error ?? NO_DIAGRAM_MSG, content: text })
    return false
  }
  const opts = {
    direction: parsed.direction,
    theme: parsed.theme,
    look: parsed.look,
    curveStyle: parsed.curveStyle,
  }
  const laidOut = await autoArrange(parsed.nodes, parsed.edges, opts)
  useFlowStore.getState().importDiagram(laidOut, parsed.edges, opts)
  useFlowStore.getState().setLoadError(null)
  return true
}

/**
 * Continuous auto-save of the generated .md document.
 *  - Desktop (Electron): writes silently to disk via IPC, auto-starts on load
 *    (defaults to Downloads/diagram.md), no click required.
 *  - Browser: uses the File System Access API — one click to pick the file,
 *    then auto-saves; falls back to "n/a" on non-Chromium browsers.
 */
export function AutoSave({ syntax }: { syntax: string }) {
  const [name, setName] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [dirty, setDirty] = useState(false) // canvas has unsaved changes vs disk
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleRef = useRef<any>(null) // FileSystemFileHandle (browser mode)
  const linkedRef = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The document (serializer form) currently on disk. We only write when the
  // canvas serializes to something different — so an incoming external change
  // never triggers an echo-write, and a real canvas edit is never swallowed.
  const diskRef = useRef<string | null>(null)
  const [desktop, setDesktop] = useState<DesktopBridge | null>(null)
  const [fsaSupported, setFsaSupported] = useState(true)
  const [recents, setRecents] = useState<string[]>([])
  const [recentsOpen, setRecentsOpen] = useState(false)
  // A pending destructive action awaiting confirmation (replacing the canvas).
  const [confirmAction, setConfirmAction] = useState<null | { run: () => void; title: string; body: string }>(null)
  // A brand-new document not yet written to disk (auto-save creates it on first edit).
  const [untitled, setUntitled] = useState(false)

  // Client-only environment detection on mount. Must run post-hydration (the
  // static export prerenders with no window), so setState-in-effect is intended.
  useEffect(() => {
    const d = getDesktop()
    setDesktop(d)
    setFsaSupported(!!d || (typeof window !== 'undefined' && 'showSaveFilePicker' in window))
  }, [])

  // Write the current canvas to the linked file. Auto-save calls this with
  // force=false; an explicit Save (Ctrl+S / Save As) passes force=true.
  // Safety net: auto-save NEVER writes an empty canvas over the file — a botched
  // load could otherwise wipe your document. Emptying a file needs an explicit Save.
  const write = async (force = false) => {
    try {
      if (!force && useFlowStore.getState().nodes.length === 0) return
      setStatus('saving')
      const md = currentSyntax()
      const d = getDesktop()
      if (d) {
        await d.save(md, snapshot())
      } else {
        const h = handleRef.current
        if (!h) { setStatus('idle'); return }
        const w = await h.createWritable()
        await w.write(md)
        await w.close()
      }
      diskRef.current = md // disk now holds exactly this
      setDirty(false)
      setStatus('saved')
      setUntitled(false) // the file now exists on disk — no longer an unsaved new doc
    } catch {
      setStatus('error')
    }
  }

  // Desktop: restore the last session, then link auto-save to the same file.
  useEffect(() => {
    const d = getDesktop()
    if (!d) return
    let cancelled = false
    ;(async () => {
      try {
        const [fileText, state] = await Promise.all([
          d.loadFile ? d.loadFile() : Promise.resolve(null),
          d.loadSession(),
        ])
        if (cancelled) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sess: any = state ? (typeof state === 'string' ? JSON.parse(state) : state) : null
        const sessOk = sess && Array.isArray(sess.nodes)
        const sessOpts = {
          direction: sess?.direction ?? 'TD',
          theme: sess?.theme ?? 'default',
          look: sess?.look ?? 'classic',
          curveStyle: sess?.curveStyle ?? 'basis',
        }
        const imp = useFlowStore.getState().importDiagram

        if (fileText && fileText.trim()) {
          // The .md on disk is the canonical artifact. Always lay it out with
          // Mermaid's engine so the canvas opens as the clean, crossing-free
          // flow you see in the Mermaid Live preview (not stale saved positions).
          // If it can't be parsed, applyDocText raises a warning instead of
          // silently opening a blank canvas.
          if (cancelled) return
          await applyDocText(fileText)
          if (cancelled) return
        } else if (sessOk) {
          imp(sess.nodes, sess.edges ?? [], sessOpts)
        }
        // Record what the canvas now serializes to; the file already holds it.
        diskRef.current = currentSyntax()
      } catch {
        /* ignore a corrupt session / unreadable file */
      }
      if (cancelled) return
      const path = await d.getSavePath()
      setName(baseName(path))
      linkedRef.current = true
      try { setRecents(await d.getRecents()) } catch { /* ignore */ }
      // Do NOT write here — restoring/opening must never overwrite the file.
      // Auto-save kicks in only once the canvas actually changes.
    })()
    return () => {
      cancelled = true
    }
     
  }, [])

  // Desktop: live-update the canvas when the linked .md changes on disk (an
  // agent or external editor), merging the new structure over current layout.
  useEffect(() => {
    const d = getDesktop()
    if (!d?.onFileChanged) return
    const unsub = d.onFileChanged(async (content) => {
      if (!content || !content.trim()) return
      const parsed = parseDocument(content)
      if (parsed.error || parsed.nodes.length === 0) {
        // An external edit (an agent/editor) made the file unreadable. Keep the
        // current canvas but warn, with the raw text ready to Copy-for-LLM.
        useFlowStore.getState().setLoadError({ message: parsed.error ?? NO_DIAGRAM_MSG, content })
        return
      }
      // Parse succeeded — clear any earlier "file couldn't be read" warning.
      useFlowStore.getState().setLoadError(null)
      const opts = {
        direction: parsed.direction,
        theme: parsed.theme,
        look: parsed.look,
        curveStyle: parsed.curveStyle,
      }
      // If the incoming file already matches the current canvas (e.g. our own
      // write echoing back), do nothing — don't relayout or clobber positions.
      const incoming = serializeDocument(parsed.nodes, parsed.edges, opts)
      if (incoming === currentSyntax()) { diskRef.current = currentSyntax(); return }
      const st = useFlowStore.getState()
      const laidOut = await layoutDoc(parsed, st.nodes, st.edges)
      useFlowStore.getState().importDiagram(laidOut, parsed.edges, opts)
      // The file already holds this content; record it so we don't echo-write.
      diskRef.current = currentSyntax()
    })
    return unsub
  }, [])

  // Debounced write whenever the canvas serializes to something not yet on disk.
  // (write() sets the "saving" status when it runs.)
  useEffect(() => {
    if (!linkedRef.current) return
    if (syntax === diskRef.current) { setDirty(false); return } // saved / just loaded
    setDirty(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => write(false), 600)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }

  }, [syntax])

  // Parse a .md and lay it out onto the canvas (used by Open). Warns via
  // loadError instead of silently blanking the canvas when the file is corrupt.
  const loadOntoCanvas = async (text: string) => {
    await applyDocText(text)
  }

  // Pull the recent-files list from the desktop bridge (no-op in the browser).
  const refreshRecents = async () => {
    const d = getDesktop()
    if (!d?.getRecents) return
    try { setRecents(await d.getRecents()) } catch { /* ignore */ }
  }

  // Open an existing .md and load it onto the canvas; auto-save then tracks it.
  const openExisting = async () => {
    const d = getDesktop()
    if (d) {
      const res = await d.openFile()
      if (!res) return // cancelled
      await loadOntoCanvas(res.content ?? '') // replace canvas (blank if file empty)
      setName(baseName(res.path))
      setUntitled(false)
      linkedRef.current = true
      diskRef.current = currentSyntax() // canvas now matches the file — never write on open
      setDirty(false)
      setStatus('saved')
      refreshRecents()
      return
    }
    if (!fsaSupported) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [h] = await (window as any).showOpenFilePicker({
        startIn: 'downloads',
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
      })
      const file = await h.getFile()
      const text = await file.text()
      await loadOntoCanvas(text ?? '')
      handleRef.current = h
      setName(h.name)
      linkedRef.current = true
      diskRef.current = currentSyntax()
      setDirty(false)
      setStatus('saved')
    } catch {
      /* user cancelled */
    }
  }

  // Save As: choose a new name/location; the current canvas is written there and
  // becomes the new auto-save target. The canvas content is unchanged.
  const saveAs = async () => {
    const d = getDesktop()
    if (d) {
      const path = await d.saveAs()
      if (!path) return // cancelled
      setName(baseName(path))
      setUntitled(false)
      linkedRef.current = true
      await write(true) // explicit save to the chosen file
      refreshRecents()
      return
    }
    if (!fsaSupported) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = await (window as any).showSaveFilePicker({
        suggestedName: name ?? 'diagram.md',
        startIn: 'downloads',
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
      })
      handleRef.current = h
      setName(h.name)
      linkedRef.current = true
      await write(true)
    } catch {
      /* user cancelled */
    }
  }

  // Explicit Save (Ctrl/Cmd+S). Forces a write even of an empty canvas; if no
  // file is linked yet, falls back to Save As.
  const saveNow = async () => {
    const d = getDesktop()
    if (d) {
      if (!name) { await saveAs(); return }
      await write(true)
      return
    }
    if (!handleRef.current) { await saveAs(); return }
    await write(true)
  }

  const BLANK = { direction: 'TD', theme: 'default', look: 'classic', curveStyle: 'basis' } as const

  // Start a fresh, blank document. On desktop this links a new untitled .md (not
  // written until you add something); in the browser it just unlinks and clears.
  const newDoc = async () => {
    const d = getDesktop()
    useFlowStore.getState().setLoadError(null)
    useFlowStore.getState().importDiagram([], [], BLANK)
    if (d) {
      const path = await d.newFile()
      setName(path ? baseName(path) : null)
      setUntitled(true)
      linkedRef.current = true
      diskRef.current = currentSyntax()
      setDirty(false)
      setStatus('idle')
      refreshRecents()
      return
    }
    handleRef.current = null
    setName(null)
    setUntitled(true)
    linkedRef.current = false
    diskRef.current = null
    setDirty(false)
    setStatus('idle')
  }

  // Open a file straight from the recent-files list (desktop only, no dialog).
  const openRecent = async (p: string) => {
    const d = getDesktop()
    if (!d?.openPath) return
    setRecentsOpen(false)
    const res = await d.openPath(p)
    if (!res) { refreshRecents(); return } // file gone — main prunes it
    await loadOntoCanvas(res.content ?? '')
    setName(baseName(res.path))
    setUntitled(false)
    linkedRef.current = true
    diskRef.current = currentSyntax()
    setDirty(false)
    setStatus('saved')
    refreshRecents()
  }

  // Replacing the on-screen diagram is safe (the current file is auto-saved), but
  // confirm first when there's work on the canvas so it's never a surprise.
  const guard = (title: string, body: string, run: () => void) => {
    if (useFlowStore.getState().nodes.length === 0) { run(); return }
    setConfirmAction({ title, body, run })
  }
  const savedTo = () => (name ? ` to “${name}”` : '')
  const guardedNew = () => guard('Start a new diagram?', `Your current diagram is auto-saved${savedTo()}. This clears the canvas for a new file.`, newDoc)
  const guardedOpen = () => guard('Open another file?', `Your current diagram is auto-saved${savedTo()} and will be replaced on screen.`, openExisting)
  const guardedOpenRecent = (p: string) => { setRecentsOpen(false); guard('Open this file?', `Your current diagram is auto-saved${savedTo()} and will be replaced on screen.`, () => openRecent(p)) }

  // Standard keyboard shortcuts: Ctrl+S save, Ctrl+Shift+S save as, Ctrl+O open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else saveNow() }
      else if (k === 'o' && !e.shiftKey) { e.preventDefault(); guardedOpen() }
      else if (k === 'n' && !e.shiftKey) { e.preventDefault(); guardedNew() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  if (!fsaSupported && !desktop) {
    return (
      <span title="Auto-save needs the desktop app or a Chromium browser" style={{ fontSize: 11, color: '#9ca3af', padding: '0 6px', whiteSpace: 'nowrap' }}>
        Auto-save n/a
      </span>
    )
  }

  const busy = status === 'saving' || dirty
  const dotColor =
    status === 'error' ? '#ef4444'
      : busy ? '#f59e0b'
        : untitled ? '#4F46E5'
          : '#10b981' // saved / clean
  const stateHint =
    status === 'error' ? 'Save failed'
      : busy ? 'Auto-saving…'
        : untitled ? 'New — add to save'
          : 'Auto-saved'

  const fileBtn: React.CSSProperties = {
    background: NEU_BG, border: 'none', borderRadius: 12, boxShadow: 'var(--neu-shadow-raised)',
    width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: '#6B7280', flexShrink: 0,
  }
  const hasRecents = !!desktop && recents.length > 0

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {/* New blank document */}
      <button onClick={guardedNew} title="New diagram (Ctrl+N)" aria-label="New diagram" style={fileBtn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
      </button>

      {/* Open + recent files */}
      <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button
          onClick={guardedOpen}
          title="Open a .md file (Ctrl+O)"
          aria-label="Open a .md file"
          style={{ ...fileBtn, ...(hasRecents ? { borderTopRightRadius: 4, borderBottomRightRadius: 4 } : {}) }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1" />
            <path d="M3 9h16.5a1 1 0 0 1 .97 1.243l-1.5 6A1 1 0 0 1 18 17H4a1 1 0 0 1-1-1V9Z" />
          </svg>
        </button>
        {hasRecents && (
          <button
            onClick={() => { setRecentsOpen((v) => !v); refreshRecents() }}
            title="Recent files"
            aria-label="Recent files"
            aria-haspopup="menu"
            aria-expanded={recentsOpen}
            style={{ ...fileBtn, width: 22, marginLeft: 2, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, fontSize: 10 }}
          >
            ▾
          </button>
        )}
        {recentsOpen && hasRecents && (
          <>
            <div onClick={() => setRecentsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div
              role="menu"
              aria-label="Recent files"
              style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 41, background: '#fff', borderRadius: 12, boxShadow: '0 10px 28px rgba(0,0,0,0.18)', border: '1px solid #eee', padding: 6, minWidth: 250, maxWidth: 360 }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#9ca3af', padding: '4px 8px' }}>Recent files</div>
              {recents.map((p) => (
                <button
                  key={p}
                  role="menuitem"
                  onClick={() => guardedOpenRecent(p)}
                  title={p}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 8, padding: '6px 8px', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ fontWeight: 600, fontSize: 12, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{baseName(p)}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left' }}>{p}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </span>

      {/* Save As — fork the diagram to a new file */}
      <button onClick={saveAs} title="Save As — save to a new file (Ctrl+Shift+S)" aria-label="Save As" style={fileBtn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
      </button>

      {/* Auto-save status — NOT a button; every change saves to this file. */}
      <span
        title={name
          ? `Auto-saving to ${name}${untitled ? ' (new file — created on your first change)' : ''}. Every change is saved automatically.`
          : 'No file linked. Use Save As to choose where your .md is saved.'}
        aria-label={`${name ?? 'Untitled'}, ${stateHint}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, background: NEU_BG, borderRadius: 50,
          boxShadow: 'var(--neu-shadow-inset)', padding: '5px 12px', fontSize: 12, fontWeight: 600,
          color: '#4b5563', maxWidth: 210, flexShrink: 0, userSelect: 'none',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, overflow: 'hidden' }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name ?? 'Untitled'}</span>
          <span style={{ fontSize: 9, fontWeight: 600, color: '#9ca3af', whiteSpace: 'nowrap' }}>{stateHint}</span>
        </span>
      </span>

      {/* Confirm before replacing the on-screen diagram (work is already saved). */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmAction(null) }}
        >
          <div role="dialog" aria-modal="true" aria-label={confirmAction.title} style={{ background: '#fff', borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', width: 400, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{confirmAction.title}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>{confirmAction.body}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setConfirmAction(null)} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, color: '#4b5563', background: 'transparent', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => { const a = confirmAction; setConfirmAction(null); a.run() }} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, color: '#fff', background: '#4F46E5', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Continue</button>
            </div>
          </div>
        </div>
      )}
    </span>
  )
}
