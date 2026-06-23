import type { Edge, Node } from '@xyflow/react'
import type {
  CurveStyle,
  Direction,
  EdgeStyle,
  ErEnd,
  FlowEdgeData,
  FlowMarker,
  FlowNodeData,
  Look,
  NodeShape,
  Theme,
} from './store'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_')
}

function escapeLabel(label: string): string {
  // Quotes break Mermaid's "..." label syntax; newlines become <br/> so that
  // multi-paragraph notes survive as clean, single-line Mermaid text.
  return label
    .replace(/"/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br/>')
}

const SHAPE_TEMPLATES: Record<NodeShape, [string, string]> = {
  'rounded': ['("', '")'],
  'stadium': ['(["', '"])'],
  'subroutine': ['[["', '"]]'],
  'cylinder': ['[("', '")]'],
  'circle': ['(("', '"))'],
  'double-circle': ['((("', '")))'],
  'diamond': ['{"', '"}'],
  'hexagon': ['{{"', '"}}'],
  'parallelogram': ['[/"', '"/]'],
  'parallelogram-alt': ['[\\"', '"\\]'],
  'trapezoid': ['[/"', '"\\]'],
  'trapezoid-alt': ['[\\"', '"/]'],
  'asymmetric': ['>"', '"]'],
  'rectangle': ['["', '"]'],
}

/** Wrap a label in the correct Mermaid shape syntax for all 14 shapes */
function shapeWrap(id: string, label: string, shape: NodeShape): string {
  const sid = sanitizeId(id)
  const lbl = escapeLabel(label)
  const [open, close] = SHAPE_TEMPLATES[shape] ?? SHAPE_TEMPLATES['rectangle']

  return `${sid}${open}${lbl}${close}`
}

// A note's first line is its title (used for the flowchart node + body heading);
// the rest is full Markdown that lives in the .md body.
function noteTitle(label: string): string {
  const first = (label || '').split(/\r?\n/)[0].trim()
  return first || 'Note'
}
function noteBody(label: string): string {
  return (label || '').split(/\r?\n/).slice(1).join('\n').trim()
}

/**
 * Declare a node line. Tables and notes are emitted as reference nodes whose
 * real content lives in the .md body, so the flowchart node "points to" it.
 */
function declareNode(node: Node<FlowNodeData>): string {
  const sid = sanitizeId(node.id)
  const label = node.data.label || node.id
  if (node.data.isTable) {
    return `${sid}[["${escapeLabel(label)}"]]`
  }
  if (node.data.isNote) {
    return `${sid}>"${escapeLabel(noteTitle(node.data.label))}"]`
  }
  return shapeWrap(node.id, label, (node.data.shape ?? 'rectangle') as NodeShape)
}

// Mermaid head characters per end. Start uses '<' for an arrow; end uses '>'.
const HEAD_START: Record<FlowMarker, string> = { none: '', arrow: '<', circle: 'o', cross: 'x' }
const HEAD_END: Record<FlowMarker, string> = { none: '', arrow: '>', circle: 'o', cross: 'x' }

/** Build a Mermaid flowchart link from line style + independent end markers. */
function flowConnector(edgeStyle: EdgeStyle, start: FlowMarker, end: FlowMarker): string {
  const s = HEAD_START[start]
  const e = HEAD_END[end]
  const body = edgeStyle === 'dashed' ? '-.-' : edgeStyle === 'thick' ? '==' : '--'
  if (!s && !e) {
    // Open link (no heads) needs its canonical full form.
    return edgeStyle === 'dashed' ? '-.-' : edgeStyle === 'thick' ? '===' : '---'
  }
  return `${s}${body}${e}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SerializeOptions {
  direction?: Direction
  theme?: Theme
  look?: Look
  curveStyle?: CurveStyle
}

export function serialize(
  nodes: Node<FlowNodeData>[],
  edges: Edge<FlowEdgeData>[],
  options: SerializeOptions = {}
): string {
  const { direction = 'TD', theme = 'default', look = 'classic', curveStyle = 'basis' } = options

  if (nodes.length === 0) {
    return `flowchart TD\n  %% Add nodes to get started`
  }

  const lines: string[] = []

  // ── Frontmatter for non-default settings ──────────────────────────────────
  const initConfig: Record<string, unknown> = {}
  if (theme !== 'default') initConfig.theme = theme
  if (look !== 'classic') initConfig.look = look
  if (curveStyle !== 'basis') initConfig.flowchart = { curve: curveStyle }

  if (Object.keys(initConfig).length > 0) {
    lines.push(`%%{ init: ${JSON.stringify(initConfig)} }%%`)
  }

  // ── Graph header ──────────────────────────────────────────────────────────
  lines.push(`flowchart ${direction}`)

  // ── Separate node categories ──────────────────────────────────────────────
  const subgraphNodes = nodes.filter((n) => n.data.isSubgraph)
  const sgIds = new Set(subgraphNodes.map((n) => n.id))
  // A note attached to a regular node is an addendum rendered in the body — NOT
  // its own flowchart node — so it is excluded from declarations here.
  const isAttachedNote = (n: Node<FlowNodeData>) =>
    !!n.data.isNote && !!n.parentId && !sgIds.has(n.parentId)
  const childNodes = nodes.filter((n) => !n.data.isSubgraph && n.parentId && sgIds.has(n.parentId))
  const standaloneNodes = nodes.filter(
    (n) => !n.data.isSubgraph && !isAttachedNote(n) && (!n.parentId || !sgIds.has(n.parentId)),
  )

  // ── Standalone node declarations ──────────────────────────────────────────
  for (const node of standaloneNodes) {
    lines.push(`  ${declareNode(node)}`)
  }

  // ── Subgraph blocks ───────────────────────────────────────────────────────
  for (const sg of subgraphNodes) {
    const sgId = sanitizeId(sg.id)
    const sgLabel = escapeLabel(sg.data.label || sg.id)
    lines.push(`  subgraph ${sgId} ["${sgLabel}"]`)
    const children = childNodes.filter((c) => c.parentId === sg.id)
    for (const child of children) {
      lines.push(`    ${declareNode(child)}`)
    }
    lines.push(`  end`)
  }

  // ── Node styles (only for custom-coloured nodes) ──────────────────────────
  for (const node of nodes.filter((n) => !n.data.isSubgraph)) {
    const parts: string[] = []
    if (node.data.fillColor) parts.push(`fill:${node.data.fillColor}`)
    if (node.data.strokeColor) parts.push(`stroke:${node.data.strokeColor}`)
    if (node.data.textColor) parts.push(`color:${node.data.textColor}`)
    if (parts.length > 0) {
      lines.push(`  style ${sanitizeId(node.id)} ${parts.join(',')}`)
    }
  }

  // ── Edge declarations ─────────────────────────────────────────────────────
  for (const edge of edges) {
    let src = sanitizeId(edge.source)
    let tgt = sanitizeId(edge.target)
    const label = typeof edge.label === 'string' ? edge.label : undefined
    const edgeStyle = (edge.data?.edgeStyle as EdgeStyle) ?? 'solid'
    let start = (edge.data?.startMarker as FlowMarker) ?? 'none'
    let end = (edge.data?.endMarker as FlowMarker) ?? 'arrow'

    // Mermaid can't encode a start-only marker on `--`/`==` links (e.g. `o--`).
    // Emit it as an end marker on the reversed edge — same rendered diagram.
    if (start !== 'none' && end === 'none') {
      ;[src, tgt] = [tgt, src]
      end = start
      start = 'none'
    }

    const connector = flowConnector(edgeStyle, start, end)
    if (label?.trim()) {
      lines.push(`  ${src} ${connector}|"${escapeLabel(label)}"| ${tgt}`)
    } else {
      lines.push(`  ${src} ${connector} ${tgt}`)
    }
  }

  // ── Edge custom colours (linkStyle by index) ──────────────────────────────
  edges.forEach((edge, i) => {
    const strokeColor = edge.data?.strokeColor as string | undefined
    if (strokeColor) {
      lines.push(`  linkStyle ${i} stroke:${strokeColor}`)
    }
  })

  return lines.join('\n')
}

// ─── ERD serialization ──────────────────────────────────────────────────────

// Crow's-foot symbols per end. Left attaches to the source entity, right to target.
const ER_LEFT: Record<ErEnd, string> = { one: '||', 'zero-one': '|o', 'zero-many': '}o', 'one-many': '}|' }
const ER_RIGHT: Record<ErEnd, string> = { one: '||', 'zero-one': 'o|', 'zero-many': 'o{', 'one-many': '|{' }

/** Sanitize to a valid Mermaid ER identifier (alphanumeric/underscore). */
function erIdent(raw: string, fallback: string): string {
  const s = (raw || '').trim().replace(/[^a-zA-Z0-9_]/g, '_')
  if (!s) return fallback
  return /^[a-zA-Z_]/.test(s) ? s : `e_${s}`
}

/** Serialize entity nodes + relationship edges into an `erDiagram` block. */
export function serializeErd(
  entities: Node<FlowNodeData>[],
  edges: Edge<FlowEdgeData>[],
): string {
  const lines: string[] = ['erDiagram']

  // Map node id → unique entity name (suffix duplicates to keep them distinct).
  const nameById = new Map<string, string>()
  const used = new Set<string>()
  for (const ent of entities) {
    const name = erIdent(ent.data.label, ent.id)
    let n = name
    let i = 2
    while (used.has(n)) n = `${name}_${i++}`
    used.add(n)
    nameById.set(ent.id, n)
  }

  for (const ent of entities) {
    const name = nameById.get(ent.id)!
    const fields = ent.data.fields ?? []
    if (fields.length === 0) {
      lines.push(`  ${name}`)
      continue
    }
    lines.push(`  ${name} {`)
    for (const f of fields) {
      const type = erIdent(f.type, 'string')
      const fname = erIdent(f.name, 'field')
      const key = f.key ? ` ${f.key}` : ''
      lines.push(`    ${type} ${fname}${key}`)
    }
    lines.push(`  }`)
  }

  const byId = new Map(entities.map((n) => [n.id, n]))
  const fieldName = (node: Node<FlowNodeData> | undefined, handle?: string | null): string | null => {
    if (!node || !handle) return null
    const m = /^f-(\d+)-/.exec(handle)
    if (!m) return null
    return node.data.fields?.[+m[1]]?.name ?? null
  }

  for (const e of edges) {
    const a = nameById.get(e.source)
    const b = nameById.get(e.target)
    if (!a || !b) continue
    const erStart = (e.data?.erStart as ErEnd) ?? 'one'
    const erEnd = (e.data?.erEnd as ErEnd) ?? 'zero-many'
    const link = (e.data?.edgeStyle as EdgeStyle) === 'dashed' ? '..' : '--'
    const card = `${ER_LEFT[erStart]}${link}${ER_RIGHT[erEnd]}`
    const raw = typeof e.label === 'string' ? e.label.trim() : ''
    // When the relationship is unlabeled but drawn field→field, encode the
    // PK→FK linkage into the label so it survives in the Mermaid text.
    let label = raw
    if (!label) {
      const src = fieldName(byId.get(e.source), e.sourceHandle)
      const tgt = fieldName(byId.get(e.target), e.targetHandle)
      label = src && tgt ? `${src} → ${tgt}` : 'relates'
    }
    lines.push(`  ${a} ${card} ${b} : "${label.replace(/"/g, "'")}"`)
  }

  return lines.join('\n')
}

