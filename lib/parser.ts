import type { Edge, Node } from '@xyflow/react'
import type {
  CurveStyle,
  Direction,
  EdgeStyle,
  EntityField,
  EntityKey,
  ErEnd,
  FlowEdgeData,
  FlowMarker,
  FlowNodeData,
  Look,
  NodeShape,
  Theme,
} from './store'
import { applyDagreLayout } from './layout'

// ─── Public result type ───────────────────────────────────────────────────────

export interface ParseResult {
  nodes: Node<FlowNodeData>[]
  edges: Edge<FlowEdgeData>[]
  direction: Direction
  theme: Theme
  look: Look
  curveStyle: CurveStyle
  error: string | null
}

// ─── Node shape detection ─────────────────────────────────────────────────────
// Parses a node suffix like [label], (label), {label}, etc.
// Supports both quoted ("label") and unquoted (label) forms.

function parseNodeSuffix(suffix: string): { shape: NodeShape; label: string } | null {
  let m: RegExpMatchArray | null

  // double-circle: ((("label"))) or (((label)))
  m = suffix.match(/^\({3}"?([^"()]*)"?\){3}$/)
  if (m) return { shape: 'double-circle', label: m[1] }

  // stadium: (["label"]) or ([label])
  m = suffix.match(/^\(\["?([^"\]]*)"?\]\)$/)
  if (m) return { shape: 'stadium', label: m[1] }

  // circle: (("label")) or ((label))
  m = suffix.match(/^\({2}"?([^"()]*)"?\){2}$/)
  if (m) return { shape: 'circle', label: m[1] }

  // rounded: ("label") or (label)
  m = suffix.match(/^\("?([^"()]*)"?\)$/)
  if (m) return { shape: 'rounded', label: m[1] }

  // subroutine: [["label"]] or [[label]]
  m = suffix.match(/^\[\["?([^"\]]*)"?\]\]$/)
  if (m) return { shape: 'subroutine', label: m[1] }

  // cylinder: [("label")] or [(label)]
  m = suffix.match(/^\[\("?([^"()]*)"?\)\]$/)
  if (m) return { shape: 'cylinder', label: m[1] }

  // hexagon: {{"label"}} or {{label}}
  m = suffix.match(/^\{\{"?([^"{}]*)"?\}\}$/)
  if (m) return { shape: 'hexagon', label: m[1] }

  // diamond: {"label"} or {label}
  m = suffix.match(/^\{"?([^"{}]*)"?\}$/)
  if (m) return { shape: 'diamond', label: m[1] }

  // parallelogram: [/"label"/] or [/label/]
  if (suffix.startsWith('[/"') || suffix.startsWith('[/')) {
    m = suffix.match(/^\[\/"?([^"]*)"?\/\]$/)
    if (m) return { shape: 'parallelogram', label: m[1] }
  }

  // trapezoid: [/"label"\] or [/label\]
  if (suffix.startsWith('[/') && suffix.endsWith('\\]')) {
    m = suffix.match(/^\[\/"?([^"]*)"?\\\]$/)
    if (m) return { shape: 'trapezoid', label: m[1] }
  }

  // parallelogram-alt: [\"label"\] or [\label\]
  if (suffix.startsWith('[\\') && suffix.endsWith('\\]')) {
    m = suffix.match(/^\[\\"?([^"]*)"?\\\]$/)
    if (m) return { shape: 'parallelogram-alt', label: m[1] }
  }

  // trapezoid-alt: [\"label"/] or [\label/]
  if (suffix.startsWith('[\\') && suffix.endsWith('/]')) {
    m = suffix.match(/^\[\\"?([^"]*)"?\/\]$/)
    if (m) return { shape: 'trapezoid-alt', label: m[1] }
  }

  // asymmetric: >"label"] or >label]
  m = suffix.match(/^>"?([^"\]]*)"?\]$/)
  if (m) return { shape: 'asymmetric', label: m[1] }

  // rectangle: ["label"] or [label]
  m = suffix.match(/^\["?([^"\]]*)"?\]$/)
  if (m) return { shape: 'rectangle', label: m[1] }

  return null
}

