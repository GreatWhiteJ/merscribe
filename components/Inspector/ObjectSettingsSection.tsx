'use client'

import { useShallow } from 'zustand/react/shallow'
import {
  useFlowStore,
  type EdgeStyle,
  type FlowEdgeData,
  type EntityKey,
} from '@/lib/store'
import { FLOW_MARKERS, ER_ENDS, FlowMarkerGlyph, ErEndGlyph } from '@/components/EdgeTypes/EdgeMarkers'

const markerBtn = (active: boolean): React.CSSProperties => ({
  flex: 1,
  background: 'var(--neu-bg)',
  border: 'none',
  borderRadius: 8,
  boxShadow: active ? 'var(--neu-shadow-inset)' : 'var(--neu-shadow-raised)',
  padding: '5px 4px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
})

const fieldInput: React.CSSProperties = {
  background: 'var(--neu-bg)',
  border: 'none',
  borderRadius: 7,
  boxShadow: 'var(--neu-shadow-inset)',
  padding: '4px 7px',
  fontSize: 11,
  color: '#374151',
  outline: 'none',
  minWidth: 0,
}

const NEU_BG = 'var(--neu-bg)'

function NeuBtn({
  onClick,
  active,
  disabled,
  children,
  title,
}: {
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: NEU_BG,
        border: 'none',
        borderRadius: 8,
        boxShadow: active ? 'var(--neu-shadow-inset)' : 'var(--neu-shadow-raised)',
        padding: '5px 10px',
        fontSize: 11,
        fontWeight: 500,
        color: active ? '#4F46E5' : '#6B7280',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'box-shadow 0.15s',
      }}
    >
      {children}
    </button>
  )
}

function ColorSwatch({
  value,
  defaultVal,
  onChange,
  label,
}: {
  value?: string
  defaultVal: string
  onChange: (color: string) => void
  label: string
}) {
  return (
    <label
      title={label}
      aria-label={label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: value ?? defaultVal,
          boxShadow: 'var(--neu-shadow-raised)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <input
          type="color"
          defaultValue={value ?? defaultVal}
          onChange={(e) => onChange(e.target.value)}
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0,
            width: '100%',
            height: '100%',
            cursor: 'pointer',
            border: 'none',
            padding: 0,
          }}
          aria-label={label}
        />
      </div>
      <span style={{ fontSize: 9, color: '#9ca3af', letterSpacing: '0.04em' }}>{label}</span>
    </label>
  )
}

