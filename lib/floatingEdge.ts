import { Position, type InternalNode } from '@xyflow/react'

// Field-level ER edge geometry. A relationship ties a specific FK row to a
// specific PK row, so the edge attaches at those rows' vertical centers, on
// whichever side of each entity faces the other — never wrapping around a box.
// Mirrors the entity layout in FlowNode (header + fixed-height field rows).
const HEADER_H = 30
const ROW_H = 26

function box(n: InternalNode) {
  const w = n.measured?.width ?? 0
  const h = n.measured?.height ?? 0
  const { x, y } = n.internals.positionAbsolute
  return { x, y, w, h }
}

// Vertical center of field `idx` (or the entity's middle when idx is undefined),
// clamped to stay on the box.
function rowY(b: { y: number; h: number }, idx?: number) {
  if (idx == null) return b.y + b.h / 2
  const y = b.y + HEADER_H + idx * ROW_H + ROW_H / 2
  return Math.min(b.y + b.h - 6, Math.max(b.y + 8, y))
}

export interface ErEdgeParams {
  sx: number
  sy: number
  tx: number
  ty: number
  sourcePos: Position
  targetPos: Position
}

// Returns null until both entities are measured (caller falls back to handles).
export function getErEdgeParams(
  source: InternalNode | undefined,
  target: InternalNode | undefined,
  sourceFieldIndex?: number,
  targetFieldIndex?: number,
): ErEdgeParams | null {
  if (!source || !target) return null
  if (!source.measured?.width || !target.measured?.width) return null
  if (source.id === target.id) return null
  const s = box(source)
  const t = box(target)
  const sourceRight = t.x + t.w / 2 >= s.x + s.w / 2
  return {
    sx: sourceRight ? s.x + s.w : s.x,
    sy: rowY(s, sourceFieldIndex),
    tx: sourceRight ? t.x : t.x + t.w,
    ty: rowY(t, targetFieldIndex),
    sourcePos: sourceRight ? Position.Right : Position.Left,
    targetPos: sourceRight ? Position.Left : Position.Right,
  }
}
