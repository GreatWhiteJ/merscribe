'use client'

import type { FlowMarker, ErEnd } from '@/lib/store'

// Markers use SVG2 `context-stroke`/`context-fill` so they inherit each edge's
// colour, and userSpaceOnUse so their size is independent of stroke width.

/** Injected once into the document; edges reference these via url(#id). */
export function EdgeMarkerDefs() {
  const cs = 'context-stroke'
  return (
    <svg width="0" height="0" style={{ position: 'absolute', overflow: 'hidden' }} aria-hidden>
      <defs>
        {/* ── Flowchart end markers ── */}
        <marker id="fm-arrow" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13"
          viewBox="0 0 12 12" refX="10" refY="6" orient="auto-start-reverse">
          <path d="M2,2 L11,6 L2,10 Z" fill={cs} stroke={cs} strokeWidth="1" strokeLinejoin="round" />
        </marker>
        <marker id="fm-circle" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13"
          viewBox="0 0 12 12" refX="6" refY="6" orient="auto">
          <circle cx="6" cy="6" r="4" fill="#ffffff" stroke={cs} strokeWidth="1.5" />
        </marker>
        <marker id="fm-cross" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13"
          viewBox="0 0 12 12" refX="6" refY="6" orient="auto">
          <path d="M3,3 L9,9 M3,9 L9,3" stroke={cs} strokeWidth="1.8" strokeLinecap="round" />
        </marker>

        {/* ── ER crow's-foot markers (drawn for the target end; start auto-reverses) ── */}
        <marker id="er-one" markerUnits="userSpaceOnUse" markerWidth="28" markerHeight="24"
          viewBox="0 0 28 24" refX="24" refY="12" orient="auto-start-reverse">
          <path d="M16,4 L16,20 M22,4 L22,20" stroke={cs} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
        <marker id="er-zero-one" markerUnits="userSpaceOnUse" markerWidth="28" markerHeight="24"
          viewBox="0 0 28 24" refX="24" refY="12" orient="auto-start-reverse">
          <circle cx="9" cy="12" r="4.5" fill="#ffffff" stroke={cs} strokeWidth="1.5" />
          <path d="M21,4 L21,20" stroke={cs} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
        <marker id="er-zero-many" markerUnits="userSpaceOnUse" markerWidth="28" markerHeight="24"
          viewBox="0 0 28 24" refX="26" refY="12" orient="auto-start-reverse">
          <circle cx="6" cy="12" r="4.5" fill="#ffffff" stroke={cs} strokeWidth="1.5" />
          <path d="M14,12 L26,3 M14,12 L26,12 M14,12 L26,21" stroke={cs} strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </marker>
        <marker id="er-one-many" markerUnits="userSpaceOnUse" markerWidth="28" markerHeight="24"
          viewBox="0 0 28 24" refX="26" refY="12" orient="auto-start-reverse">
          <path d="M9,4 L9,20" stroke={cs} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M14,12 L26,3 M14,12 L26,12 M14,12 L26,21" stroke={cs} strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </marker>
      </defs>
    </svg>
  )
}

export const flowMarkerUrl = (m: FlowMarker): string | undefined =>
  m === 'none' ? undefined : `url(#fm-${m})`
export const erMarkerUrl = (m: ErEnd): string => `url(#er-${m})`

// ── Inspector glyphs: a short line with the marker on its right end ──
export const FLOW_MARKERS: { key: FlowMarker; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'arrow', label: 'Arrow' },
  { key: 'circle', label: 'Circle' },
  { key: 'cross', label: 'Cross' },
]
export const ER_ENDS: { key: ErEnd; label: string }[] = [
  { key: 'one', label: 'One' },
  { key: 'zero-one', label: 'Zero or one' },
  { key: 'one-many', label: 'One or many' },
  { key: 'zero-many', label: 'Zero or many' },
]

type Side = 'left' | 'right'

export function FlowMarkerGlyph({ kind, color = 'currentColor', side = 'right' }: { kind: FlowMarker; color?: string; side?: Side }) {
  return (
    <svg width="42" height="18" viewBox="0 0 42 18">
      <g transform={side === 'left' ? 'translate(42,0) scale(-1,1)' : undefined}>
        <line x1="2" y1="9" x2="30" y2="9" stroke={color} strokeWidth="1.6" />
        {kind === 'arrow' && <path d="M30,3 L40,9 L30,15 Z" fill={color} />}
        {kind === 'circle' && <circle cx="35" cy="9" r="4.5" fill="#fff" stroke={color} strokeWidth="1.6" />}
        {kind === 'cross' && <path d="M31,5 L39,13 M31,13 L39,5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />}
      </g>
    </svg>
  )
}

export function ErEndGlyph({ kind, color = 'currentColor', side = 'right' }: { kind: ErEnd; color?: string; side?: Side }) {
  return (
    <svg width="44" height="20" viewBox="0 0 44 20">
      <g transform={side === 'left' ? 'translate(44,0) scale(-1,1)' : undefined}>
        <line x1="2" y1="10" x2="26" y2="10" stroke={color} strokeWidth="1.6" />
        {(kind === 'one') && <path d="M30,4 L30,16 M36,4 L36,16" stroke={color} strokeWidth="1.6" strokeLinecap="round" />}
        {(kind === 'zero-one') && <><circle cx="28" cy="10" r="4" fill="#fff" stroke={color} strokeWidth="1.5" /><path d="M37,4 L37,16" stroke={color} strokeWidth="1.6" strokeLinecap="round" /></>}
        {(kind === 'one-many') && <><path d="M28,4 L28,16" stroke={color} strokeWidth="1.6" strokeLinecap="round" /><path d="M30,10 L42,3 M30,10 L42,10 M30,10 L42,17" stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" /></>}
        {(kind === 'zero-many') && <><circle cx="26" cy="10" r="4" fill="#fff" stroke={color} strokeWidth="1.5" /><path d="M32,10 L42,3 M32,10 L42,10 M32,10 L42,17" stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" /></>}
      </g>
    </svg>
  )
}