// ─── Extract a node reference from the start of a string ─────────────────────
// Returns the node ID, its shape/label, and the remaining string after the node.
// Handles: ID[label], ID(label), ID{label}, ID((label)), ID>label], etc.
// Also handles bare IDs like: ID

interface NodeRef {
  id: string
  label: string
  shape: NodeShape
  rest: string
  // True when this ref carried an explicit shape/label declaration (e.g.
  // `A["Start"]`) rather than a bare edge reference (e.g. `A` in `A --> B`).
  explicit: boolean
}

function extractNodeRef(str: string): NodeRef | null {
  str = str.trim()

  // Match the node ID (word characters)
  const idMatch = str.match(/^(\w+)/)
  if (!idMatch) return null

  const id = idMatch[1]
  const after = str.slice(id.length)

  // If there's no shape suffix, it's a bare ID
  if (!after || /^\s/.test(after[0])) {
    return { id, label: id, shape: 'rectangle', rest: after, explicit: false }
  }

  // Try to find the matching closing bracket for the shape
  const shapeStr = extractBalancedShape(after)
  if (shapeStr) {
    const parsed = parseNodeSuffix(shapeStr)
    if (parsed) {
      return {
        id,
        label: parsed.label,
        shape: parsed.shape,
        rest: after.slice(shapeStr.length),
        explicit: true,
      }
    }
  }

  // If we can't parse the shape, treat as bare ID
  return { id, label: id, shape: 'rectangle', rest: after, explicit: false }
}

// Extract a balanced bracket expression from the start of a string.
// Handles nested brackets like (([label])), {label}, etc.
function extractBalancedShape(str: string): string | null {
  if (!str) return null

  const open = str[0]
  let closeChar: string
  if (open === '[') closeChar = ']'
  else if (open === '(') closeChar = ')'
  else if (open === '{') closeChar = '}'
  else if (open === '>') closeChar = ']'
  else return null

  // For '>' asymmetric shape, just find the closing ']'
  if (open === '>') {
    const closeIdx = str.indexOf(']')
    if (closeIdx < 0) return null
    return str.slice(0, closeIdx + 1)
  }

  const brackets: Record<string, string> = { '[': ']', '(': ')', '{': '}' }
  const stack: string[] = []
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch in brackets) {
      stack.push(brackets[ch])
    } else if (ch === closeChar || ch === ']' || ch === ')' || ch === '}') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop()
        if (stack.length === 0) {
          return str.slice(0, i + 1)
        }
      } else {
        return null
      }
    }
  }
  return null
}

// ─── Edge connector matching ─────────────────────────────────────────────────

interface ConnectorMatch {
  edgeStyle: EdgeStyle
  startMarker: FlowMarker
  endMarker: FlowMarker
  label?: string
  rest: string
}

function headMarker(ch: string): FlowMarker {
  if (ch === '<' || ch === '>') return 'arrow'
  if (ch === 'o') return 'circle'
  if (ch === 'x') return 'cross'
  return 'none'
}

// Parse a connector token at the start of `str`, handling any combination of
// per-end markers across solid/dashed/thick links: --, -.-, ==, with optional
// <,o,x heads, plus the open forms ---, -.-, ===.
function parseConnToken(str: string): { edgeStyle: EdgeStyle; startMarker: FlowMarker; endMarker: FlowMarker; len: number } | null {
  let m: RegExpMatchArray | null
  if ((m = str.match(/^([<ox]?)-\.-([>ox]?)/))) {
    return { edgeStyle: 'dashed', startMarker: headMarker(m[1]), endMarker: headMarker(m[2]), len: m[0].length }
  }
  if (str.startsWith('===')) return { edgeStyle: 'thick', startMarker: 'none', endMarker: 'none', len: 3 }
  if ((m = str.match(/^([<ox]?)==([>ox]?)/)) && (m[1] || m[2])) {
    return { edgeStyle: 'thick', startMarker: headMarker(m[1]), endMarker: headMarker(m[2]), len: m[0].length }
  }
  if (str.startsWith('---')) return { edgeStyle: 'solid', startMarker: 'none', endMarker: 'none', len: 3 }
  if ((m = str.match(/^([<ox]?)--([>ox]?)/)) && (m[1] || m[2])) {
    return { edgeStyle: 'solid', startMarker: headMarker(m[1]), endMarker: headMarker(m[2]), len: m[0].length }
  }
  return null
}

