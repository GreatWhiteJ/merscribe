import mermaid from 'mermaid'
import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import { entityFitHeight, type CurveStyle, type Direction, type FlowEdgeData, type FlowNodeData, type Look, type Theme } from './store'
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

// Widest an auto-fitted note gets before its text wraps: a readable column, not
// the whole canvas. Hand-resized notes ignore this entirely.
const NOTE_MAX_AUTO_W = 420

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
    return { w: 220, h: entityFitHeight(fields) }
  }
  if (d?.isNote) {
    // A note the user sized by hand keeps exactly that size: auto-arrange
    // re-positions it but never re-fits it, so a note dragged out to hold a
    // whole document doesn't collapse back into a sticky.
    if (d.userSized) return dimOf(n)
    // Otherwise grow with the content. The width settles into a readable column
    // and the height fits every wrapped line, uncapped: a long note is a long
    // note, and scrolling a tiny box to read it is worse than a tall one.
    const lines = (d.label ?? '').split('\n')
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 1)
    const w = Math.min(NOTE_MAX_AUTO_W, Math.max(200, longest * 7 + 28))
    const perLine = Math.max(12, Math.floor((w - 24) / 7))
    const rows = lines.reduce((a, l) => a + Math.max(1, Math.ceil(l.length / perLine)), 0)
    const h = Math.max(64, 16 + rows * 20)
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

// ── Keep lines out of groups they don't belong to ─────────────────────────────
// Edges are drawn as plain curves between handles. Dagre places groups as
// clusters but knows nothing about those curves, so a long edge (a "no" that
// skips a whole module) can run straight across a group it has nothing to do
// with. After layout, treat every top-level group as a solid object: if an
// edge's curve would pass through a group that holds neither of its ends, slide
// the group (contents and all) sideways until the curve clears it, pushing any
// top-level object it would then overlap further along. Positions only — the
// lines themselves are unchanged.
type Rect = { x1: number; y1: number; x2: number; y2: number }
const CLEAR = 18

// React Flow's default bezier (getBezierPath, curvature 0.25), sampled.
function bezierSamples(sx: number, sy: number, sSide: string, tx: number, ty: number, tSide: string, n = 32) {
  const off = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d))
  const ctl = (side: string, x1: number, y1: number, x2: number, y2: number): [number, number] =>
    side === 'left' ? [x1 - off(x1 - x2), y1] : side === 'right' ? [x1 + off(x2 - x1), y1]
      : side === 'top' ? [x1, y1 - off(y1 - y2)] : [x1, y1 + off(y2 - y1)]
  const [c1x, c1y] = ctl(sSide, sx, sy, tx, ty)
  const [c2x, c2y] = ctl(tSide, tx, ty, sx, sy)
  const out: { x: number; y: number }[] = []
  for (let i = 1; i < n; i++) {
    const t = i / n, u = 1 - t
    out.push({
      x: u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tx,
      y: u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ty,
    })
  }
  return out
}

