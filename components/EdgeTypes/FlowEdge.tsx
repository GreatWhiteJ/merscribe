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
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
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
  selected,
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

  // ER relationships always route as right-angles (that's the ER convention and
  // it reads cleanly with field-level side attachment); flowchart edges follow
  // the diagram's Curve Style.
  const orthogonal = isEr || curveStyle === 'step' || curveStyle === 'stepAfter' || curveStyle === 'stepBefore'
  const straight = !isEr && curveStyle === 'linear'
  const [edgePath, labelX, labelY] = orthogonal
    ? getSmoothStepPath({ sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: tx, targetY: ty, targetPosition: tPos, borderRadius: 6 })
    : straight
      ? getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty })
      : getBezierPath({ sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: tx, targetY: ty, targetPosition: tPos })

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState((label as string) ?? '')
  // Measured size of the rendered label, used to cut the gap in the line above.
  const labelRef = useRef<HTMLDivElement>(null)
  const [labelBox, setLabelBox] = useState<{ w: number; h: number } | null>(null)
  const updateEdgeLabel = useFlowStore((s) => s.updateEdgeLabel)

  useLayoutEffect(() => {
    const el = labelRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    setLabelBox((prev) => (prev && Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1 ? prev : { w, h }))
  }, [label, editing, draft])

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

  // A selected line has to *say* it's selected: a 2px grey hairline going 2px
  // grey is no feedback at all. It takes the accent colour, thickens, and picks
  // up a soft halo so it reads as picked even against a busy diagram.
  const SELECT_COLOR = '#3b82f6'

  // A label needs a real hole in the line, not just an opaque background behind
  // it: React Flow elevates a selected edge above the label layer, which is why
  // a line would sometimes cut straight through its own text and sometimes not.
  // Masking the stroke makes the break unconditional. offsetWidth/Height are
  // pre-transform, so they're already in flow units — no zoom maths needed.
  const maskId = `edge-label-gap-${id}`
  const gap = labelBox && (editing || !!displayLabel)
  const GAP_PAD = 3

  return (
    <>
      {gap && (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            {/* white shows the stroke, black punches it out */}
            <rect x={-1e6} y={-1e6} width={2e6} height={2e6} fill="white" />
            <rect
              x={labelX - labelBox.w / 2 - GAP_PAD}
              y={labelY - labelBox.h / 2 - GAP_PAD}
              width={labelBox.w + GAP_PAD * 2}
              height={labelBox.h + GAP_PAD * 2}
              rx={4}
              fill="black"
            />
          </mask>
        </defs>
      )}
      <BaseEdge
        mask={gap ? `url(#${maskId})` : undefined}
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        // Well wider than the 1–4px of ink: the line is hittable anywhere along
        // a ~24px band, which is what makes a thin edge practical to click.
        interactionWidth={24}
        style={{
          strokeDasharray,
          strokeWidth: selected ? strokeWidth + 1.5 : strokeWidth,
          stroke: selected ? SELECT_COLOR : strokeColor,
          filter: selected ? 'drop-shadow(0 0 3px rgba(59,130,246,0.75))' : undefined,
          transition: 'stroke 0.1s, stroke-width 0.1s',
        }}
      />

      <EdgeLabelRenderer>
        <div
          ref={labelRef}
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