function matchConnector(str: string): ConnectorMatch | null {
  str = str.trim()

  // Inline-label forms (agent-friendly): -- text -->, == text ==>, -. text .->
  let il = str.match(/^(--\s+.+?\s+)([<ox]?--[>ox]?|---)(.*)$/)
  if (il) {
    const c = parseConnToken(il[2])
    if (c) return { edgeStyle: c.edgeStyle, startMarker: c.startMarker, endMarker: c.endMarker, label: il[1].replace(/^--\s+/, '').trim(), rest: il[3] }
  }
  il = str.match(/^(==\s+.+?\s+)([<ox]?==[>ox]?|===)(.*)$/)
  if (il) {
    const c = parseConnToken(il[2])
    if (c) return { edgeStyle: c.edgeStyle, startMarker: c.startMarker, endMarker: c.endMarker, label: il[1].replace(/^==\s+/, '').trim(), rest: il[3] }
  }
  il = str.match(/^-\.\s+(.+?)\s+\.->(.*)$/)
  if (il) return { edgeStyle: 'dashed', startMarker: 'none', endMarker: 'arrow', label: il[1], rest: il[2] }

  // Head-based token, with optional |"label"| suffix.
  const c = parseConnToken(str)
  if (!c) return null
  const rest = str.slice(c.len)
  const lm = rest.match(/^\|"?([^"|]*)"?\|(.*)$/)
  if (lm) return { edgeStyle: c.edgeStyle, startMarker: c.startMarker, endMarker: c.endMarker, label: lm[1], rest: lm[2] }
  return { edgeStyle: c.edgeStyle, startMarker: c.startMarker, endMarker: c.endMarker, rest }
}

// ─── JSON extractor (depth-counted, handles nested objects) ───────────────────

function extractJson(s: string, fromIndex: number): string {
  let depth = 0
  let i = fromIndex
  while (i < s.length) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) return s.slice(fromIndex, i + 1)
    }
    i++
  }
  return ''
}

// Read the first `%%{ init: {...} }%%` directive found anywhere in the text.
// Lets diagram settings (theme/look/curve) round-trip even for documents with no
// flowchart block to carry them (e.g. a pure erDiagram), where the directive
// rides at the top of the ER block.
function readInitConfig(text: string): { theme?: Theme; look?: Look; curveStyle?: CurveStyle } {
  const initIdx = text.indexOf('init:')
  if (initIdx < 0) return {}
  const jsonStart = text.indexOf('{', initIdx + 5)
  if (jsonStart < 0) return {}
  const jsonStr = extractJson(text, jsonStart)
  if (!jsonStr) return {}
  try {
    const cfg = JSON.parse(jsonStr) as Record<string, unknown>
    const fc = cfg.flowchart as Record<string, unknown> | undefined
    return {
      theme: typeof cfg.theme === 'string' ? (cfg.theme as Theme) : undefined,
      look: typeof cfg.look === 'string' ? (cfg.look as Look) : undefined,
      curveStyle: typeof fc?.curve === 'string' ? (fc.curve as CurveStyle) : undefined,
    }
  } catch {
    return {}
  }
}

// ─── Default node factory ─────────────────────────────────────────────────────

