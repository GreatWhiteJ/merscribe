'use client'

import { useEffect, useRef } from 'react'
import { useFlowStore } from '@/lib/store'
import { parseDocument } from '@/lib/parser'
import { autoArrange } from '@/lib/mermaidLayout'

// Embed build only (jarrettwhite.com iframe). The browser build otherwise opens
// to a blank canvas — fine for the desktop app (it restores your file), but a
// bare canvas is a poor first impression for a live demo. So seed the same
// playful welcome board the desktop app ships (the Bridgekeeper's Bridge of
// Death from Monty Python and the Holy Grail) — it shows off a colored
// flowchart, a subgraph, a data table, and attached/free notes all at once.
// Kept in sync with electron/welcome.md; onboarding tips lightly updated.
// Gated on the compile-time EMBED flag so nothing about the default build changes.
const EMBED = process.env.NEXT_PUBLIC_EMBED === '1'

const DEFAULT_DOC = `\`\`\`mermaid
flowchart TD
  start(["Halt! Who would cross the Bridge of Death?"])
  cross(["You may cross. Off you go!"])
  gorge["Hurled into the Gorge of Eternal Peril"]
  facts[["Swallow Airspeed"]]
  welcome>"Welcome to MerScribe"]
  subgraph qs ["The Bridgekeeper's Three Questions"]
    q1{{"What is your name?"}}
    q2{{"What is your quest?"}}
    q3{{"What is the airspeed velocity of an unladen swallow?"}}
  end
  start --> q1
  q1 -->|"Sir Lancelot of Camelot"| q2
  q1 -->|"Um... I don't..."| gorge
  q2 -->|"To seek the Holy Grail"| q3
  q2 -->|"To, er... I forget"| gorge
  q3 -->|"About 24 mph"| cross
  q3 -->|"I don't know THAT!"| gorge
  q3 -->|"What do you mean? African or European?"| cross
  q3 -.->|"consult"| facts
  style start fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
  style cross fill:#dcfce7,stroke:#22c55e,color:#166534
  style gorge fill:#fee2e2,stroke:#ef4444,color:#991b1b
\`\`\`

### Swallow Airspeed

| Swallow | Origin | Airspeed |
| --- | --- | --- |
| African | Non-migratory | ~24 mph |
| European | Migratory | Unknown |

### Swallow Airspeed — notes

The Bridgekeeper never says *which* swallow — so answer his question with a question, and it's **he** who gets flung into the gorge.

### Welcome to MerScribe

Welcome, brave knight! 🏰

This whole board is **one Markdown file** — edit it on the canvas or in the \`.md\`, and the two stay in sync.

- Press **N** or double-click to add a node
- Drag from a node's edge to connect two nodes — or grab an arrow's endpoint to re-point it
- Drop a note onto a node to attach it (like the one on the table)
- **Auto-arrange** in the toolbar tidies everything up

🤖 **Using an AI agent?** Point it at \`merscribe-agent-guide.md\` (saved next to this diagram) — it explains how to build and edit this board from the file.`

export function EmbedSeed() {
  const done = useRef(false)
  useEffect(() => {
    if (!EMBED || done.current) return
    done.current = true
    // Never clobber a canvas that already has content (e.g. after HMR).
    if (useFlowStore.getState().nodes.length > 0) return
    const parsed = parseDocument(DEFAULT_DOC)
    if (parsed.error || parsed.nodes.length === 0) return
    const opts = {
      direction: parsed.direction,
      theme: parsed.theme,
      look: parsed.look,
      curveStyle: parsed.curveStyle,
    }
    // The parser already applies a Dagre layout, so these nodes have positions
    // and can be shown immediately — no dependency on autoArrange (which renders
    // via mermaid in the DOM and can be flaky on first paint inside an iframe).
    useFlowStore.getState().importDiagram(parsed.nodes, parsed.edges, opts)
    // Best-effort refinement to the clean Mermaid layout; ignore any failure.
    autoArrange(parsed.nodes, parsed.edges, opts)
      .then((laidOut) => {
        if (laidOut && laidOut.length) {
          useFlowStore.getState().importDiagram(laidOut, parsed.edges, opts)
        }
      })
      .catch(() => {})
  }, [])
  return null
}
