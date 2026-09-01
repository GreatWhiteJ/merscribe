import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import type { Direction, FlowNodeData } from './store'

const NODE_WIDTH = 150
const NODE_HEIGHT = 60
const SUBGRAPH_PADDING = 40

const RANKDIR: Record<Direction, string> = {
  TD: 'TB',
  LR: 'LR',
  BT: 'BT',
  RL: 'RL',
}

export function applyDagreLayout(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  direction: Direction = 'TD'
): Node<FlowNodeData>[] {
  if (nodes.length === 0) return nodes

  const g = new dagre.graphlib.Graph({ compound: true })
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: RANKDIR[direction], nodesep: 60, ranksep: 80 })

  // Add all nodes
  for (const node of nodes) {
    if (node.data?.isSubgraph) {
      // Let dagre auto-size subgraphs from children; provide padding
      g.setNode(node.id, {
        width: 0,
        height: 0,
        paddingX: SUBGRAPH_PADDING,
        paddingY: SUBGRAPH_PADDING,
      })
    } else {
      const w = typeof node.style?.width === 'number' ? node.style.width : NODE_WIDTH
      const h = typeof node.style?.height === 'number' ? node.style.height : NODE_HEIGHT
      g.setNode(node.id, { width: w, height: h })
    }
  }

  // Set parent relationships for compound layout. Only against a parent that is
  // actually in this graph — graphlib would otherwise conjure a value-less node
  // for it, which dagre then trips over while ranking.
  for (const node of nodes) {
    if (node.parentId && g.hasNode(node.parentId)) {
      g.setParent(node.id, node.parentId)
    }
  }

  // Cross-boundary edges are fine, but an edge incident to a *cluster* (a
  // subgraph — `explore --> places`) is not: dagre can't rank one, and an edge
  // naming a node that isn't here makes graphlib invent an empty one, which
  // crashes the same rank pass. Skip both for layout purposes only — React Flow
  // still draws every edge; it just doesn't get a say in where things land.
  const clusters = new Set(nodes.filter((n) => n.data?.isSubgraph).map((n) => n.id))
  for (const edge of edges) {
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue
    if (clusters.has(edge.source) || clusters.has(edge.target)) continue
    g.setEdge(edge.source, edge.target)
  }

  try {
    dagre.layout(g)
  } catch {
    // A layout we can't compute must never cost the user their document — hand
    // the nodes back unpositioned rather than throwing out of the parse.
    return nodes
  }

  return nodes.map((node) => {
    const layout = g.node(node.id)
    if (!layout) return node

    if (node.data?.isSubgraph) {
      return {
        ...node,
        position: {
          x: layout.x - layout.width / 2,
          y: layout.y - layout.height / 2,
        },
        style: {
          ...node.style,
          width: layout.width,
          height: layout.height,
        },
      }
    }

    if (node.parentId) {
      // Convert dagre absolute coords to parent-relative for React Flow
      const parentLayout = g.node(node.parentId)
      if (!parentLayout) return node
      const w = typeof node.style?.width === 'number' ? node.style.width : NODE_WIDTH
      const h = typeof node.style?.height === 'number' ? node.style.height : NODE_HEIGHT
      const parentTopLeftX = parentLayout.x - parentLayout.width / 2
      const parentTopLeftY = parentLayout.y - parentLayout.height / 2
      return {
        ...node,
        position: {
          x: layout.x - w / 2 - parentTopLeftX,
          y: layout.y - h / 2 - parentTopLeftY,
        },
      }
    }

    // Top-level non-subgraph node
    const w = typeof node.style?.width === 'number' ? node.style.width : NODE_WIDTH
    const h = typeof node.style?.height === 'number' ? node.style.height : NODE_HEIGHT
    return {
      ...node,
      position: {
        x: layout.x - w / 2,
        y: layout.y - h / 2,
      },
    }
  })
}