function makeNode(id: string, label?: string, shape: NodeShape = 'rectangle'): Node<FlowNodeData> {
  return {
    id,
    type: 'flowNode',
    position: { x: 0, y: 0 },
    data: { label: label ?? id, shape },
  }
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseMermaidFlowchart(syntax: string, skipLayout = false): ParseResult {
  syntax = syntax.replace(/\r\n?/g, '\n') // normalize CRLF / CR line endings
  const empty: ParseResult = {
    nodes: [], edges: [],
    direction: 'TD', theme: 'default', look: 'classic', curveStyle: 'basis',
    error: null,
  }

  try {
    const lines = syntax.split('\n').map((l) => l.trim()).filter(Boolean)

    let direction: Direction = 'TD'
    let theme: Theme = 'default'
    let look: Look = 'classic'
    let curveStyle: CurveStyle = 'basis'
    let foundHeader = false
    let currentSubgraphId: string | null = null
    let edgeIdx = 0

    const nodesMap = new Map<string, Node<FlowNodeData>>()
    const edges: Edge<FlowEdgeData>[] = []
    const pendingStyles = new Map<string, Partial<Pick<FlowNodeData, 'fillColor' | 'strokeColor' | 'textColor'>>>()
    const pendingLinkStyles = new Map<number, string>()

    // Helper to register a node from a NodeRef. A bare edge reference creates a
    // placeholder; a later explicit declaration (in any order) fills in its real
    // label/shape — agents write edges and declarations in arbitrary order.
    const registerNode = (ref: NodeRef) => {
      const existing = nodesMap.get(ref.id)
      if (!existing) {
        const node = makeNode(ref.id, ref.label, ref.shape)
        if (currentSubgraphId) {
          node.parentId = currentSubgraphId
          node.extent = 'parent'
        }
        nodesMap.set(ref.id, node)
      } else if (ref.explicit) {
        existing.data = { ...existing.data, label: ref.label, shape: ref.shape }
      }
    }

    for (const line of lines) {
      // ── Comment lines (%%): skip unless init directive
      if (line.startsWith('%%')) {
        const initIdx = line.indexOf('init:')
        if (initIdx >= 0) {
          const jsonStart = line.indexOf('{', initIdx + 5)
          if (jsonStart >= 0) {
            const jsonStr = extractJson(line, jsonStart)
            if (jsonStr) {
              try {
                const cfg = JSON.parse(jsonStr) as Record<string, unknown>
                if (typeof cfg.theme === 'string') theme = cfg.theme as Theme
                if (typeof cfg.look === 'string') look = cfg.look as Look
                const fc = cfg.flowchart as Record<string, unknown> | undefined
                if (typeof fc?.curve === 'string') curveStyle = fc.curve as CurveStyle
              } catch { /* ignore */ }
            }
          }
        }
        continue
      }

      // ── Flowchart header
      const headerMatch = line.match(/^flowchart\s+(TD|LR|BT|RL)/)
      if (headerMatch) {
        direction = headerMatch[1] as Direction
        foundHeader = true
        continue
      }

      if (!foundHeader) continue

      // ── Subgraph block
      if (line.startsWith('subgraph ')) {
        const m = line.match(/^subgraph\s+(\w+)(?:\s+\["?([^"\]]*)"?\])?/)
        if (m) {
          currentSubgraphId = m[1]
          const label = m[2] ?? m[1]
          nodesMap.set(currentSubgraphId, {
            ...makeNode(currentSubgraphId, label),
            data: { label, shape: 'rectangle', isSubgraph: true },
            zIndex: -1,
          })
        }
        continue
      }

      if (line === 'end') {
        currentSubgraphId = null
        continue
      }

      // ── style line
      if (line.startsWith('style ')) {
        const m = line.match(/^style\s+(\w+)\s+(.+)$/)
        if (m) {
          const [, nodeId, stylePart] = m
          const s: Partial<Pick<FlowNodeData, 'fillColor' | 'strokeColor' | 'textColor'>> = {}
          for (const part of stylePart.split(',')) {
            const sep = part.indexOf(':')
            if (sep < 0) continue
            const k = part.slice(0, sep).trim()
            const v = part.slice(sep + 1).trim()
            if (k === 'fill') s.fillColor = v
            else if (k === 'stroke') s.strokeColor = v
            else if (k === 'color') s.textColor = v
          }
          pendingStyles.set(nodeId, s)
        }
        continue
      }

      // ── linkStyle line
      if (line.startsWith('linkStyle ')) {
        const m = line.match(/^linkStyle\s+(\d+)\s+stroke:([^\s,]+)/)
        if (m) pendingLinkStyles.set(parseInt(m[1], 10), m[2])
        continue
      }

      // ── Parse line as a chain of: NodeRef (connector NodeRef)*
      // This handles both standalone node declarations and edge lines
      // including inline node definitions like: A[label] --> B[label] --> C{decision}
      const firstNode = extractNodeRef(line)
      if (!firstNode) continue

      registerNode(firstNode)

      let remaining = firstNode.rest
      let prevNodeId = firstNode.id

      // Try to parse a chain of edges
      while (remaining.trim()) {
        const conn = matchConnector(remaining)
        if (!conn) break

        const targetRef = extractNodeRef(conn.rest)
        if (!targetRef) break

        registerNode(targetRef)

        edges.push({
          id: `edge_${edgeIdx++}`,
          source: prevNodeId,
          target: targetRef.id,
          type: 'flowEdge',
          label: conn.label,
          data: { edgeStyle: conn.edgeStyle, startMarker: conn.startMarker, endMarker: conn.endMarker },
        })

        prevNodeId = targetRef.id
        remaining = targetRef.rest
      }
    }

    if (!foundHeader) {
      return { ...empty, error: 'No valid flowchart header found. Start with "flowchart TD" (or LR/BT/RL).' }
    }

    if (nodesMap.size === 0) {
      return { ...empty, error: 'No nodes found. Add at least one node.' }
    }

    // Apply pending node styles
    let nodes = [...nodesMap.values()].map((node) => {
      const style = pendingStyles.get(node.id)
      return style ? { ...node, data: { ...node.data, ...style } } : node
    })

    // Apply pending link styles
    edges.forEach((edge, i) => {
      const sc = pendingLinkStyles.get(i)
      if (sc) edge.data = { ...edge.data, strokeColor: sc } as FlowEdgeData
    })

    // Layout (skipped when the document parser will place/lay out itself)
    if (!skipLayout) nodes = applyDagreLayout(nodes, edges, direction)

    return { nodes, edges, direction, theme, look, curveStyle, error: null }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'Parse error' }
  }
}

