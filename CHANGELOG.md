# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.8] - 2026-06-24

### Added
- **Field-level ER relationships** — a relationship now connects the foreign-key row to the primary-key row it references (not box-to-box), attaching on whichever side faces the other entity. The FK/PK fields are inferred from the crow's-foot direction plus FK comments (`factor_id FK "-> factors"`) and relationship labels.
- **ER grouping & color** — `erDiagram` blocks support `subgraph … end` groups and `style` / `classDef` + `class` coloring on entities and groups, just like flowcharts. Parsed, rendered, and round-tripped losslessly (renders in MerScribe and in plain Mermaid/GitHub).
- **Block switcher** — when a document holds more than one Mermaid block (e.g. a flowchart overview + a detailed `erDiagram`), a floating `All / Flow / ER` control shows one at a time; each block is laid out independently.
- **Classic Open / Save As** — a dedicated Open button loads an existing `.md` (no overwrite prompt), and the save-status pill is Save As. Replaces the single conflated file picker.
- **Right-angle & straight edge routing** — the canvas honors the Curve Style: `step*` → orthogonal, `linear` → straight, else curved.
- **Automatic update check** — on launch the app asks GitHub for the latest release and, if a newer one exists, offers to open the download page.
- **Agent guide companion** — `merscribe-agent-guide.md` is seeded next to the diagram on first run; the guide now covers multi-block files, field-level FK annotation, and ER grouping/colors.

### Changed
- **Tighter, domain-clustered ER layout** — each block lays out on its own, and ER entities cluster by the overview's domains when present.
- **Zoom out further** — minimum zoom lowered (0.5 → 0.05) so large schemas fit; toolbar is overflow-safe.
- **Sticky notes** fit their content (grow with text, scroll only when huge) and tuck onto a host edge offset toward the corner.

### Fixed
- **Toolbar overflow** — the Open / Save As controls could be pushed off-screen when the toolbar got crowded; the switcher moved to a floating control and the toolbar now caps width instead of clipping.
- **Phantom ER entities** — `style` / `subgraph` lines inside an `erDiagram` block were mis-parsed into junk `style`/`fill` entities; now handled correctly.

## [Unreleased]

### Added
- **Desktop app (Electron)** — local window with silent auto-save to a `.md` file (default `Downloads/diagram.md`), last-session restore on launch, and an Open-dialog file picker (no overwrite prompt).
- **Lossless Markdown round-trip** — the diagram is a single canonical `.md` document (a Mermaid `flowchart` block, optional `erDiagram` block, GFM tables, and `###` note sections). `parseDocument` imports it and `serializeDocument` exports it, so shapes, per-end markers, groups, tables, notes, and entities all survive an edit-and-reload.
- **Live file-sync (desktop)** — external edits to the linked `.md` (by a person or an AI agent) update the canvas in real time, and canvas edits write straight back. Sync is content-based: no echo-writes, no swallowed edits.
- **Notes** — free sticky notes, plus *attached* notes that nest onto a host node as a footnote, tucking into the host's most-open corner. Markdown note bodies live in the `.md`.
- **Data tables** — an editable, spreadsheet-style grid that serializes to a GitHub-flavored Markdown table.
- **ER entities & relationships** — typed fields with PK/FK/UK keys, per-field connection handles, and crow's-foot cardinality.
- **Per-end edge markers** — independent arrow / circle / cross / none on each end, plus inline edge-colored labels.
- **Auto-arrange** — toolbar action and on-structure-change relayout using Mermaid's own engine.
- **Preview badges** — tables and noted nodes show a 📋 / 📝 badge in the Mermaid Live panel instead of dumping their contents.
- **First-run example** — a friendly "Bridge of Death" welcome diagram (a group, a table, and free + attached notes) is seeded on first launch so new users start with something to explore instead of a blank canvas.

### Changed
- The canvas is no longer one-way: Mermaid is now both generated from **and** parsed back into the canvas, and the `.md` file (not the in-memory state) is the canonical artifact.
- Auto-layout switched from fixed-size Dagre to Mermaid's **size-aware** layered layout, so large tables/notes get real room and the canvas matches the live preview (crossing-free, upstream→downstream). Dagre remains a fallback.
- Windows distribution is a single **NSIS installer** (`setup.exe`) — dropped the portable `.exe`; macOS ships per-architecture `.dmg`s (Apple Silicon + Intel).

### Fixed
- Packaged desktop app launched to a **blank window** — the static UI bundle (`out/`) is `.gitignored` and electron-builder's file globbing skipped it, so nothing was bundled. Now copied via `extraResources` and resolved resiliently in `main.cjs`. Verified the shipped installer renders on Windows/macOS/Linux.

## [0.1.0] - 2026-03-08

### Added
- 14 node shapes: rectangle, rounded, stadium, subroutine, cylinder, circle, double-circle, diamond, hexagon, parallelogram, parallelogram-alt, trapezoid, trapezoid-alt, asymmetric
- 3 edge line styles (solid, dashed, thick) × 5 arrowhead types (arrow, none, bidirectional, circle, cross)
- 4 flow directions: TD, LR, BT, RL — canvas re-layouts on change via Dagre
- Undo/redo with 50-snapshot history stack (Ctrl+Z / Ctrl+Y)
- Node styling: fill color, stroke color, text color per node
- Edge styling: stroke color per edge
- 5 Mermaid themes (default, dark, forest, neutral, base) + hand-drawn look toggle
- 12 curve styles for edge routing
- Duplicate selected nodes (Ctrl+D)
- Export diagram as SVG
- Import Mermaid flowchart syntax → canvas (live parse feedback)
- Subgraphs: create, drag-assign children, rename, duplicate with children, full serialize/import round-trip
- Copy/paste nodes (Ctrl+C / Ctrl+V)
- Marquee multi-select
- Inspector panel for node/edge properties
- Toolbar with full keyboard accessibility (ARIA labels, focus management)
- `npx mermaid-visual-editor` terminal install — serves static build and opens browser
- CI workflow: lint + audit + build on every push/PR
- Release workflow: automated version bump, npm publish, GitHub Release
