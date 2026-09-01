'use client'

import { useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { Canvas } from '@/components/Canvas'
import { TopToolbar } from '@/components/TopToolbar'
import { ZoomControls } from '@/components/ZoomControls'
import { InspectorPanel } from '@/components/Inspector/InspectorPanel'
import { CommandPalette } from '@/components/CommandPalette'
import { LoadErrorModal } from '@/components/LoadErrorModal'
import { EmbedSeed } from '@/components/EmbedSeed'
import { useFlowStore } from '@/lib/store'
import { serializeDocument } from '@/lib/serializer'

function EditorContent() {
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const { nodes, edges, direction, theme, look, curveStyle } = useFlowStore()
  const syntax = serializeDocument(nodes, edges, { direction, theme, look, curveStyle })

  return (
    <div
      style={{
        position: 'relative',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        display: 'flex',
        background: 'var(--neu-bg)',
      }}
    >
      {/* Canvas zone */}
      <div style={{ position: 'relative', flex: 1, background: 'var(--neu-bg)' }}>
        <Canvas onOpenPalette={() => setPaletteOpen(true)} />

        {/* Top overlay — toolbar */}
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          <TopToolbar
            inspectorOpen={inspectorOpen}
            onToggleInspector={() => setInspectorOpen((v) => !v)}
            onOpenPalette={() => setPaletteOpen(true)}
            syntax={syntax}
          />
        </div>

        {/* Zoom controls */}
        <ZoomControls />
      </div>

      {/* Right Inspector panel */}
      {inspectorOpen && (
        <InspectorPanel
          syntax={syntax}
          onCollapse={() => setInspectorOpen(false)}
        />
      )}

      {/* Command Palette */}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      {/* Corrupt/unsupported .md warning with a Copy-for-LLM bundle */}
      <LoadErrorModal />

      {/* Embed build only: seed a default demo diagram on first load. */}
      <EmbedSeed />
    </div>
  )
}

export default function Page() {
  return (
    <ReactFlowProvider>
      <EditorContent />
    </ReactFlowProvider>
  )
}