// ─── Full document parser (lossless .md round-trip) ──────────────────────────
// Reconstructs the whole whiteboard from the exported Markdown: the flowchart
// block (nodes/edges/groups/markers), the erDiagram block (entities + crow's-
// foot relationships), GFM tables, free notes, and attached-note addenda.

function extractMermaidBlocks(md: string): string[] {
  const re = /```mermaid\n([\s\S]*?)```/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) out.push(m[1].trim())
  return out
}

interface BodySection { heading: string; content: string }
function parseBodySections(md: string): BodySection[] {
  const without = md.replace(/```[\s\S]*?```/g, '') // drop fenced code (mermaid)
  const lines = without.split('\n')
  const sections: BodySection[] = []
  let cur: BodySection | null = null
  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (h) {
      if (cur) sections.push(cur)
      cur = { heading: h[1].trim(), content: '' }
    } else if (cur) {
      cur.content += line + '\n'
    }
  }
  if (cur) sections.push(cur)
  return sections.map((s) => ({ heading: s.heading, content: s.content.trim() }))
}

function parseGfmTable(content: string): { columns: string[]; rows: string[][] } | null {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
  const cells = (l: string) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().replace(/\\\|/g, '|'))
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\|.*\|$/.test(lines[i]) && /^\|[\s:|-]+\|$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const columns = cells(lines[i])
      const rows: string[][] = []
      for (let j = i + 2; j < lines.length && /^\|.*\|$/.test(lines[j]); j++) rows.push(cells(lines[j]))
      return { columns, rows }
    }
  }
  return null
}