function clearGroupCrossings(nodes: Node<FlowNodeData>[], edges: Edge<FlowEdgeData>[]): Node<FlowNodeData>[] {
  let ns = nodes.map((n) => ({ ...n, position: { ...n.position } }))
  const byId = () => new Map(ns.map((n) => [n.id, n]))
  const sizeOf = (n: Node<FlowNodeData>) => ({ w: n.width ?? (Number(n.style?.width) || 0), h: n.height ?? (Number(n.style?.height) || 0) })
  const absRect = (id: string, m: Map<string, Node<FlowNodeData>>): Rect | null => {
    let n = m.get(id)
    if (!n) return null
    const { w, h } = sizeOf(n)
    let x = n.position.x, y = n.position.y
    const seen = new Set([n.id])
    while (n?.parentId && !seen.has(n.parentId)) {
      seen.add(n.parentId)
      n = m.get(n.parentId)
      if (n) { x += n.position.x; y += n.position.y }
    }
    return { x1: x, y1: y, x2: x + w, y2: y + h }
  }
  const within = (id: string, groupId: string, m: Map<string, Node<FlowNodeData>>) => {
    let n = m.get(id)
    const seen = new Set<string>()
    while (n && !seen.has(n.id)) { if (n.id === groupId) return true; seen.add(n.id); n = n.parentId ? m.get(n.parentId) : undefined }
    return false
  }
  const side = (h: string | null | undefined, fallback: string) => (h?.split('-')[0] ?? fallback)
  const anchor = (r: Rect, s: string) =>
    s === 'top' ? { x: (r.x1 + r.x2) / 2, y: r.y1 } : s === 'bottom' ? { x: (r.x1 + r.x2) / 2, y: r.y2 }
      : s === 'left' ? { x: r.x1, y: (r.y1 + r.y2) / 2 } : { x: r.x2, y: (r.y1 + r.y2) / 2 }

  for (let iter = 0; iter < 40; iter++) {
    const m = byId()
    const groups = ns.filter((n) => n.data?.isSubgraph && !n.parentId)
    let fix: { g: Node<FlowNodeData>; dx: number } | null = null
    for (const e of edges) {
      const sr = absRect(e.source, m), tr = absRect(e.target, m)
      if (!sr || !tr || m.get(e.source)?.data?.isEntity) continue
      const sS = side(e.sourceHandle, 'bottom'), tS = side(e.targetHandle, 'top')
      const a = anchor(sr, sS), b = anchor(tr, tS)
      const pts = bezierSamples(a.x, a.y, sS, b.x, b.y, tS)
      for (const g of groups) {
        if (within(e.source, g.id, m) || within(e.target, g.id, m)) continue
        const r = absRect(g.id, m)!
        const hit = pts.filter((p) => p.x > r.x1 - CLEAR && p.x < r.x2 + CLEAR && p.y > r.y1 - CLEAR && p.y < r.y2 + CLEAR)
        if (!hit.length) continue
        const minX = Math.min(...hit.map((p) => p.x)), maxX = Math.max(...hit.map((p) => p.x))
        const right = maxX + CLEAR - r.x1, left = minX - CLEAR - r.x2
        fix = { g, dx: Math.abs(right) <= Math.abs(left) ? right : left }
        break
      }
      if (fix) break
    }
    if (!fix) break
    // Slide the group, then push top-level objects it now overlaps, in order.
    const moved = new Set<string>([fix.g.id])
    fix.g.position.x += fix.dx
    const dir = Math.sign(fix.dx)
    const queue = [fix.g.id]
    while (queue.length) {
      const id = queue.shift()!
      const m2 = byId()
      const r = absRect(id, m2)!
      for (const o of ns) {
        if (o.parentId || moved.has(o.id) || o.id === id) continue
        const q = absRect(o.id, m2)
        if (!q || q.y2 + CLEAR <= r.y1 || q.y1 >= r.y2 + CLEAR) continue
        const overlap = dir > 0 ? r.x2 + CLEAR - q.x1 : q.x2 + CLEAR - r.x1
        const ahead = dir > 0 ? q.x1 >= r.x1 : q.x2 <= r.x2
        if (overlap > 0 && ahead) { o.position.x += dir * overlap; moved.add(o.id); queue.push(o.id) }
      }
    }
    ns = [...ns]
  }
  return ns
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
  const layoutGroup = (group: Node<FlowNodeData>[], dense: boolean, cluster?: Map<string, string>, rankdir?: string): { positioned: Node<FlowNodeData>[]; height: number } => {
    if (group.length === 0) return { positioned: [], height: 0 }
    const g = new dagre.graphlib.Graph({ compound: true })
    g.setGraph({
      rankdir: rankdir ?? RANKDIR[settings.direction],
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
    // Dagre can't rank a cluster, so an edge touching a subgraph (`a --> grp`,
    // `grp --> b`) can't go in as-is (it used to crash the layout). Dropping it
    // left group-to-group flows unconstrained: the groups floated side by side.
    // Do what Mermaid does instead: stand in the group's entry nodes for an edge
    // into it and its exit nodes for an edge out of it, descending into nested
    // groups, so the chain ranks top to bottom like the Mermaid preview.
    const clusters = new Set(group.filter((n) => n.data?.isSubgraph).map((n) => n.id))
    const kidsOf = new Map<string, string[]>()
    for (const n of group) {
      if (!n.parentId || !clusters.has(n.parentId) || n.data?.isNote) continue
      const list = kidsOf.get(n.parentId) ?? []
      list.push(n.id)
      kidsOf.set(n.parentId, list)
    }
    const ends = (id: string, side: 'in' | 'out', seen = new Set<string>()): string[] => {
      if (!clusters.has(id)) return g.hasNode(id) ? [id] : []
      if (seen.has(id)) return []
      seen.add(id)
      const kids = kidsOf.get(id) ?? []
      const sib = new Set(kids)
      // entry = no incoming edge from a sibling; exit = no outgoing edge to one
      const pick = kids.filter((k) => !edges.some((e) =>
        side === 'in' ? e.target === k && sib.has(e.source) : e.source === k && sib.has(e.target)))
      return (pick.length ? pick : kids.slice(0, 1)).flatMap((k) => ends(k, side, seen))
    }
    for (const e of edges) {
      if (!ids.has(e.source) || !ids.has(e.target)) continue
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
      if (!clusters.has(e.source) && !clusters.has(e.target)) {
        g.setEdge(e.source, e.target)
        continue
      }
      for (const s of ends(e.source, 'out'))
        for (const t of ends(e.target, 'in')) if (s !== t) g.setEdge(s, t)
    }

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
      if (n.data?.isNote && !n.data?.userSized) {
        // Auto-fitted notes set width only; height fits the content (measured by
        // the canvas). Hand-sized notes fall through and keep their exact box.
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
  // ER entities lay out left-to-right so related entities sit side by side and
  // their field-level relationships attach on the facing sides (not stacked).
  const erRes = layoutGroup(structural.filter((n) => erIds.has(n.id)), true, erCluster.size ? erCluster : undefined, 'LR')
  // Stack the ER block below the flowchart so the combined view reads as two
  // zones (the block switcher shows them one at a time).
  const offset = flowRes.height > 0 && erRes.positioned.length > 0 ? flowRes.height + 100 : 0
  const erShifted = offset
    ? erRes.positioned.map((n) => ({ ...n, position: { x: n.position.x, y: n.position.y + offset } }))
    : erRes.positioned

  const flowClear = clearGroupCrossings(flowRes.positioned, edges)

  return placeAttachedNotes([...flowClear, ...erShifted], attached, subgraphIds)
}
