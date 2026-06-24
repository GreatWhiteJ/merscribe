'use client'

import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react'
import { useCallback, useRef, useState } from 'react'
import { useFlowStore, type FlowNodeData, type NodeShape } from '@/lib/store'

// ─── SVG shape paths (viewBox 0 0 200 100, preserveAspectRatio="none") ────────
// All points are in the 200×100 coordinate space so they stretch with the node.

function SvgHexagon({
  fill,
  stroke,
  sw,
}: {
  fill: string
  stroke: string
  sw: number
}) {
  return (
    <polygon
      points="50,2 150,2 198,50 150,98 50,98 2,50"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
    />
  )
}

function SvgParallelogram({
  fill,
  stroke,
  sw,
}: {
  fill: string
  stroke: string
  sw: number
}) {
  return (
    <polygon
      points="28,2 198,2 172,98 2,98"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
    />
  )
}

function SvgParallelogramAlt({
  fill,
  stroke,
  sw,
}: {
  fill: string
  stroke: string
  sw: number
}) {
  return (
    <polygon
      points="2,2 172,2 198,98 28,98"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
    />
  )
}

function SvgTrapezoid({
  fill,
  stroke,
  sw,
}: {
  fill: string
  stroke: string
  sw: number
}) {
  // Wider at top
  return (
    <polygon
      points="2,2 198,2 175,98 25,98"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
    />
  )
}

function SvgTrapezoidAlt({
  fill,
  stroke,
  sw,
}: {
  fill: string
  stroke: string
  sw: number
}) {
  // Wider at bottom
  return (
    <polygon
      points="25,2 175,2 198,98 2,98"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
    />
  )
}

function SvgAsymmetric({
  fill,
  stroke,
  sw,
}: {
  fill: string
  stroke: string
  sw: number
}) {
  return (
    <polygon
      points="2,2 178,2 198,50 178,98 2,98"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
    />
  )
}

function SvgCylinder({
  fill,
  stroke,
  sw,
}: {
  fill: string
  stroke: string
  sw: number
}) {
  // Database cylinder: rect body + ellipse caps. viewBox="0 0 200 120"
  return (
    <>
      <rect x={sw} y={18} width={200 - sw * 2} height={84} fill={fill} stroke={stroke} strokeWidth={sw} />
      {/* Top cap */}
      <ellipse cx={100} cy={18} rx={100 - sw} ry={16} fill={fill} stroke={stroke} strokeWidth={sw} />
      {/* Bottom cap outline only */}
      <ellipse cx={100} cy={102} rx={100 - sw} ry={16} fill={fill} stroke={stroke} strokeWidth={sw} />
    </>
  )
}

function SvgDiamond({
  fill,
  stroke,
  sw,
}: {
  fill: string
  stroke: string
  sw: number
}) {
  // Vertices at cardinal midpoints of 200×100 viewBox — aligns with React Flow handles
  return (
    <polygon
      points="100,2 198,50 100,98 2,50"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
    />
  )
}

// ─── Shape → SVG renderer map ─────────────────────────────────────────────────
type SvgShapeRenderer = (props: { fill: string; stroke: string; sw: number }) => React.ReactNode

const SVG_RENDERERS: Partial<Record<NodeShape, SvgShapeRenderer>> = {
  diamond: SvgDiamond,
  hexagon: SvgHexagon,
  parallelogram: SvgParallelogram,
  'parallelogram-alt': SvgParallelogramAlt,
  trapezoid: SvgTrapezoid,
  'trapezoid-alt': SvgTrapezoidAlt,
  asymmetric: SvgAsymmetric,
  cylinder: SvgCylinder,
}

const IS_SVG_SHAPE = new Set<NodeShape>(Object.keys(SVG_RENDERERS) as NodeShape[])