// ─── Markdown data-table serialization ───────────────────────────────────────

/** Serialize a data-table node into a GitHub-flavored Markdown table. */
export function serializeTable(node: Node<FlowNodeData>): string {
  const cols = node.data.columns ?? []
  const rows = node.data.rows ?? []
  const title = (node.data.label || 'Table').trim()
  if (cols.length === 0) return `**${title}**\n\n_(empty table)_`

  const cell = (s: string) => (s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
  const header = `| ${cols.map(cell).join(' | ')} |`
  const sep = `| ${cols.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${cols.map((_, c) => cell(r[c] ?? '')).join(' | ')} |`)

  // Heading matches the flowchart reference node's label so the node points here.
  return [`### ${title}`, '', header, sep, ...body].join('\n')
}

// ─── Multi-block document (the agent-digestible .md artifact) ─────────────────

/**
 * Serialize the whole canvas into a Markdown document. Flow nodes/notes/groups
 * become a `flowchart` block; entity tables + their relationships become an
 * `erDiagram` block. Each is a separate fenced ```mermaid block in one file so
 * it pastes straight into Markdown and renders on GitHub etc.
 */
export function serializeDocument(
  nodes: Node<FlowNodeData>[],
  edges: Edge<FlowEdgeData>[],
  options: SerializeOptions = {},
): string {
  const entityNodes = nodes.filter((n) => n.data.isEntity)
  const tableNodes = nodes.filter((n) => n.data.isTable)
  // The flowchart contains everything except ER entities — including TABLE nodes,
  // which appear as reference nodes so they integrate and connect like any node.
  const flowchartNodes = nodes.filter((n) => !n.data.isEntity)
  const entityIds = new Set(entityNodes.map((n) => n.id))

  // ER block: edges where BOTH ends are entities. Flow block: every other edge
  // (including edges to/from table nodes, which are now first-class flow nodes).
  const erEdges = edges.filter((e) => entityIds.has(e.source) && entityIds.has(e.target))
  const flowEdges = edges.filter((e) => !entityIds.has(e.source) && !entityIds.has(e.target))

  const blocks: string[] = []
  if (flowchartNodes.length > 0) {
    blocks.push('```mermaid\n' + serialize(flowchartNodes, flowEdges, options) + '\n```')
  }
  if (entityNodes.length > 0) {
    blocks.push('```mermaid\n' + serializeErd(entityNodes, erEdges) + '\n```')
  }
  // Each table's rows live in the body, under a heading the flow node points to.
  for (const t of tableNodes) {
    blocks.push(serializeTable(t))
  }
  // Notes. A FREE note is its own flowchart node with its content in the body
  // (first line = title). A note ATTACHED to a node is an addendum/footnote —
  // its Markdown is rendered in the body under that host node, not as a node.
  const allNotes = nodes.filter((n) => n.data.isNote)
  const parentOf = (n: Node<FlowNodeData>) =>
    n.parentId ? nodes.find((m) => m.id === n.parentId) : undefined
  const attachedNotes = allNotes.filter((n) => {
    const p = parentOf(n)
    return p && !p.data.isSubgraph
  })
  const attachedSet = new Set(attachedNotes.map((n) => n.id))

  for (const n of allNotes) {
    if (attachedSet.has(n.id)) continue
    blocks.push(`### ${noteTitle(n.data.label)}\n\n${noteBody(n.data.label) || '_(empty note)_'}`)
  }
  // Group addenda under each host node's label.
  const byHost = new Map<string, string[]>()
  for (const n of attachedNotes) {
    const host = parentOf(n)!
    const key = (host.data.label || host.id).trim()
    if (!byHost.has(key)) byHost.set(key, [])
    byHost.get(key)!.push((n.data.label || '').trim() || '_(empty note)_')
  }
  for (const [hostLabel, texts] of byHost) {
    blocks.push(`### ${hostLabel} — notes\n\n${texts.join('\n\n')}`)
  }
  if (blocks.length === 0) {
    blocks.push('```mermaid\n' + serialize([], [], options) + '\n```')
  }
  return blocks.join('\n\n')
}

/** Extract the raw Mermaid code from each fenced block of a document. */
export function extractMermaidBlocks(doc: string): string[] {
  const re = /```mermaid\n([\s\S]*?)```/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) out.push(m[1].trim())
  if (out.length > 0) return out
  // No fences: only treat the whole text as Mermaid if it actually looks like a
  // diagram — otherwise (e.g. a doc containing only Markdown tables) return none
  // so the preview doesn't try to render Markdown as a diagram.
  const t = doc.trim()
  if (/^(flowchart|graph|erDiagram|sequenceDiagram|classDiagram|stateDiagram|gantt|pie|mindmap)\b/.test(t)) {
    return [t]
  }
  return []
}
