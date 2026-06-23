'use client'

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useFlowStore, type FlowEdgeData, type FlowMarker, type ErEnd } from '@/lib/store'
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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

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

  const edgeData = data as FlowEdgeData | undefined
  const edgeStyle = edgeData?.edgeStyle ?? 'solid'
  const strokeColor = edgeData?.strokeColor ?? '#9ca3af'
  const displayLabel = label as string | undefined

  // Is this an ER relationship (both endpoints are entities)?
  const isEr = useFlowStore(
    useShallow((s) => {
      const a = s.nodes.find((n) => n.id === source)
      const b = s.nodes.find((n) => n.id === target)
      return !!a?.data.isEntity && !!b?.data.isEntity
    }),
  )

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