// ─── Four-directional handles (shown on all shapes) ──────────────────────────
function NodeHandles() {
  const base = {
    zIndex: 30,
    pointerEvents: 'all',
  } as const

  const topStyle = { ...base, top: 2 }
  const bottomStyle = { ...base, bottom: 2 }
  const leftStyle = { ...base, left: 2 }
  const rightStyle = { ...base, right: 2 }

  return (
    <>
      <Handle
        id="top-target"
        type="target"
        position={Position.Top}
        className="!bg-blue-300 hover:!bg-blue-500 !w-3 !h-3"
        style={topStyle}
      />
      <Handle
        id="left-target"
        type="target"
        position={Position.Left}
        className="!bg-blue-300 hover:!bg-blue-500 !w-3 !h-3"
        style={leftStyle}
      />
      <Handle
        id="bottom-source"
        type="source"
        position={Position.Bottom}
        className="!bg-blue-300 hover:!bg-blue-500 !w-3 !h-3"
        style={bottomStyle}
      />
      <Handle
        id="right-source"
        type="source"
        position={Position.Right}
        className="!bg-blue-300 hover:!bg-blue-500 !w-3 !h-3"
        style={rightStyle}
      />
    </>
  )
}

// ─── Inline label editor ──────────────────────────────────────────────────────
interface LabelProps {
  value: string
  editing: boolean
  draft: string
  setDraft: (v: string) => void
  onCommit: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  color?: string
  fontSize?: number
}

function NodeLabel({
  value,
  editing,
  draft,
  setDraft,
  onCommit,
  onKeyDown,
  inputRef,
  color,
  fontSize,
}: LabelProps) {
  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onCommit}
        onKeyDown={onKeyDown}
        className="bg-transparent border-none outline-none text-center text-sm w-full"
        style={fontSize ? { fontSize } : undefined}
        autoFocus
        aria-label="Node label"
      />
    )
  }
  return (
    <span
      className="text-center break-words text-sm font-medium leading-snug select-none"
      style={{ color: color || '#1f2937', ...(fontSize ? { fontSize } : {}) }}
    >
      {value}
    </span>
  )
}