// ── erDiagram parsing ──
const ER_LEFT_REV: Record<string, ErEnd> = { '||': 'one', '|o': 'zero-one', '}o': 'zero-many', '}|': 'one-many' }
const ER_RIGHT_REV: Record<string, ErEnd> = { '||': 'one', 'o|': 'zero-one', 'o{': 'zero-many', '|{': 'one-many' }

function parseEr(src: string): { nodes: Node<FlowNodeData>[]; edges: Edge<FlowEdgeData>[] } {
  const nodes: Node<FlowNodeData>[] = []
  const edges: Edge<FlowEdgeData>[] = []
  let cur: Node<FlowNodeData> | null = null
  let curName = ''
  let edgeIdx = 0
  let currentSub: string | null = null // open ER subgraph (group), if any
  // Per-entity field metadata (incl. comments) used to infer field-level links.
  const fieldMeta = new Map<string, { name: string; key: string; comment: string }[]>()
  // ER entities/groups support the same styling as flowcharts: `style`, plus
  // `classDef`/`class`. Collect them and apply once all nodes exist.
  type StyleObj = Partial<Pick<FlowNodeData, 'fillColor' | 'strokeColor' | 'textColor'>>
  const pendingStyles = new Map<string, StyleObj>()
  const classDefs = new Map<string, StyleObj>()
  const nodeClasses = new Map<string, string[]>()
  const parseStyle = (s: string): StyleObj => {
    const out: StyleObj = {}
    for (const part of s.split(',')) {
      const sep = part.indexOf(':')
      if (sep < 0) continue
      const k = part.slice(0, sep).trim()
      const v = part.slice(sep + 1).trim()
      if (k === 'fill') out.fillColor = v
      else if (k === 'stroke') out.strokeColor = v
      else if (k === 'color') out.textColor = v
    }
    return out
  }
  const addClass = (name: string, cls: string) => nodeClasses.set(name, [...(nodeClasses.get(name) ?? []), cls])
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '')
  // Tokens an FK comment points at, e.g. "-> users" / "link to geo_divisions/..".
  const refToks = (c: string) => {
    const out: string[] = []
    const re = /(?:->|link to)\s+([A-Za-z0-9_/]+)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(c))) for (const t of m[1].split('/')) out.push(norm(t))
    return out
  }
  const findPk = (ent: string) => (fieldMeta.get(ent) ?? []).findIndex((f) => f.key === 'PK')
  // Find the field on `holder` that references `other`: by the relationship label
  // naming a field, then by an FK comment pointing at `other`, then by name.
  const findFk = (holder: string, other: string, label: string) => {
    const fields = fieldMeta.get(holder) ?? []
    const o = norm(other)
    const ln = (label || '').toLowerCase()
    if (ln) for (let i = 0; i < fields.length; i++) if (fields[i].name && ln.includes(fields[i].name.toLowerCase())) return i
    for (let i = 0; i < fields.length; i++) {
      const toks = refToks(fields[i].comment)
      if (toks.some((t) => t === o || t.startsWith(o) || o.startsWith(t))) return i
    }
    for (let i = 0; i < fields.length; i++) {
      const fn = norm(fields[i].name)
      if (fn === o + 'id' || fn === o) return i
    }
    for (let i = 0; i < fields.length; i++) if (fields[i].key === 'FK') return i
    return -1
  }
  const ensure = (name: string) => {
    let n = nodes.find((x) => x.id === name)
    if (!n) {
      n = { id: name, type: 'flowNode', position: { x: 0, y: 0 }, data: { label: name, shape: 'rectangle', isEntity: true, fields: [] } }
      if (currentSub) n.parentId = currentSub // entity declared inside a group
      nodes.push(n)
    } else if (currentSub && !n.parentId) {
      n.parentId = currentSub
    }
    return n
  }
  for (const raw of src.split('\n')) {
    const line = raw.trim()
    if (!line || /^erDiagram/.test(line)) continue
    if (line === '}') { cur = null; continue }

    // ── Group (subgraph) — same grouping flowcharts have
    if (line.startsWith('subgraph ')) {
      const m = line.match(/^subgraph\s+(\w+)(?:\s+\["?([^"\]]*)"?\])?/)
      if (m) {
        currentSub = m[1]
        if (!nodes.some((n) => n.id === currentSub)) {
          nodes.push({ id: currentSub, type: 'flowNode', position: { x: 0, y: 0 }, data: { label: m[2] ?? m[1], shape: 'rectangle', isSubgraph: true }, zIndex: -1 })
        }
      }
      continue
    }
    if (line === 'end') { currentSub = null; continue }

    // ── Styling: `style <name> ...`, `classDef <name> ...`, `class A,B <cls>`
    if (line.startsWith('style ')) {
      const m = line.match(/^style\s+(\w+)\s+(.+)$/)
      if (m) pendingStyles.set(m[1], parseStyle(m[2]))
      continue
    }
    if (line.startsWith('classDef ')) {
      const m = line.match(/^classDef\s+(\w+)\s+(.+)$/)
      if (m) classDefs.set(m[1], parseStyle(m[2]))
      continue
    }
    if (line.startsWith('class ')) {
      const m = line.match(/^class\s+([\w,\s]+?)\s+(\w+)\s*$/)
      if (m) for (const nm of m[1].split(',').map((s) => s.trim()).filter(Boolean)) addClass(nm, m[2])
      continue
    }

    // ── Entity block open (optionally with an inline `:::class`)
    const open = line.match(/^(\w+)(?::::(\w+))?\s*\{$/)
    if (open) { curName = open[1]; cur = ensure(curName); if (open[2]) addClass(curName, open[2]); if (!fieldMeta.has(curName)) fieldMeta.set(curName, []); continue }
    if (cur) {
      const f = line.match(/^(\S+)\s+(\S+)(?:\s+(PK|FK|UK))?(?:\s+"([^"]*)")?/)
      if (f) {
        ;(cur.data.fields as EntityField[]).push({ type: f[1], name: f[2], key: (f[3] as EntityKey) || '' })
        fieldMeta.get(curName)!.push({ name: f[2], key: f[3] || '', comment: f[4] || '' })
      }
      continue
    }
    const rel = line.match(/^(\w+)\s+(\S+)\s+(\w+)\s*:\s*"?(.*?)"?\s*$/)
    if (rel) {
      const [, a, conn, b, label] = rel
      ensure(a); ensure(b)
      const li = conn.search(/--|\.\./)
      if (li < 0) continue
      const leftSym = conn.slice(0, li)
      const rightSym = conn.slice(li + 2)
      // The FK lives on the "many" side (crow's foot); the PK on the "one" side.
      const manyLeft = /[}{]/.test(leftSym)
      const manyRight = /[}{]/.test(rightSym)
      let sFI: number, tFI: number
      if (manyRight && !manyLeft) { tFI = findFk(b, a, label); sFI = findPk(a) }
      else if (manyLeft && !manyRight) { sFI = findFk(a, b, label); tFI = findPk(b) }
      else {
        const fkB = findFk(b, a, label)
        if (fkB >= 0) { tFI = fkB; sFI = findPk(a) }
        else { const fkA = findFk(a, b, label); if (fkA >= 0) { sFI = fkA; tFI = findPk(b) } else { sFI = findPk(a); tFI = findPk(b) } }
      }
      edges.push({
        id: `er_${edgeIdx++}`, source: a, target: b, type: 'flowEdge', label,
        data: {
          edgeStyle: conn.includes('..') ? 'dashed' : 'solid',
          erStart: ER_LEFT_REV[leftSym] ?? 'one',
          erEnd: ER_RIGHT_REV[rightSym] ?? 'zero-many',
          ...(sFI >= 0 ? { sourceFieldIndex: sFI } : {}),
          ...(tFI >= 0 ? { targetFieldIndex: tFI } : {}),
        },
      })
      continue
    }
    const bare = line.match(/^(\w+)(?::::(\w+))?$/)
    if (bare) { ensure(bare[1]); if (bare[2]) addClass(bare[1], bare[2]) }
  }

  // Apply styles: class styles first (in order), then an explicit `style` wins.
  for (const n of nodes) {
    if (!n.data.isEntity && !n.data.isSubgraph) continue
    const applied: StyleObj = {}
    for (const cls of nodeClasses.get(n.id) ?? []) Object.assign(applied, classDefs.get(cls) ?? {})
    Object.assign(applied, pendingStyles.get(n.id) ?? {})
    if (Object.keys(applied).length) n.data = { ...n.data, ...applied }
  }
  return { nodes, edges }
}

