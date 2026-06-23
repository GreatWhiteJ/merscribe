import mermaid from 'mermaid'
import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import type { CurveStyle, Direction, FlowEdgeData, FlowNodeData, Look, Theme } from './store'
import { serializeDocument, extractMermaidBlocks } from './serializer'

// Layout for the canvas. We run Dagre (the same engine Mermaid uses) but feed it
// each node's REAL rendered size — plain shapes measured by an off-screen Mermaid
// render (exact text sizing), tables/entities/notes computed from their content.
// Feeding true sizes is what stops a big table from landing on the node below it,
// while still producing the clean, crossing-free, top-down flow of Mermaid Live.

let initialized = false
let counter = 0

const RANKDIR: Record<Direction, string> = { TD: 'TB', LR: 'LR', BT: 'BT', RL: 'RL' }

interface Size { w: number; h: number }
interface Settings { direction: Direction; theme: Theme; look: Look; curveStyle: CurveStyle }

// Measure plain (text) nodes exactly using Mermaid's renderer.
async function mermaidNodeSizes(flowSyntax: string): Promise<Map<string, Size> | null> {
  if (typeof window === 'undefined' || !flowSyntax.trim()) return null
  try {
    if (!initialized) {
      mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' })
      initialized = true
    }
    const { svg } = await mermaid.render(`ml-size-${counter++}`, flowSyntax)
    const div = document.createElement('div')
    div.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden'
    div.innerHTML = svg
    document.body.appendChild(div)
    try {
      const map = new Map<string, Size>()
      div.querySelectorAll<SVGGElement>('g.node').forEach((g) => {
        const id = /^flowchart-(.+)-\d+$/.exec(g.id)?.[1]
        if (!id) return
        try { const bb = g.getBBox(); map.set(id, { w: bb.width, h: bb.height }) } catch { /* skip */ }
      })
      return map.size ? map : null
    } finally {
      document.body.removeChild(div)
    }
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dimOf(n: any): Size {
  const w = (typeof n.width === 'number' ? n.width : undefined) ?? (typeof n.style?.width === 'number' ? n.style.width : undefined)
  const h = (typeof n.height === 'number' ? n.height : undefined) ?? (typeof n.style?.height === 'number' ? n.style.height : undefined)
  return { w: w ?? 150, h: h ?? 54 }
}

// Real on-canvas size of a node, so Dagre reserves the right amount of room.
function realSize(n: Node<FlowNodeData>, measured?: Size): Size {
  const d = n.data
  if (d?.isTable) {
    const cols = Math.max(1, d.columns?.length ?? 1)
    const rows = d.rows?.length ?? 0
    return { w: Math.max(220, 16 + cols * 104 + 26), h: Math.max(120, 30 + 26 + rows * 26 + 26) }
  }
  if (d?.isEntity) {
    const fields = d.fields?.length ?? 0
    return { w: 220, h: 30 + fields * 26 + 24 }
  }
  if (d?.isNote) {
    const lines = (d.label ?? '').split('\n').length
    return { w: 210, h: Math.max(72, 18 + lines * 20) }
  }
  return measured ?? { w: 150, h: 54 }
}

function rectOverlap(a: { x: number; y: number } & Size, b: { x: number; y: number } & Size): number {
  const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return dx > 0 && dy > 0 ? dx * dy : 0
}

// Attached notes (children of a non-subgraph host) aren't part of the flow graph,
// so Dagre doesn't place them. Sit each at the host corner with the most open
// space (least overlap with other objects), touching by only a small overlap.
function placeAttachedNotes(
  positioned: Node<FlowNodeData>[],
  attached: Node<FlowNodeData>[],
  subgraphIds: Set<string>,
): Node<FlowNodeData>[] {
  if (attached.length === 0) return positioned
  const byId = new Map(positioned.map((n) => [n.id, n]))
  const absOf = (n: Node<FlowNodeData>) => {
    let x = n.position.x, y = n.position.y
    if (n.parentId) { const p = byId.get(n.parentId); if (p) { x += p.position.x; y += p.position.y } }
    const d = dimOf(n)
    return { x, y, w: d.w, h: d.h }
  }
  const boxes = positioned.filter((n) => !subgraphIds.has(n.id)).map((n) => ({ id: n.id, box: absOf(n) }))
  const TUCK = 14 // how far the sticky tucks onto the host edge

  const placed = attached.map((note) => {
    const host = note.parentId ? byId.get(note.parentId) : undefined
    if (!host) return note
    const hb = absOf(host)
    // Size the sticky from its content (readable) but keep it compact.
    const rs = realSize(note)
    const nw = Math.min(rs.w, 230), nh = Math.min(rs.h, 170)
    // Candidates hang the sticky off the host's bottom / top / left, anchored to
    // the host's left edge. We deliberately avoid the right edge: a host's
    // measured WIDTH is content-driven (esp. tables) and unknown here, so a
    // right-anchored tuck would land inside the host. Bottom/top/left only use
    // the host's x/y/height, which the layout sizes reliably.
    const cands: Record<string, { x: number; y: number }> = {
      below: { x: hb.x, y: hb.y + hb.h - TUCK },
      above: { x: hb.x, y: hb.y - nh + TUCK },
      left: { x: hb.x - nw + TUCK, y: hb.y },
    }
    let best = 'below', bestScore = Infinity
    for (const k of ['below', 'above', 'left']) {
      const c = cands[k]
      const nb = { x: c.x, y: c.y, w: nw, h: nh }
      let score = 0
      for (const { id, box } of boxes) {
        if (id === host.id || id === note.id) continue
        score += rectOverlap(nb, box)
      }
      if (score < bestScore - 1) { bestScore = score; best = k }
    }
    const c = cands[best]
    return {
      ...note,
      parentId: host.id,
      extent: undefined, // allow the sticky to overhang the host
      position: { x: c.x - hb.x, y: c.y - hb.y },
      width: nw,
      height: nh,
      style: { ...note.style, width: nw, height: nh },
    }
  })
  return [...positioned, ...placed] // hosts already precede their notes
}

// Lay out a graph: size-aware Dagre for structural nodes + corner-placed notes.
export async function autoArrange(
  nodes: Node<FlowNodeData>[],
  edges: Edge<FlowEdgeData>[],
  settings: Settings,
): Promise<Node<FlowNodeData>[]> {
  if (nodes.length === 0) return nodes

  const flow = extractMermaidBlocks(serializeDocument(nodes, edges, settings)).find((b) => /^\s*flowchart/.test(b))
  const measured = flow ? await mermaidNodeSizes(flow) : null

  const subgraphIds = new Set(nodes.filter((n) => n.data?.isSubgraph).map((n) => n.id))
  const isAttachedNote = (n: Node<FlowNodeData>) => !!(n.data?.isNote && n.parentId && !subgraphIds.has(n.parentId))
  const structural = nodes.filter((n) => !isAttachedNote(n))
  const attached = nodes.filter(isAttachedNote)

  const g = new dagre.graphlib.Graph({ compound: true })
  g.setGraph({ rankdir: RANKDIR[settings.direction], nodesep: 55, ranksep: 60, marginx: 12, marginy: 12 })
  g.setDefaultEdgeLabel(() => ({}))

  const sizes = new Map<string, Size>()
  for (const n of structural) {
    if (n.data?.isSubgraph) { g.setNode(n.id, { width: 0, height: 0, paddingX: 26, paddingY: 30 }); continue }
    const s = realSize(n, measured?.get(n.id))
    sizes.set(n.id, s)
    g.setNode(n.id, { width: s.w, height: s.h })
  }
  const ids = new Set(structural.map((n) => n.id))
  for (const n of structural) if (n.parentId && ids.has(n.parentId)) g.setParent(n.id, n.parentId)
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)

  try { dagre.layout(g) } catch { return nodes }

  const positioned: Node<FlowNodeData>[] = structural.map((n) => {
    const ln = g.node(n.id)
    if (!ln) return n
    if (n.data?.isSubgraph) {
      return {
        ...n,
        position: { x: ln.x - ln.width / 2, y: ln.y - ln.height / 2 },
        width: ln.width, height: ln.height,
        style: { ...n.style, width: ln.width, height: ln.height },
      }
    }
    const s = sizes.get(n.id) ?? { w: ln.width, h: ln.height }
    let pos = { x: ln.x - s.w / 2, y: ln.y - s.h / 2 }
    if (n.parentId) {
      const pl = g.node(n.parentId)
      if (pl) pos = { x: pos.x - (pl.x - pl.width / 2), y: pos.y - (pl.y - pl.height / 2) }
    }
    return { ...n, position: pos, width: s.w, height: s.h, style: { ...n.style, width: s.w, height: s.h } }
  })

  return placeAttachedNotes(positioned, attached, subgraphIds)
}