// ─── Main FlowNode component ──────────────────────────────────────────────────
export function FlowNode({ id, data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(nodeData.label)
  const [isHovered, setIsHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const updateNodeLabel = useFlowStore((s) => s.updateNodeLabel)
  const pushHistory = useFlowStore((s) => s.pushHistory)
  const dropTargetId = useFlowStore((s) => s.dropTargetId)
  const isDropTarget = dropTargetId === id
  // A note attached to a (non-subgraph) node is an addendum: no connection points.
  const noteAttached = useFlowStore((s) => {
    const me = s.nodes.find((n) => n.id === id)
    if (!me?.parentId) return false
    const parent = s.nodes.find((n) => n.id === me.parentId)
    return !!parent && !parent.data.isSubgraph
  })
  const dropRing: React.CSSProperties = isDropTarget ? { outline: '2px solid #4F46E5', outlineOffset: 2 } : {}
  const updateEntityField = useFlowStore((s) => s.updateEntityField)
  const addEntityField = useFlowStore((s) => s.addEntityField)
  const updateTableHeader = useFlowStore((s) => s.updateTableHeader)
  const updateTableCell = useFlowStore((s) => s.updateTableCell)
  const addTableRow = useFlowStore((s) => s.addTableRow)
  const addTableColumn = useFlowStore((s) => s.addTableColumn)
  const removeTableRow = useFlowStore((s) => s.removeTableRow)
  const removeTableColumn = useFlowStore((s) => s.removeTableColumn)
  const [editRow, setEditRow] = useState<number | null>(null)
  const [editCell, setEditCell] = useState<{ r: number; c: number } | null>(null)
  const navRef = useRef(false) // true while moving between table cells (skip blur-exit)

  const commitLabel = useCallback(() => {
    const trimmed = draft.trim() || 'Node'
    updateNodeLabel(id, trimmed)
    setEditing(false)
  }, [draft, id, updateNodeLabel])

  const handleDoubleClick = useCallback(() => {
    setDraft(nodeData.label)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }, [nodeData.label])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter') commitLabel()
      if (e.key === 'Escape') setEditing(false)
    },
    [commitLabel]
  )

  const shape = (nodeData.shape ?? 'rectangle') as NodeShape
  const fillColor = nodeData.fillColor || '#ffffff'
  const strokeColor = nodeData.strokeColor || (selected ? '#3b82f6' : '#9ca3af')
  const textColor = nodeData.textColor || '#1f2937'
  const strokeWidth = selected ? 3 : 2

  const labelProps: LabelProps = {
    value: nodeData.label,
    editing,
    draft,
    setDraft,
    onCommit: commitLabel,
    onKeyDown: handleKeyDown,
    inputRef,
    color: textColor,
    fontSize: nodeData.fontSize,
  }

  // ── Note (multi-line text annotation) ──────────────────────────────────────
  if (nodeData.isNote) {
    const noteCommit = () => {
      updateNodeLabel(id, draft.trim() === '' ? 'New note' : draft)
      setEditing(false)
    }
    const noteKeyDown = (e: React.KeyboardEvent) => {
      e.stopPropagation()
      // Enter inserts a newline (default). Esc or Ctrl/Cmd+Enter commits.
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        noteCommit()
      }
    }
    return (
      <div
        // Height fits the content (so notes grow with text instead of showing a
        // pointless scrollbar); only very long notes hit maxHeight and scroll.
        className="relative w-full cursor-pointer"
        style={{
          backgroundColor: nodeData.fillColor || '#fef9c3',
          border: `${strokeWidth}px solid ${nodeData.strokeColor || (selected ? '#3b82f6' : '#eab308')}`,
          borderRadius: 6,
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          padding: 10,
          minHeight: 46,
          maxHeight: 240,
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <NodeResizer
          minWidth={120}
          minHeight={46}
          isVisible={!!selected || isHovered}
          onResizeEnd={() => pushHistory()}
        />
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={noteCommit}
            onKeyDown={noteKeyDown}
            autoFocus
            // nowheel: scroll the textarea instead of zooming the canvas
            className="nowheel w-full bg-transparent border-none outline-none resize-none text-sm leading-snug"
            rows={4}
            style={{ color: textColor, fontFamily: 'inherit', minHeight: 72, ...(nodeData.fontSize ? { fontSize: nodeData.fontSize } : {}) }}
            aria-label="Note text"
          />
        ) : (
          <div
            // nowheel: a hovered sticky scrolls its own content rather than zooming
            className="nowheel w-full overflow-auto text-sm leading-snug select-none"
            style={{ color: textColor, maxHeight: 218, whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...(nodeData.fontSize ? { fontSize: nodeData.fontSize } : {}) }}
          >
            {nodeData.label}
          </div>
        )}
        {!noteAttached && <NodeHandles />}
      </div>
    )
  }

  // ── Entity / table (ERD) ───────────────────────────────────────────────────
  if (nodeData.isEntity) {
    const fields = nodeData.fields ?? []
    const HEADER_H = 30
    const ROW_H = 26
    const accent = nodeData.strokeColor || '#475569'
    const headerBg = selected ? '#4F46E5' : accent
    const stroke = selected ? '#4F46E5' : accent
    const inlineInput: React.CSSProperties = {
      border: '1px solid #c7d2fe',
      borderRadius: 4,
      padding: '1px 4px',
      fontSize: 11,
      minWidth: 0,
      outline: 'none',
    }
    const dot: React.CSSProperties = {
      width: 9,
      height: 9,
      background: '#6366f1',
      border: '2px solid #fff',
      zIndex: 30,
    }
    const exitEdit = (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault()
        setEditRow(null)
      }
    }
    return (
      <div
        className="relative w-full h-full"
        style={{
          background: nodeData.fillColor || '#ffffff',
          border: `${strokeWidth}px solid ${stroke}`,
          borderRadius: 6,
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          ...dropRing,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <NodeResizer
          minWidth={180}
          minHeight={HEADER_H + ROW_H}
          isVisible={!!selected || isHovered}
          onResizeEnd={() => pushHistory()}
        />
        {/* Title bar (double-click to rename) */}
        <div
          onDoubleClick={handleDoubleClick}
          style={{
            height: HEADER_H,
            background: headerBg,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 13,
            borderTopLeftRadius: 5,
            borderTopRightRadius: 5,
          }}
        >
          <NodeLabel {...labelProps} color="#ffffff" />
        </div>

        {/* Field rows — double-click a row to edit it inline */}
        {fields.map((f, i) => (
          <div
            key={i}
            className="nodrag"
            onDoubleClick={(e) => { e.stopPropagation(); setEditRow(i) }}
            style={{
              height: ROW_H,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 12px',
              borderTop: '1px solid #eef2f7',
              fontSize: nodeData.fontSize ?? 12,
              color: '#1f2937',
            }}
          >
            {editRow === i ? (
              <>
                <input
                  className="nodrag"
                  autoFocus
                  value={f.name}
                  placeholder="name"
                  onChange={(e) => updateEntityField(id, i, { name: e.target.value })}
                  onKeyDown={exitEdit}
                  onBlur={() => setEditRow(null)}
                  style={{ ...inlineInput, flex: 2 }}
                />
                <input
                  className="nodrag"
                  value={f.type}
                  placeholder="type"
                  onChange={(e) => updateEntityField(id, i, { type: e.target.value })}
                  onKeyDown={exitEdit}
                  style={{ ...inlineInput, flex: 2 }}
                />
                <select
                  className="nodrag"
                  value={f.key}
                  onChange={(e) => updateEntityField(id, i, { key: e.target.value as typeof f.key })}
                  onKeyDown={exitEdit}
                  style={{ ...inlineInput, width: 46 }}
                >
                  <option value="">—</option>
                  <option value="PK">PK</option>
                  <option value="FK">FK</option>
                  <option value="UK">UK</option>
                </select>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontWeight: 600, color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                <span style={{ color: '#9ca3af' }}>{f.type}</span>
                <span style={{ width: 26, textAlign: 'right', fontWeight: 700, color: '#6366f1', fontSize: 10 }}>{f.key}</span>
              </>
            )}
          </div>
        ))}

        {/* Add-field affordance */}
        <div
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); addEntityField(id) }}
          style={{
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderTop: '1px solid #eef2f7',
            fontSize: 11,
            color: '#6366f1',
            cursor: 'pointer',
            fontWeight: 600,
            borderBottomLeftRadius: 5,
            borderBottomRightRadius: 5,
          }}
        >
          + field
        </div>

        {/* Per-row connection handles (target on the left, source on the right) */}
        {fields.map((f, i) => {
          const top = HEADER_H + i * ROW_H + ROW_H / 2
          return (
            <span key={`h-${i}`}>
              <Handle id={`f-${i}-t`} type="target" position={Position.Left} style={{ ...dot, top }} />
              <Handle id={`f-${i}-s`} type="source" position={Position.Right} style={{ ...dot, top }} />
            </span>
          )
        })}
      </div>
    )
  }

  // ── Data table (CSV-like grid → Markdown table) ─────────────────────────────
  if (nodeData.isTable) {
    const cols = nodeData.columns ?? []
    const rows = nodeData.rows ?? []
    const headerBg = selected ? '#4F46E5' : (nodeData.strokeColor || '#475569')
    const fs = nodeData.fontSize ?? 11
    const cellBase: React.CSSProperties = {
      padding: '3px 6px',
      borderRight: '1px solid #eef2f7',
      borderBottom: '1px solid #eef2f7',
      fontSize: fs,
      minHeight: 20,
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    }
    const cellInput: React.CSSProperties = {
      width: '100%',
      border: '1px solid #c7d2fe',
      borderRadius: 3,
      fontSize: fs,
      padding: '0 3px',
      outline: 'none',
    }
    // Excel-style navigation between cells. Header row is index -1.
    const rowSeq = [-1, ...rows.map((_, i) => i)]
    const moveCell = (dir: 'next' | 'prev' | 'down') => {
      if (!editCell) return
      const ri = rowSeq.indexOf(editCell.r)
      if (dir === 'down') {
        const ni = Math.min(ri + 1, rowSeq.length - 1)
        if (ni === ri) { setEditCell(null); return }
        navRef.current = true
        setEditCell({ r: rowSeq[ni], c: editCell.c })
        return
      }
      let c = editCell.c + (dir === 'next' ? 1 : -1)
      let rIdx = ri
      if (c >= cols.length) { c = 0; rIdx = Math.min(ri + 1, rowSeq.length - 1) }
      if (c < 0) { c = Math.max(cols.length - 1, 0); rIdx = Math.max(ri - 1, 0) }
      navRef.current = true
      setEditCell({ r: rowSeq[rIdx], c })
    }
    const navHandler = (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Tab') { e.preventDefault(); moveCell(e.shiftKey ? 'prev' : 'next') }
      else if (e.key === 'Enter') { e.preventDefault(); moveCell('down') }
      else if (e.key === 'Escape') { e.preventDefault(); setEditCell(null) }
    }
    const cellBlur = () => {
      if (navRef.current) { navRef.current = false; return }
      setEditCell(null)
    }
    const delBtn: React.CSSProperties = {
      border: 'none',
      background: 'transparent',
      color: '#cbd5e1',
      cursor: 'pointer',
      fontSize: 12,
      lineHeight: 1,
      padding: 0,
    }
    const footBtn: React.CSSProperties = {
      flex: 1,
      border: 'none',
      background: 'transparent',
      color: '#6366f1',
      fontSize: 11,
      fontWeight: 600,
      cursor: 'pointer',
      padding: '3px 0',
    }
    return (
      <div
        className="relative w-full h-full"
        style={{
          background: nodeData.fillColor || '#ffffff',
          border: `${strokeWidth}px solid ${selected ? '#4F46E5' : strokeColor}`,
          borderRadius: 6,
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          ...dropRing,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <NodeResizer
          minWidth={180}
          minHeight={90}
          isVisible={!!selected || isHovered}
          onResizeEnd={() => pushHistory()}
        />
        {/* Title bar */}
        <div
          onDoubleClick={handleDoubleClick}
          style={{
            background: headerBg,
            color: '#fff',
            padding: '5px 8px',
            fontWeight: 700,
            fontSize: 13,
            textAlign: 'center',
            borderTopLeftRadius: 5,
            borderTopRightRadius: 5,
          }}
        >
          <NodeLabel {...labelProps} color="#ffffff" />
        </div>
        {/* Grid (left) + add-column strip (right) */}
        <div style={{ display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `16px repeat(${Math.max(cols.length, 1)}, 1fr)` }}>
          <div style={{ ...cellBase, padding: 0, background: '#f1f5f9' }} />
          {cols.map((c, ci) => (
            <div
              key={`h-${ci}`}
              className="nodrag"
              onDoubleClick={(e) => { e.stopPropagation(); setEditCell({ r: -1, c: ci }) }}
              style={{ ...cellBase, fontWeight: 700, background: '#f1f5f9', color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}
            >
              {editCell && editCell.r === -1 && editCell.c === ci ? (
                <input
                  className="nodrag"
                  autoFocus
                  value={c}
                  onChange={(e) => updateTableHeader(id, ci, e.target.value)}
                  onKeyDown={navHandler}
                  onBlur={cellBlur}
                  style={{ ...cellInput, flex: 1 }}
                />
              ) : (
                c || '—'
              )}
              {cols.length > 1 && (
                <button
                  className="nodrag"
                  title="Delete column"
                  style={delBtn}
                  onClick={(e) => { e.stopPropagation(); removeTableColumn(id, ci) }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {rows.flatMap((row, ri) => [
            <div
              key={`g-${ri}`}
              className="nodrag"
              title="Delete row"
              onClick={(e) => { e.stopPropagation(); removeTableRow(id, ri) }}
              style={{ ...cellBase, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafbfc', color: '#cbd5e1', cursor: 'pointer' }}
            >
              ×
            </div>,
            ...cols.map((_, ci) => (
              <div
                key={`${ri}-${ci}`}
                className="nodrag"
                onDoubleClick={(e) => { e.stopPropagation(); setEditCell({ r: ri, c: ci }) }}
                style={{ ...cellBase, color: textColor }}
              >
                {editCell && editCell.r === ri && editCell.c === ci ? (
                  <input
                    className="nodrag"
                    autoFocus
                    value={row[ci] ?? ''}
                    onChange={(e) => updateTableCell(id, ri, ci, e.target.value)}
                    onKeyDown={navHandler}
                    onBlur={cellBlur}
                    style={cellInput}
                  />
                ) : (
                  row[ci] || ' '
                )}
              </div>
            )),
          ])}
        </div>
        {/* Add row — full width along the bottom of the grid */}
        <button
          className="nodrag"
          title="Add row"
          onClick={(e) => { e.stopPropagation(); addTableRow(id) }}
          style={{ ...footBtn, width: '100%', borderTop: '1px solid #eef2f7', borderBottomLeftRadius: 5 }}
        >
          + row
        </button>
        </div>
        {/* Add column — vertical strip on the right, next to the table */}
        <button
          className="nodrag"
          title="Add column"
          onClick={(e) => { e.stopPropagation(); addTableColumn(id) }}
          style={{
            width: 26,
            borderLeft: '1px solid #eef2f7',
            background: 'transparent',
            color: '#6366f1',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
            borderBottomRightRadius: 5,
          }}
        >
          +
        </button>
        </div>
        <NodeHandles />
      </div>
    )
  }

  // ── Subgraph container ─────────────────────────────────────────────────────
  if (nodeData.isSubgraph) {
    return (
      <div
        className="relative w-full h-full rounded-xl"
        style={{
          border: isDropTarget ? '2px solid #4F46E5' : `2px dashed ${strokeColor}`,
          backgroundColor: isDropTarget
            ? 'rgba(79,70,229,0.12)'
            : nodeData.fillColor
              ? nodeData.fillColor
              : 'rgba(59,130,246,0.04)',
          transition: 'background-color 0.12s, border-color 0.12s',
          // The empty interior is click-through, so dragging in it pans/selects
          // the canvas (incl. right-drag) just like the open canvas. Interactive
          // bits below opt back in via pointer-events.
          pointerEvents: 'none',
        }}
      >
        <NodeResizer minWidth={200} minHeight={120} isVisible={!!selected} />
        {/* Title bar — select, drag, and rename the group here */}
        <div
          className={`absolute top-0 left-0 right-0 flex items-center px-3 text-xs font-semibold text-gray-500 ${editing ? '' : 'select-none'}`}
          style={{ height: 26, pointerEvents: 'all', cursor: 'move' }}
          onDoubleClick={handleDoubleClick}
        >
          <NodeLabel {...labelProps} color={textColor} />
        </div>
        <NodeHandles />
      </div>
    )
  }

  // ── SVG-backed shapes ──────────────────────────────────────────────────────
  if (IS_SVG_SHAPE.has(shape)) {
    const Renderer = SVG_RENDERERS[shape]!
    const isCylinder = shape === 'cylinder'
    return (
      <div
        className="relative cursor-pointer select-none"
        style={{
          width: '100%',
          height: '100%',
          minWidth: 130,
          minHeight: isCylinder ? 80 : 54,
          ...dropRing,
        }}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <NodeResizer
          minWidth={80}
          minHeight={isCylinder ? 60 : 54}
          isVisible={!!selected || isHovered}
          onResizeEnd={() => pushHistory()}
        />
        <svg
          className="absolute inset-0 w-full h-full overflow-visible"
          viewBox={isCylinder ? '0 0 200 120' : '0 0 200 100'}
          preserveAspectRatio="none"
        >
          <Renderer fill={fillColor} stroke={strokeColor} sw={strokeWidth} />
        </svg>
        <div
          className="relative z-10 flex items-center justify-center w-full h-full px-8 py-3"
          style={{ height: '100%', minHeight: isCylinder ? 80 : 54 }}
        >
          <NodeLabel {...labelProps} />
        </div>
        <NodeHandles />
      </div>
    )
  }

  // ── CSS-based shapes (rectangle, rounded, stadium, subroutine, circle, double-circle) ──
  const baseStyle: React.CSSProperties = {
    backgroundColor: fillColor,
    border: `${strokeWidth}px solid ${strokeColor}`,
  }

  let extraStyle: React.CSSProperties = {}
  let extraClass = ''

  switch (shape) {
    case 'rounded':
      extraStyle = { borderRadius: 12 }
      break
    case 'stadium':
      extraStyle = { borderRadius: 9999, paddingLeft: 20, paddingRight: 20 }
      break
    case 'subroutine':
      extraStyle = {
        borderRadius: 3,
        outline: `2px solid ${strokeColor}`,
        outlineOffset: 4,
      }
      break
    case 'circle':
      extraStyle = { borderRadius: '50%' }
      extraClass = '!min-w-[80px] !min-h-[80px] !aspect-square'
      break
    case 'double-circle':
      extraStyle = {
        borderRadius: '50%',
        boxShadow: `0 0 0 3px ${fillColor}, 0 0 0 5px ${strokeColor}`,
      }
      extraClass = '!min-w-[80px] !min-h-[80px] !aspect-square'
      break
    default: // rectangle
      extraStyle = { borderRadius: 4 }
  }

  const isCircleShape = shape === 'circle' || shape === 'double-circle'

  return (
    <div
      className={`relative flex items-center justify-center px-4 py-2.5 cursor-pointer select-none min-w-[100px] ${extraClass}`}
      style={{ ...baseStyle, ...extraStyle, height: '100%', ...dropRing }}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <NodeResizer
        minWidth={80}
        minHeight={isCircleShape ? 80 : 40}
        isVisible={!!selected || isHovered}
        onResizeEnd={() => pushHistory()}
      />
      <NodeHandles />
      <NodeLabel {...labelProps} />
    </div>
  )
}
