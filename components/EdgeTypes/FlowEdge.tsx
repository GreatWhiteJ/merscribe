'use client'

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react'
import { useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useFlowStore, type FlowEdgeData, type FlowMarker, type ErEnd } from '@/lib/store'
import { getErEdgeParams } from '@/lib/floatingEdge'
import { flowMarkerUrl, erMarkerUrl } from './EdgeMarkers'

export function FlowEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
}: EdgeProps) {
  const curveStyle = useFlowStore((s) => s.curveStyle)
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const edgeData = data as FlowEdgeData | undefined

  // ER relationship? (both ends are entities) — then tie the FK row to the PK row.
  const isEr = useFlowStore(
    useShallow((s) => {
      const a = s.nodes.find((n) => n.id === source)
      const b = s.nodes.find((n) => n.id === target)
      return !!a?.data.isEntity && !!b?.data.isEntity
    }),
  )

  // ER edges attach field-to-field on whichever side faces the other entity;
  // flow edges use their normal handles. Routing follows the curve style:
  // step* → right-angle, linear → straight, else curved.
  const erp = isEr
    ? getErEdgeParams(sourceNode, targetNode, edgeData?.sourceFieldIndex, edgeData?.targetFieldIndex)
    : null
  const sx = erp?.sx ?? sourceX
  const sy = erp?.sy ?? sourceY
  const tx = erp?.tx ?? targetX
  const ty = erp?.ty ?? targetY
  const sPos = erp?.sourcePos ?? sourcePosition
  const tPos = erp?.targetPos ?? targetPosition

  const orthogonal = curveStyle === 'step' || curveStyle === 'stepAfter' || curveStyle === 'stepBefore'
  const straight = curveStyle === 'linear'
  const [edgePath, labelX, labelY] = orthogonal
    ? getSmoothStepPath({ sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: tx, targetY: ty, targetPosition: tPos, borderRadius: 6 })
    : straight
      ? getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty })
      : getBezierPath({ sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: tx, targetY: ty, targetPosition: tPos })

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState((label as string) ?? '')
  const updateEdgeLabel = useFlowStore((s) => s.updateEdgeLabel)

  const commitLabel = useCallback(() => {
    updateEdgeLabel(id, draft.trim())
    setEditing(false)
  }, [draft, id, updateEdgeLabel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter') commitLabel()
      if (e.key === 'Escape') setEditing(false)
    },
    [commitLabel]
  )

  const edgeStyle = edgeData?.edgeStyle ?? 'solid'
  const strokeColor = edgeData?.strokeColor ?? '#9ca3af'
  const displayLabel = label as string | undefined

  // Markers per end. ER edges use crow's-foot; flow edges use arrow/circle/cross.
  const markerStart = isEr
    ? erMarkerUrl((edgeData?.erStart as ErEnd) ?? 'one')
    : flowMarkerUrl((edgeData?.startMarker as FlowMarker) ?? 'none')
  const markerEnd = isEr
    ? erMarkerUrl((edgeData?.erEnd as ErEnd) ?? 'zero-many')
    : flowMarkerUrl((edgeData?.endMarker as FlowMarker) ?? 'arrow')

  // Edge visual style
  let strokeDasharray: string | undefined
  let strokeWidth = 2
  if (edgeStyle === 'dashed') strokeDasharray = '7 4'
  if (edgeStyle === 'thick') strokeWidth = 4

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{
          strokeDasharray,
          strokeWidth,
          stroke: strokeColor,
        }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setDraft((label as string) ?? '')
            setEditing(true)
          }}
        >
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={handleKeyDown}
              placeholder="label…"
              className="text-xs outline-none w-24 text-center"
              style={{ color: strokeColor, background: 'var(--neu-bg)', border: `1px solid ${strokeColor}`, borderRadius: 4, padding: '1px 5px' }}
            />
          ) : displayLabel ? (
            <span
              className="text-xs cursor-pointer select-none"
              style={{ color: strokeColor, fontWeight: 600, background: 'var(--neu-bg)', padding: '0 4px', borderRadius: 3 }}
            >
              {displayLabel}
            </span>
          ) : (
            <span
              className="text-xs cursor-pointer select-none"
              style={{ color: strokeColor, opacity: 0.45, background: 'var(--neu-bg)', padding: '0 3px', borderRadius: 3 }}
            >
              ✎
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
