'use client'

import { useState } from 'react'
import { useFlowStore } from '@/lib/store'

// Shown when the linked .md can't be parsed into a diagram (bad or unsupported
// syntax). Rather than silently opening a blank canvas, we warn and hand the
// user a ready-to-paste bundle (the error + the file's contents + what MerScribe
// can read) to give their LLM so it can repair the file.
function buildLlmPayload(message: string, content: string): string {
  return `MerScribe could not render this Markdown diagram file. Please fix it.

PROBLEM:
${message}

WHAT MERSCRIBE CAN READ (everything else is ignored):
- A fenced \`\`\`mermaid block containing a \`flowchart\` (TD/LR/BT/RL) and/or an \`erDiagram\`.
- Node shapes: ["rect"], ("rounded"), (["stadium"]), {{"hexagon"}}, [("cylinder")], (("circle")), [["table title"]], >"note title"].
- Edges: -->, ---, -.->, ==>, with optional |"label"|.
- Groups: subgraph id ["Title"] ... end.
- erDiagram entities with typed fields and PK/FK/UK, and crow's-foot relationships.
- "### Title" sections holding a GitHub-flavored table (for [["Title"]] table nodes) or prose (for notes / "### Title — notes").
- Optional Mermaid style/linkStyle/classDef/class lines for color.

Do NOT add other Markdown constructs, other Mermaid diagram types, HTML, or prose outside the sections above — MerScribe will drop them.

CURRENT FILE CONTENTS:
--------------------------------------------------
${content}
--------------------------------------------------

Return the corrected full file.`
}

export function LoadErrorModal() {
  const loadError = useFlowStore((s) => s.loadError)
  const setLoadError = useFlowStore((s) => s.setLoadError)
  const [copied, setCopied] = useState(false)

  if (!loadError) return null

  const copyForLlm = async () => {
    const payload = buildLlmPayload(loadError.message, loadError.content)
    try {
      await navigator.clipboard.writeText(payload)
    } catch {
      // Clipboard API can be blocked; fall back to a hidden textarea + execCommand.
      const ta = document.createElement('textarea')
      ta.value = payload
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-auto"
      onClick={(e) => { if (e.target === e.currentTarget) setLoadError(null) }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col border border-gray-200/60"
        role="alertdialog"
        aria-labelledby="load-error-title"
        aria-describedby="load-error-desc"
        aria-modal="true"
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
          <div className="mt-0.5 text-amber-500" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 id="load-error-title" className="text-sm font-semibold text-gray-900">This file couldn&apos;t be rendered</h2>
            <p id="load-error-desc" className="text-xs text-gray-500 mt-0.5">
              The Markdown has invalid or unsupported syntax, so the canvas was left as it was. Your file on disk was not changed.
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">What went wrong</div>
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 font-mono whitespace-pre-wrap break-words">
              {loadError.message}
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Use <span className="font-semibold text-gray-700">Copy for LLM</span> to put the error and the full file on your clipboard, then paste it to your AI agent and ask it to fix the file.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl">
          <button
            onClick={() => setLoadError(null)}
            className="px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Dismiss
          </button>
          <button
            onClick={copyForLlm}
            className="px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {copied ? 'Copied ✓' : 'Copy for LLM'}
          </button>
        </div>
      </div>
    </div>
  )
}
