'use client'

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useRef, useState, type MouseEvent, type DragEvent } from 'react'

import { useFlowStore, type FlowNodeData } from '@/lib/store'
import { FlowNode } from './NodeTypes/FlowNode'
import { FlowEdge } from './EdgeTypes/FlowEdge'
import { EdgeMarkerDefs } from './EdgeTypes/EdgeMarkers'

const nodeTypes = { flowNode: FlowNode }
const edgeTypes = { flowEdge: FlowEdge }

// ── Group geometry helpers ────────────────────────────────────────────────────
// Use the live rendered size (`measured`) so membership tracks a resized group,
// falling back to the explicit style size, then a sensible default.
function dimsOf(n: Node<FlowNodeData>, defW: number, defH: number) {
  const w = n.measured?.width ?? (typeof n.style?.width === 'number' ? n.style.width : defW)
  const h = n.measured?.height ?? (typeof n.style?.height === 'number' ? n.style.height : defH)
  return { w, h }
}

// Absolute center of a node, resolving a parent-relative position if needed.
function absCenter(n: Node<FlowNodeData>, all: Node<FlowNodeData>[]) {
  const { w, h } = dimsOf(n, 150, 60)
  let x = n.position.x
  let y = n.position.y
  if (n.parentId) {
    const p = all.find((m) => m.id === n.parentId)
    if (p) {
      x += p.position.x
      y += p.position.y
    }
  }
  return { cx: x + w / 2, cy: y + h / 2 }
}

// The group whose bounds contain (cx, cy). Smallest matching group wins so
// behavior stays predictable when groups overlap.
function groupAt(
  all: Node<FlowNodeData>[],
  cx: number,
  cy: number,
  excludeId: string,
): string | null {
  let best: { id: string; area: number } | null = null
  for (const sg of all) {
    if (!sg.data.isSubgraph || sg.id === excludeId) continue
    const { w, h } = dimsOf(sg, 320, 220)
    if (cx >= sg.position.x && cx <= sg.position.x + w && cy >= sg.position.y && cy <= sg.position.y + h) {
      const area = w * h
      if (!best || area < best.area) best = { id: sg.id, area }
    }
  }
  return best?.id ?? null
}

// Absolute bounds of a node, resolving a parent-relative position.
function absBounds(n: Node<FlowNodeData>, all: Node<FlowNodeData>[]) {
  const { w, h } = dimsOf(n, 150, 60)
  let x = n.position.x
  let y = n.position.y
  if (n.parentId) {
    const p = all.find((m) => m.id === n.parentId)
    if (p) {
      x += p.position.x
      y += p.position.y
    }
  }
  return { x, y, w, h }
}

// The non-note, non-subgraph node a sticky note overlaps the most — even just
// touching an edge counts. The node with the largest overlap wins.
function nodeOverlapping(
  all: Node<FlowNodeData>[],
  note: Node<FlowNodeData>,
  excludeId: string,
): string | null {
  const a = absBounds(note, all)
  let best: { id: string; area: number } | null = null
  for (const n of all) {
    if (n.id === excludeId || n.data.isNote || n.data.isSubgraph) continue
    const b = absBounds(n, all)
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    if (ix > 0 && iy > 0) {
      const area = ix * iy
      if (!best || area > best.area) best = { id: n.id, area }
    }
  }
  return best?.id ?? null
}

interface CanvasInnerProps {
  onOpenPalette?: () => void
}

