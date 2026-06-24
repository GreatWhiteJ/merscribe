import type { Node } from '@xyflow/react'
import type { FlowNodeData } from './store'

// Ids of the nodes that belong to the ER block: every entity, plus any subgraph
// that contains at least one entity (an ER group). Everything else is the
// flowchart block. Used to split the canvas by block — for the All/Flow/ER
// switcher and for laying each block out on its own.
export function erNodeIds(nodes: Node<FlowNodeData>[]): Set<string> {
  const ids = new Set<string>()
  for (const n of nodes) if (n.data?.isEntity) ids.add(n.id)
  for (const n of nodes) {
    if (n.data?.isSubgraph && nodes.some((c) => c.parentId === n.id && c.data?.isEntity)) {
      ids.add(n.id)
    }
  }
  return ids
}
