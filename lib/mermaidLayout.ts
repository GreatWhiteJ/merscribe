import mermaid from 'mermaid'
import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import type { CurveStyle, Direction, FlowEdgeData, FlowNodeData, Look, Theme } from './store'
import { serializeDocument, extractMermaidBlocks } from './serializer'
import { erNodeIds } from './blocks'

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
    // Grow with content (longest line → width, wrapped lines → height) but
    // stay within sane bounds so a long note doesn't take over the canvas.
    const lines = (d.label ?? '').split('\n')
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 1)
    const w = Math.min(280, Math.max(180, longest * 7 + 28))
    const perLine = Math.max(12, Math.floor((w - 24) / 7))
    const rows = lines.reduce((a, l) => a + Math.max(1, Math.ceil(l.length / perLine)), 0)
    const h = Math.min(210, Math.max(64, 16 + rows * 20))
    return { w, h }
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
    // Size the sticky from its content (already bounded by realSize).
    const rs = realSize(note)
    const nw = rs.w, nh = rs.h
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
      position: { x: c.x - hb.x, y: c.y - hb.y }, // rough; Canvas refines vs measured sizes
      width: nw,
      height: undefined, // content-driven height (measured by the canvas)
      style: { ...note.style, width: nw, height: undefined },
      data: { ...note.data, autoPlaced: true },
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

  // Lay out one disconnected group (flowchart OR ER) on its own, so the two
  // blocks don't inflate each other's spacing. Returns the positioned nodes and
  // the group's overall height (for stacking). `dense` tightens the ER block.
  const layoutGroup = (group: Node<FlowNodeData>[], dense: boolean, cluster?: Map<string, string>): { positioned: Node<FlowNodeData>[]; height: number } => {
    if (group.length === 0) return { positioned: [], height: 0 }
    const g = new dagre.graphlib.Graph({ compound: true })
    g.setGraph({
      rankdir: RANKDIR[settings.direction],
      nodesep: dense ? 36 : 55,
      ranksep: dense ? 64 : 60,
      marginx: 12,
      marginy: 12,
      ranker: 'network-simplex',
    })
    g.setDefaultEdgeLabel(() => ({}))

    const ids = new Set(group.map((n) => n.id))
    // Synthetic compound parents keep clustered nodes (e.g. ER entities mapped to
    // the overview's domains) together; they aren't rendered, just layout hints.
    if (cluster) for (const c of new Set(cluster.values())) g.setNode(c, {})
    const sizes = new Map<string, Size>()
    for (const n of group) {
      if (n.data?.isSubgraph) { g.setNode(n.id, { width: 0, height: 0, paddingX: 26, paddingY: 30 }); continue }
      const s = realSize(n, measured?.get(n.id))
      sizes.set(n.id, s)
      g.setNode(n.id, { width: s.w, height: s.h })
    }
    for (const n of group) {
      if (n.parentId && ids.has(n.parentId)) g.setParent(n.id, n.parentId)
      else if (cluster?.has(n.id)) g.setParent(n.id, cluster.get(n.id)!)
    }
    for (const e of edges) if (ids.has(e.source) && ids.has(e.target) && g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)

    try { dagre.layout(g) } catch { return { positioned: group, height: 0 } }

    let height = 0
    const positioned = group.map((n) => {
      const ln = g.node(n.id)
      if (!ln) return n
      if (n.data?.isSubgraph) {
        height = Math.max(height, ln.y + ln.height / 2)
        return {
          ...n,
          position: { x: ln.x - ln.width / 2, y: ln.y - ln.height / 2 },
          width: ln.width, height: ln.height,
          style: { ...n.style, width: ln.width, height: ln.height },
        }
      }
      const s = sizes.get(n.id) ?? { w: ln.width, h: ln.height }
      let pos = { x: ln.x - s.w / 2, y: ln.y - s.h / 2 }
      height = Math.max(height, pos.y + s.h)
      if (n.parentId) {
        const pl = g.node(n.parentId)
        if (pl) pos = { x: pos.x - (pl.x - pl.width / 2), y: pos.y - (pl.y - pl.height / 2) }
      }
      if (n.data?.isNote) {
        // Notes set width only; height fits the content (measured by the canvas).
        return { ...n, position: pos, width: s.w, height: undefined, style: { ...n.style, width: s.w, height: undefined } }
      }
      return { ...n, position: pos, width: s.w, height: s.h, style: { ...n.style, width: s.w, height: s.h } }
    })
    return { positioned, height }
  }

  // Cluster ER entities by the overview's domains: a grouped flow node's label
  // (e.g. "Geographies") maps the entity of the same name into that subgraph's
  // cluster, so the ER block groups the way the flowchart overview does.
  const labelToGroup = new Map<string, string>()
  for (const n of structural) {
    if (!n.data?.isSubgraph && n.parentId && subgraphIds.has(n.parentId)) {
      const lbl = (n.data?.label ?? '').trim().toLowerCase()
      if (lbl) labelToGroup.set(lbl, n.parentId)
    }
  }
  const erCluster = new Map<string, string>()
  for (const n of structural) {
    if (!n.data?.isEntity) continue
    const grp = labelToGroup.get((n.data?.label ?? '').trim().toLowerCase())
    if (grp) erCluster.set(n.id, `cl_${grp}`)
  }

  const erIds = erNodeIds(nodes)
  const flowRes = layoutGroup(structural.filter((n) => !erIds.has(n.id)), false)
  const erRes = layoutGroup(structural.filter((n) => erIds.has(n.id)), true, erCluster.size ? erCluster : undefined)
  // Stack the ER block below the flowchart so the combined view reads as two
  // zones (the block switcher shows them one at a time).
  const offset = flowRes.height > 0 && erRes.positioned.length > 0 ? flowRes.height + 100 : 0
  const erShifted = offset
    ? erRes.positioned.map((n) => ({ ...n, position: { x: n.position.x, y: n.position.y + offset } }))
    : erRes.positioned

  return placeAttachedNotes([...flowRes.positioned, ...erShifted], attached, subgraphIds)
}