export function parseDocument(md: string): ParseResult {
  md = md.replace(/\r\n?/g, '\n') // normalize CRLF / CR (Windows-edited .md files)
  const blocks = extractMermaidBlocks(md)
  const flowSrc = blocks.find((b) => /^\s*(flowchart|graph)\b/.test(b))
  const erSrc = blocks.find((b) => /^\s*erDiagram\b/.test(b))

  const flow: ParseResult = flowSrc
    ? parseMermaidFlowchart(flowSrc, true)
    : { nodes: [], edges: [], direction: 'TD', theme: 'default', look: 'classic', curveStyle: 'basis', error: null }
  if (flow.error && !flowSrc) flow.error = null

  // Body sections → tables / free notes / attached-note addenda.
  const tableSections = new Map<string, { columns: string[]; rows: string[][] }>()
  const noteSections = new Map<string, string>()
  const addenda: { host: string; content: string }[] = []
  for (const { heading, content } of parseBodySections(md)) {
    const host = heading.match(/^(.*?)\s+[—-]\s+notes$/i)
    if (host) { addenda.push({ host: host[1].trim(), content }); continue }
    const gfm = parseGfmTable(content)
    if (gfm) tableSections.set(heading, gfm)
    else noteSections.set(heading, content)
  }

  // Reconstruct table/note reference nodes from their body sections.
  const nodes: Node<FlowNodeData>[] = flow.nodes.map((n) => {
    const label = n.data.label
    if (n.data.shape === 'subroutine' && tableSections.has(label)) {
      const t = tableSections.get(label)!
      return { ...n, data: { label, shape: 'rectangle', isTable: true, columns: t.columns, rows: t.rows } }
    }
    if (n.data.shape === 'asymmetric' && noteSections.has(label)) {
      const body = noteSections.get(label)!
      return { ...n, data: { label: body ? `${label}\n${body}` : label, shape: 'rectangle', isNote: true } }
    }
    return n
  })

  const er = erSrc ? parseEr(erSrc) : { nodes: [], edges: [] }
  const edges = [...flow.edges, ...er.edges]

  // For documents with no flowchart block (e.g. pure ER), recover diagram
  // settings from a global init directive (carried atop the ER block).
  if (!flowSrc) {
    const g = readInitConfig(md)
    if (g.theme) flow.theme = g.theme
    if (g.look) flow.look = g.look
    if (g.curveStyle) flow.curveStyle = g.curveStyle
  }

  // Lay out the structural nodes (Dagre), then pin attached notes onto hosts.
  let laid = applyDagreLayout([...nodes, ...er.nodes], edges, flow.direction)
  let idx = 0
  for (const { host, content } of addenda) {
    const hostNode = laid.find((n) => n.data.label === host)
    laid = [
      ...laid,
      {
        id: `note_imp_${idx++}`,
        type: 'flowNode',
        position: hostNode ? { x: 24, y: 24 } : { x: 40 + idx * 30, y: 40 },
        parentId: hostNode?.id,
        data: { label: content.trim(), shape: 'rectangle', isNote: true },
      } as Node<FlowNodeData>,
    ]
  }

  return {
    nodes: laid,
    edges,
    direction: flow.direction,
    theme: flow.theme,
    look: flow.look,
    curveStyle: flow.curveStyle,
    error: null,
  }
}
