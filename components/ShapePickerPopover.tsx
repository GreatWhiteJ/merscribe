'use client'

import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useFlowStore, type NodeShape } from '@/lib/store'
import { ShapeIcon, ALL_SHAPES } from '@/components/ShapeIcons'

interface ShapePickerPopoverProps {
  onClose: () => void
}

const NEU_BG = 'var(--neu-bg)'

export function ShapePickerPopover({ onClose }: ShapePickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  const { drawingShape, setDrawingShape, updateNodeShape, addEntity } = useFlowStore(
    useShallow((s) => ({
      drawingShape: s.drawingShape,
      setDrawingShape: s.setDrawingShape,
      updateNodeShape: s.updateNodeShape,
      addEntity: s.addEntity,
    }))
  )

  const selectedNodes = useFlowStore(useShallow((s) => s.nodes.filter((n) => n.selected)))
  const hasNodeSelection = selectedNodes.length > 0

  const displayShape: NodeShape =
    selectedNodes.length === 1 ? selectedNodes[0].data.shape : (drawingShape ?? 'rectangle')

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  const handleShapeClick = (shape: NodeShape) => {
    if (hasNodeSelection) {
      selectedNodes.forEach((n) => updateNodeShape(n.id, shape))
    } else {
      setDrawingShape(shape)
      onClose()
    }
  }

  const rows = [ALL_SHAPES.slice(0, 7), ALL_SHAPES.slice(7)]

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        background: NEU_BG,
        borderRadius: 20,
        boxShadow: 'var(--neu-shadow-raised)',
        padding: '16px',
        zIndex: 50,
        minWidth: 320,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.08em', marginBottom: 10, textTransform: 'uppercase' }}>
        {hasNodeSelection ? 'Change Shape' : 'Draw Shape'}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 6, marginBottom: ri === 0 ? 6 : 0 }}>
          {row.map(({ shape, label }) => {
            const isActive = hasNodeSelection
              ? selectedNodes.every((n) => n.data.shape === shape)
              : drawingShape === shape || (!drawingShape && displayShape === shape)
            return (
              <button
                key={shape}
                title={label}
                aria-label={label}
                onClick={() => handleShapeClick(shape)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/mfe-object', JSON.stringify({ kind: 'shape', shape }))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                style={{
                  width: 36,
                  height: 32,
                  borderRadius: 10,
                  border: 'none',
                  background: NEU_BG,
                  boxShadow: isActive ? 'var(--neu-shadow-inset)' : 'var(--neu-shadow-raised)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                  color: isActive ? '#4F46E5' : '#6b7280',
                }}
              >
                <ShapeIcon shape={shape} stroke={isActive ? '#4F46E5' : '#6b7280'} />
              </button>
            )
          })}
        </div>
      ))}
      {!hasNodeSelection && drawingShape && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#4F46E5', textAlign: 'center' }}>
          Click &amp; drag on canvas to draw — Esc to cancel
        </div>
      )}

      {/* Special objects */}
      <div style={{ borderTop: '1px solid rgba(163,177,198,0.3)', marginTop: 12, paddingTop: 10 }}>
        <button
          onClick={() => { addEntity(); onClose() }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/mfe-object', JSON.stringify({ kind: 'entity' }))
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title="Add an ER entity (click, or drag onto canvas)"
          style={{
            width: '100%',
            border: 'none',
            background: NEU_BG,
            boxShadow: 'var(--neu-shadow-raised)',
            borderRadius: 10,
            padding: '8px 10px',
            fontSize: 12,
            fontWeight: 600,
            color: '#6b7280',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <path d="M7 13h4M7 17h4" />
            <circle cx="16.5" cy="15.5" r="2.5" />
          </svg>
          ER Entity
        </button>
      </div>
    </div>
  )
}