export function ObjectSettingsSection() {
  const { updateNodeStyle, updateEdgeType, updateEdgeLabel, addEntityField, updateEntityField, removeEntityField } =
    useFlowStore(
      useShallow((s) => ({
        updateNodeStyle: s.updateNodeStyle,
        updateEdgeType: s.updateEdgeType,
        updateEdgeLabel: s.updateEdgeLabel,
        addEntityField: s.addEntityField,
        updateEntityField: s.updateEntityField,
        removeEntityField: s.removeEntityField,
      }))
    )

  const allNodes = useFlowStore(useShallow((s) => s.nodes))
  const selectedNodes = useFlowStore(useShallow((s) => s.nodes.filter((n) => n.selected)))
  const selectedEdges = useFlowStore(useShallow((s) => s.edges.filter((e) => e.selected)))

  const hasNodeSelection = selectedNodes.length > 0
  const hasEdgeSelection = selectedEdges.length > 0

  const firstEdgeData = hasEdgeSelection ? (selectedEdges[0].data as FlowEdgeData | undefined) : undefined
  const activeEdgeStyle = firstEdgeData?.edgeStyle ?? 'solid'
  const startMarker = firstEdgeData?.startMarker ?? 'none'
  const endMarker = firstEdgeData?.endMarker ?? 'arrow'
  const erStart = firstEdgeData?.erStart ?? 'one'
  const erEnd = firstEdgeData?.erEnd ?? 'zero-many'

  // Left/Right are the actual on-screen ends. The source end may be visually on
  // the right, so each end maps to whichever underlying field (start/source or
  // end/target) currently sits on that side.
  const centerX = (n: (typeof allNodes)[number]) => {
    let x = n.position.x
    if (n.parentId) {
      const p = allNodes.find((m) => m.id === n.parentId)
      if (p) x += p.position.x
    }
    const w = (n.measured?.width as number | undefined) ?? (typeof n.style?.width === 'number' ? n.style.width : 150)
    return x + w / 2
  }
  const sourceIsLeft = (edge: (typeof selectedEdges)[number]) => {
    const s = allNodes.find((n) => n.id === edge.source)
    const t = allNodes.find((n) => n.id === edge.target)
    if (!s || !t) return true
    return centerX(s) <= centerX(t)
  }
  const srcLeft = selectedEdges[0] ? sourceIsLeft(selectedEdges[0]) : true
  const leftMarker = srcLeft ? startMarker : endMarker
  const rightMarker = srcLeft ? endMarker : startMarker
  const leftEr = srcLeft ? erStart : erEnd
  const rightEr = srcLeft ? erEnd : erStart

  // A single selected entity gets a field editor.
  const singleEntity =
    selectedNodes.length === 1 && selectedNodes[0].data.isEntity ? selectedNodes[0] : null

  // An edge is an ERD relationship only when both endpoints are entities.
  const isErEdge =
    hasEdgeSelection &&
    selectedEdges.every((e) => {
      const s = allNodes.find((n) => n.id === e.source)
      const t = allNodes.find((n) => n.id === e.target)
      return !!s?.data.isEntity && !!t?.data.isEntity
    })

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: '#9ca3af',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 10,
  }

  if (!hasNodeSelection && !hasEdgeSelection) {
    return (
      <div>
        <div style={sectionLabelStyle}>Object Settings</div>
        <div
          style={{
            background: NEU_BG,
            borderRadius: 14,
            boxShadow: 'var(--neu-shadow-concave)',
            padding: '24px 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 24, opacity: 0.3 }}>◻</div>
          <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', lineHeight: 1.5 }}>
            Click an object to edit its color, text size, and more
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={sectionLabelStyle}>Object Settings</div>

      {/* Node Properties */}
      {hasNodeSelection && (
        <div
          style={{
            background: NEU_BG,
            borderRadius: 14,
            boxShadow: 'var(--neu-shadow-concave)',
            padding: '14px',
            marginBottom: hasEdgeSelection ? 10 : 0,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
            {selectedNodes.length === 1 ? '1 node selected' : `${selectedNodes.length} nodes selected`}
          </div>

          {/* Color swatches */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
            <ColorSwatch
              key={selectedNodes.map(n => n.id).join('-') + '-fill'}
              value={selectedNodes[0].data.fillColor}
              defaultVal="#ffffff"
              label="Fill"
              onChange={(color) => selectedNodes.forEach((n) => updateNodeStyle(n.id, { fillColor: color }))}
            />
            <ColorSwatch
              key={selectedNodes.map(n => n.id).join('-') + '-stroke'}
              value={selectedNodes[0].data.strokeColor}
              defaultVal="#9ca3af"
              label="Border"
              onChange={(color) => selectedNodes.forEach((n) => updateNodeStyle(n.id, { strokeColor: color }))}
            />
            <ColorSwatch
              key={selectedNodes.map(n => n.id).join('-') + '-text'}
              value={selectedNodes[0].data.textColor}
              defaultVal="#1f2937"
              label="Text"
              onChange={(color) => selectedNodes.forEach((n) => updateNodeStyle(n.id, { textColor: color }))}
            />
          </div>

          {/* Text size */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: '#9ca3af' }}>Text size</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
              <NeuBtn
                title="Smaller text"
                onClick={() => selectedNodes.forEach((n) =>
                  updateNodeStyle(n.id, { fontSize: Math.max(8, (n.data.fontSize ?? 14) - 2) }))}
              >
                A−
              </NeuBtn>
              <input
                type="number"
                min={6}
                max={120}
                value={selectedNodes[0].data.fontSize ?? 14}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!Number.isNaN(v)) {
                    const clamped = Math.max(6, Math.min(120, v))
                    selectedNodes.forEach((n) => updateNodeStyle(n.id, { fontSize: clamped }))
                  }
                }}
                style={{ ...fieldInput, width: 48, textAlign: 'center' }}
                aria-label="Font size"
              />
              <NeuBtn
                title="Larger text"
                onClick={() => selectedNodes.forEach((n) =>
                  updateNodeStyle(n.id, { fontSize: Math.min(48, (n.data.fontSize ?? 14) + 2) }))}
              >
                A+
              </NeuBtn>
            </div>
          </div>

          <NeuBtn
            onClick={() => selectedNodes.forEach((n) =>
              updateNodeStyle(n.id, { fillColor: undefined, strokeColor: undefined, textColor: undefined, fontSize: undefined })
            )}
          >
            Reset style
          </NeuBtn>
        </div>
      )}

      {/* Entity / table field editor */}
      {singleEntity && (
        <div
          style={{
            background: NEU_BG,
            borderRadius: 14,
            boxShadow: 'var(--neu-shadow-concave)',
            padding: '14px',
            marginBottom: hasEdgeSelection ? 10 : 0,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 10 }}>
            Table fields
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(singleEntity.data.fields ?? []).map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  value={f.name}
                  placeholder="name"
                  onChange={(e) => updateEntityField(singleEntity.id, i, { name: e.target.value })}
                  style={{ ...fieldInput, flex: 2 }}
                  aria-label="Field name"
                />
                <input
                  value={f.type}
                  placeholder="type"
                  onChange={(e) => updateEntityField(singleEntity.id, i, { type: e.target.value })}
                  style={{ ...fieldInput, flex: 2 }}
                  aria-label="Field type"
                />
                <select
                  value={f.key}
                  onChange={(e) =>
                    updateEntityField(singleEntity.id, i, { key: e.target.value as EntityKey })
                  }
                  style={{ ...fieldInput, flex: 1 }}
                  aria-label="Field key"
                >
                  <option value="">—</option>
                  <option value="PK">PK</option>
                  <option value="FK">FK</option>
                  <option value="UK">UK</option>
                </select>
                <button
                  onClick={() => removeEntityField(singleEntity.id, i)}
                  title="Remove field"
                  aria-label="Remove field"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                    padding: '0 2px',
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <NeuBtn onClick={() => addEntityField(singleEntity.id)}>+ Add field</NeuBtn>
          </div>
        </div>
      )}

      {/* Edge Properties */}
      {hasEdgeSelection && (
        <div
          style={{
            background: NEU_BG,
            borderRadius: 14,
            boxShadow: 'var(--neu-shadow-concave)',
            padding: '14px',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
            {selectedEdges.length === 1 ? '1 edge selected' : `${selectedEdges.length} edges selected`}
          </div>

          {isErEdge ? (
            <>
              {/* Crow's-foot cardinality, independent per end (icons point outward) */}
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>Left end</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {ER_ENDS.map(({ key, label }) => (
                  <button key={key} title={label} aria-label={`Left: ${label}`}
                    onClick={() => selectedEdges.forEach((e) => updateEdgeType(e.id, sourceIsLeft(e) ? { erStart: key } : { erEnd: key }))}
                    style={markerBtn(leftEr === key)}>
                    <ErEndGlyph kind={key} side="left" color={leftEr === key ? '#4F46E5' : '#6b7280'} />
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>Right end</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {ER_ENDS.map(({ key, label }) => (
                  <button key={key} title={label} aria-label={`Right: ${label}`}
                    onClick={() => selectedEdges.forEach((e) => updateEdgeType(e.id, sourceIsLeft(e) ? { erEnd: key } : { erStart: key }))}
                    style={markerBtn(rightEr === key)}>
                    <ErEndGlyph kind={key} side="right" color={rightEr === key ? '#4F46E5' : '#6b7280'} />
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>Line</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <NeuBtn active={activeEdgeStyle !== 'dashed'} title="Identifying (solid)"
                  onClick={() => selectedEdges.forEach((e) => updateEdgeType(e.id, { edgeStyle: 'solid' }))}>
                  Identifying
                </NeuBtn>
                <NeuBtn active={activeEdgeStyle === 'dashed'} title="Non-identifying (dashed)"
                  onClick={() => selectedEdges.forEach((e) => updateEdgeType(e.id, { edgeStyle: 'dashed' }))}>
                  Non-identifying
                </NeuBtn>
              </div>

              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>Label</div>
              <input
                value={typeof selectedEdges[0].label === 'string' ? selectedEdges[0].label : ''}
                placeholder="relates"
                onChange={(e) => selectedEdges.forEach((ed) => updateEdgeLabel(ed.id, e.target.value))}
                style={{ ...fieldInput, width: '100%' }}
                aria-label="Relationship label"
              />
            </>
          ) : (
            <>
              {/* Label */}
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>Label</div>
              <input
                value={typeof selectedEdges[0].label === 'string' ? selectedEdges[0].label : ''}
                placeholder="e.g. Yes / No"
                onChange={(e) => selectedEdges.forEach((ed) => updateEdgeLabel(ed.id, e.target.value))}
                style={{ ...fieldInput, width: '100%', marginBottom: 12 }}
                aria-label="Edge label"
              />

              {/* Line style */}
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>Line style</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {(['solid', 'dashed', 'thick'] as EdgeStyle[]).map((style) => (
                  <NeuBtn
                    key={style}
                    onClick={() => selectedEdges.forEach((e) => updateEdgeType(e.id, { edgeStyle: style }))}
                    active={activeEdgeStyle === style}
                    title={`${style} line`}
                  >
                    {style}
                  </NeuBtn>
                ))}
              </div>

              {/* End markers — icons point outward (left end points left) */}
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>Left end</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {FLOW_MARKERS.map(({ key, label }) => (
                  <button key={key} title={label} aria-label={`Left: ${label}`}
                    onClick={() => selectedEdges.forEach((e) => updateEdgeType(e.id, sourceIsLeft(e) ? { startMarker: key } : { endMarker: key }))}
                    style={markerBtn(leftMarker === key)}>
                    <FlowMarkerGlyph kind={key} side="left" color={leftMarker === key ? '#4F46E5' : '#6b7280'} />
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>Right end</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {FLOW_MARKERS.map(({ key, label }) => (
                  <button key={key} title={label} aria-label={`Right: ${label}`}
                    onClick={() => selectedEdges.forEach((e) => updateEdgeType(e.id, sourceIsLeft(e) ? { endMarker: key } : { startMarker: key }))}
                    style={markerBtn(rightMarker === key)}>
                    <FlowMarkerGlyph kind={key} side="right" color={rightMarker === key ? '#4F46E5' : '#6b7280'} />
                  </button>
                ))}
              </div>

              {/* Edge color */}
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 8 }}>Color</div>
              <ColorSwatch
                key={selectedEdges.map(e => e.id).join('-')}
                value={(selectedEdges[0].data as FlowEdgeData | undefined)?.strokeColor}
                defaultVal="#9ca3af"
                label="Edge color"
                onChange={(color) => selectedEdges.forEach((e) => updateEdgeType(e.id, { strokeColor: color }))}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