function CanvasInner({ onOpenPalette }: CanvasInnerProps) {
  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    addNode, addNodeAtPosition,
    addNote, addTable, addSubgraph, addEntity,
    undo, redo, duplicateSelected, copySelected, pasteClipboard,
    pushHistory, assignToSubgraph,
    drawingShape, setDrawingShape,
    setDropTargetId, setSpawnCenter,
  } = useFlowStore()
  const { screenToFlowPosition } = useReactFlow()

  // ── Draw-mode state ─────────────────────────────────────────────────────────
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

      // Escape → cancel draw mode
      if (e.key === 'Escape') {
        setDrawingShape(null)
        setDragStart(null)
        setDragCurrent(null)
        return
      }

      // N → add node (when not typing)
      if (!isTyping && (e.key === 'n' || e.key === 'N')) {
        addNode()
        return
      }

      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+Z → undo
      if (ctrl && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo()
        return
      }

      // Ctrl+Shift+Z or Ctrl+Y → redo
      if ((ctrl && e.shiftKey && e.key === 'z') || (ctrl && e.key === 'y')) {
        e.preventDefault()
        redo()
        return
      }

      // Ctrl+D → duplicate selected
      if (ctrl && e.key === 'd') {
        e.preventDefault()
        duplicateSelected()
        return
      }

      // Ctrl+C → copy selected
      if (ctrl && !e.shiftKey && e.key === 'c') {
        e.preventDefault()
        copySelected()
        return
      }

      // Ctrl+V → paste clipboard
      if (ctrl && !e.shiftKey && e.key === 'v') {
        e.preventDefault()
        pasteClipboard()
        return
      }

      // Ctrl+K / Meta+K → open command palette
      if (ctrl && e.key === 'k') {
        e.preventDefault()
        onOpenPalette?.()
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [addNode, undo, redo, duplicateSelected, copySelected, pasteClipboard, setDrawingShape, onOpenPalette])

  // ── Double-click on blank canvas → add node at cursor ─────────────────────
  const handleDoubleClick = (e: MouseEvent) => {
    if (drawingShape) return
    const target = e.target as Element
    if (target.closest('.react-flow__node')) return
    if (target.closest('.react-flow__edge')) return
    if (target.closest('.react-flow__controls')) return
    if (target.closest('.react-flow__minimap')) return
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addNodeAtPosition(position)
  }

  // ── Draw-mode mouse handlers ────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!drawingShape) return
      const target = e.target as Element
      if (target.closest('.react-flow__node')) return
      if (target.closest('.react-flow__controls')) return
      if (target.closest('.react-flow__minimap')) return
      e.preventDefault()
      setDragStart({ x: e.clientX, y: e.clientY })
      setDragCurrent({ x: e.clientX, y: e.clientY })
    },
    [drawingShape],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragStart) return
      setDragCurrent({ x: e.clientX, y: e.clientY })
    },
    [dragStart],
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragStart || !drawingShape) return
      const end = { x: e.clientX, y: e.clientY }

      const dx = Math.abs(end.x - dragStart.x)
      const dy = Math.abs(end.y - dragStart.y)

      const flowStart = screenToFlowPosition({ x: dragStart.x, y: dragStart.y })
      const flowEnd = screenToFlowPosition({ x: end.x, y: end.y })

      if (dx < 20 && dy < 20) {
        // Single click — create default-sized node
        addNodeAtPosition(flowStart, drawingShape)
      } else {
        const x = Math.min(flowStart.x, flowEnd.x)
        const y = Math.min(flowStart.y, flowEnd.y)
        const w = Math.abs(flowEnd.x - flowStart.x)
        const h = Math.abs(flowEnd.y - flowStart.y)
        addNodeAtPosition({ x, y }, drawingShape, w, h)
      }

      setDragStart(null)
      setDragCurrent(null)
      setDrawingShape(null)
    },
    [dragStart, drawingShape, screenToFlowPosition, addNodeAtPosition, setDrawingShape],
  )

  // ── Drag-and-drop new objects from the toolbar onto the canvas ──────────────
  const handleDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes('application/mfe-object')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      const raw = e.dataTransfer.getData('application/mfe-object')
      if (!raw) return
      e.preventDefault()
      let data: { kind: string; shape?: string }
      try { data = JSON.parse(raw) } catch { return }
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      switch (data.kind) {
        case 'note': addNote(undefined, pos); break
        case 'table': addTable(undefined, pos); break
        case 'group': addSubgraph(undefined, pos); break
        case 'entity': addEntity(undefined, pos); break
        case 'shape':
          addNodeAtPosition({ x: pos.x - 60, y: pos.y - 25 }, (data.shape ?? 'rectangle') as FlowNodeData['shape'])
          break
      }
    },
    [screenToFlowPosition, addNote, addTable, addSubgraph, addEntity, addNodeAtPosition],
  )

  // ── Keep spawn point at the visible canvas center ───────────────────────────
  const updateSpawnCenter = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    const c = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    setSpawnCenter({ x: c.x, y: c.y })
  }, [screenToFlowPosition, setSpawnCenter])

  useEffect(() => {
    // Run after the initial fitView settles.
    const t = setTimeout(updateSpawnCenter, 300)
    return () => clearTimeout(t)
  }, [updateSpawnCenter])

  // ── Live drag: highlight the group the node would drop into ─────────────────
  const handleNodeDrag = useCallback(
    (_event: MouseEvent, draggedNode: Node<FlowNodeData>) => {
      const state = useFlowStore.getState()
      if (draggedNode.data.isSubgraph) {
        if (state.dropTargetId !== null) setDropTargetId(null)
        return
      }
      const all = state.nodes
      const { cx, cy } = absCenter(draggedNode, all)
      const cur = draggedNode.parentId ?? null
      let next: string | null = null
      if (draggedNode.data.isNote) {
        // A note prefers attaching to a node it overlaps; else joining a group.
        const host = nodeOverlapping(all, draggedNode, draggedNode.id)
        const target = host ?? groupAt(all, cx, cy, draggedNode.id)
        next = target && target !== cur ? target : null
      } else {
        const target = groupAt(all, cx, cy, draggedNode.id)
        next = target && target !== cur ? target : null
      }
      if (state.dropTargetId !== next) setDropTargetId(next)
    },
    [setDropTargetId]
  )

  // ── Drag end: push history and reconcile group membership ───────────────────
  const handleNodeDragStop = useCallback(
    (_event: MouseEvent, draggedNode: Node<FlowNodeData>) => {
      pushHistory()
      setDropTargetId(null)
      const all = useFlowStore.getState().nodes

      // Dragging a group itself — capture any free node/note now inside it.
      if (draggedNode.data.isSubgraph) {
        const { w: sgW, h: sgH } = dimsOf(draggedNode, 320, 220)
        const x0 = draggedNode.position.x
        const y0 = draggedNode.position.y
        const toAssign = all.filter((n) => {
          if (n.data.isSubgraph || n.parentId) return false
          const { cx, cy } = absCenter(n, all)
          return cx >= x0 && cx <= x0 + sgW && cy >= y0 && cy <= y0 + sgH
        })
        if (toAssign.length > 0) assignToSubgraph(toAssign.map((n) => n.id), draggedNode.id)
        return
      }

      const { cx, cy } = absCenter(draggedNode, all)

      // A sticky note dropped over a node attaches to it (becomes its child and
      // moves with it). Dropped elsewhere, it falls through to group handling.
      if (draggedNode.data.isNote) {
        const host = nodeOverlapping(all, draggedNode, draggedNode.id)
        if (host) {
          if (host !== (draggedNode.parentId ?? null)) assignToSubgraph([draggedNode.id], host)
          return
        }
      }

      // Any node or note: figure out which group (if any) now contains it and
      // reconcile in one step. Handles free→group, group→free, and group→group.
      const target = groupAt(all, cx, cy, draggedNode.id)
      const current = draggedNode.parentId ?? null
      if (target !== current) {
        assignToSubgraph([draggedNode.id], target)
      }
    },
    [pushHistory, assignToSubgraph, setDropTargetId]
  )

  const previewRect =
    dragStart && dragCurrent
      ? {
          left: Math.min(dragStart.x, dragCurrent.x),
          top: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null

  // Offset preview rect relative to wrapper element
  // eslint-disable-next-line react-hooks/refs
  const wrapperRect = wrapperRef.current?.getBoundingClientRect()
  const relativePreview = previewRect && wrapperRect
    ? {
        left: previewRect.left - wrapperRect.left,
        top: previewRect.top - wrapperRect.top,
        width: previewRect.width,
        height: previewRect.height,
      }
    : null

  return (
    <div
      ref={wrapperRef}
      className={`w-full h-full relative ${drawingShape ? 'cursor-crosshair' : ''}`}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        connectionMode={ConnectionMode.Loose}
        zoomOnDoubleClick={false}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={updateSpawnCenter}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        panOnDrag={drawingShape ? false : [1, 2]}
        selectionOnDrag={!drawingShape}
        multiSelectionKeyCode={['Shift', 'Control']}
        nodesDraggable={!drawingShape}
        style={{ background: 'var(--neu-bg)' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={2} color="#d1d9e6" />
      </ReactFlow>

      <EdgeMarkerDefs />

      {relativePreview && relativePreview.width > 4 && relativePreview.height > 4 && (
        <div
          className="absolute pointer-events-none border-2 border-dashed border-blue-500 bg-blue-50/30 rounded"
          style={relativePreview}
        />
      )}

      {nodes.length === 0 && !drawingShape && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-400">
            <p className="text-lg font-medium">Canvas is empty</p>
            <p className="text-sm mt-1">
                Select a shape above and drag to draw, double-click canvas, or press{' '}
              <kbd className="px-1 py-0.5 rounded bg-gray-100 text-gray-500 text-xs font-mono">N</kbd>{' '}
              to add a node. Drag on empty canvas to select multiple nodes.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export function Canvas({ onOpenPalette }: { onOpenPalette?: () => void }) {
  return <CanvasInner onOpenPalette={onOpenPalette} />
}
