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

  // Client-only environment detection on mount. Must run post-hydration (the
  // static export prerenders with no window), so setState-in-effect is intended.
  useEffect(() => {
    const d = getDesktop()
    /* eslint-disable react-hooks/set-state-in-effect */
    setDesktop(d)
    setFsaSupported(!!d || (typeof window !== 'undefined' && 'showSaveFilePicker' in window))
    /* eslint-enable react-hooks/set-state-in-effect */
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
          const parsed = parseDocument(fileText)
          const opts = {
            direction: parsed.direction,
            theme: parsed.theme,
            look: parsed.look,
            curveStyle: parsed.curveStyle,
          }
          const laidOut = await autoArrange(parsed.nodes, parsed.edges, opts)
          if (cancelled) return
          imp(laidOut, parsed.edges, opts)
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
      if (parsed.error || parsed.nodes.length === 0) return
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

  // Parse a .md and lay it out onto the canvas (used by Open).
  const loadOntoCanvas = async (text: string) => {
    const parsed = parseDocument(text)
    const opts = {
      direction: parsed.direction,
      theme: parsed.theme,
      look: parsed.look,
      curveStyle: parsed.curveStyle,
    }
    const laidOut = await autoArrange(parsed.nodes, parsed.edges, opts)
    useFlowStore.getState().importDiagram(laidOut, parsed.edges, opts)
  }

  // Open an existing .md and load it onto the canvas; auto-save then tracks it.
  const openExisting = async () => {
    const d = getDesktop()
    if (d) {
      const res = await d.openFile()
      if (!res) return // cancelled
      await loadOntoCanvas(res.content ?? '') // replace canvas (blank if file empty)
      setName(baseName(res.path))
      linkedRef.current = true
      diskRef.current = currentSyntax() // canvas now matches the file — never write on open
      setDirty(false)
      setStatus('saved')
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
      linkedRef.current = true
      await write(true) // explicit save to the chosen file
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

  // Standard keyboard shortcuts: Ctrl+S save, Ctrl+Shift+S save as, Ctrl+O open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else saveNow() }
      else if (k === 'o' && !e.shiftKey) { e.preventDefault(); openExisting() }
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

  const dotColor =
    status === 'error' ? '#ef4444'
      : status === 'saving' ? '#f59e0b'
        : !name ? '#4F46E5'
          : dirty ? '#f59e0b' // unsaved changes
            : '#10b981' // saved / clean
  const label = !name ? 'Auto-save' : status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed' : name

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {/* Open an existing .md file */}
      <button
        onClick={openExisting}
        title="Open a .md file (Ctrl+O)"
        aria-label="Open a .md file"
        style={{
          background: NEU_BG,
          border: 'none',
          borderRadius: 12,
          boxShadow: 'var(--neu-shadow-raised)',
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#6B7280',
          flexShrink: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1" />
          <path d="M3 9h16.5a1 1 0 0 1 .97 1.243l-1.5 6A1 1 0 0 1 18 17H4a1 1 0 0 1-1-1V9Z" />
        </svg>
      </button>

      {/* Save-status pill — shows the current auto-save file; click to Save As */}
      <button
        onClick={saveAs}
        title={name ? `${dirty ? 'Unsaved changes' : 'Saved'} — ${name}\nCtrl+S to save now · click for Save As (Ctrl+Shift+S)` : 'Save As — choose a file for your .md'}
        aria-label={name ? `${dirty ? 'Unsaved changes' : 'Saved'}, ${name}. Save As` : 'Save As'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          background: NEU_BG,
          border: 'none',
          borderRadius: 50,
          boxShadow: name ? 'var(--neu-shadow-inset)' : 'var(--neu-shadow-raised)',
          padding: '7px 12px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          color: name ? '#4b5563' : '#4F46E5',
          maxWidth: 190,
          flexShrink: 0,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </button>
    </span>
  )
}
