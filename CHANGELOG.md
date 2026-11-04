# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Labeled edges were invisible** — any edge with a label (e.g. `a -->|"yes"| b`) drew its label but not its line. The label-gap mask had no explicit region, so with `userSpaceOnUse` it defaulted to a percentage of React Flow's near-zero-size edge SVG and clipped the whole stroke. The mask now spans the canvas.
- **Arrowheads sit on the line's end** — the line used to run under the arrowhead to the node edge, so on curved edges the stroke cut through the triangle at an angle. The arrow is now anchored at its base and the path stops one arrow-length short of the node: the line flows into the triangle's base and the tip touches the node.
- **Connections from a top or left dot vanished** — dragging out of a node's top or left dot and dropping on another top or left dot showed the line while dragging, then nothing. React Flow reversed the connection, gave the edge a target dot as its source, and never drew it (the invisible edge still reached the `.md` as a reversed `b --> a`). Every side now has a source dot stacked over its target dot, so any dot-to-dot drag connects and the arrow runs the way you dragged.
- **Arrows to and from groups now shape the layout** — Auto-arrange dropped every edge that touched a subgraph (Dagre can't rank a cluster), so a group-to-group flow (`a --> grp`, `grp --> b`) laid the groups out side by side with long crossing arrows. Like Mermaid, such an edge now stands in the group's entry nodes (edges in) or exit nodes (edges out), so the canvas stacks the way the Mermaid preview does.
- **Auto-arrange keeps groups out of unrelated lines** — Dagre places groups as clusters but knows nothing about the curves the canvas draws, so a long edge (e.g. a "no" that skips a whole group) could run straight across a group holding neither of its ends. Auto-arrange now treats each top-level group as a solid object: when an edge's curve would cross a group it doesn't belong to, the group (with its contents) slides sideways until the curve clears it, and anything it would then overlap is pushed along. Only positions change; edges are still plain curves.

## [0.1.11] - 2026-09-14

### Added
- **New document** — a **New** button (Ctrl+N) starts a blank diagram, linking a fresh `untitled.md` next to the current file (created on your first change, so it never litters empty files).
- **Recent files** — an Open dropdown lists recently-opened `.md` files; pick one to reopen it without a file dialog.
- **Corrupt-file warning** — opening a `.md` with invalid or unsupported syntax now shows a clear warning (with the specific parse error) and a **Copy for LLM** button that bundles the error, the file's contents, and what MerScribe can read — instead of silently opening a blank canvas. Your file on disk is never changed.
- **Agent guide: what MerScribe reads (and ignores)** — the agent guides now spell out the exact supported subset and that anything else (other Mermaid diagram types, prose outside notes, unmatched `###` sections, HTML, positions, `session.json`) is silently dropped.

### Changed
- **The note editor is the note** — editing happens in place at the note's own size, font and padding, edge to edge, so nothing shifts or re-wraps when you start typing.
- **Notes hold a whole document** — by default a note's height fits its text, however long it runs. No 240px cap, nothing cut off at the bottom; type or paste a full page and read all of it on the canvas. (The Mermaid build is unaffected — the diagram node stays a small labelled note, with the body in the Markdown section below.)
- **…or shrink one and scroll it** — drag a note's top or bottom edge and the height stays exactly where you put it, with the text scrolling inside (the wheel scrolls the note instead of zooming the canvas). Select it and hit **Fit to text** in the Inspector to hand it back to auto-height.
- **Note width is yours** — drag either side handle out as far as you like (the resize handles were being clipped by the note itself, which made them almost impossible to grab). The text re-wraps and, on an auto-height note, the height re-fits.
- **Auto-arrange stops shrinking notes** — a note you've sized by hand keeps that exact box; auto-arrange re-positions it but never re-fits it. Notes it *does* fit (imported ones, ones you've never resized) get a readable column width and whatever height the text needs, instead of being squeezed into 280x210.
- **Select text inside a note** — click a selected note to start editing, then click-and-drag to highlight; the drag selects text instead of moving the note.
- **Groups select from anywhere inside them** — the whole interior is the group's hit area with a move cursor, instead of only a 26px title strip, and a selected group now actually looks selected (solid blue border, halo, tinted fill). Member objects still win wherever they sit, so "inside the group but not over something else" is exactly what you get. (Trade-off: dragging in a group's empty space now moves the group rather than box-selecting the canvas.)
- **Lines are clickable and show it** — a 24px hit band along each line, a pointer cursor over it, and a selected line goes from a 2px grey hairline to a thicker blue one with a soft halo.
- **Labelled lines break around their label** — the line is masked out behind its text rather than relying on the label painting over it, which is why it used to cut through the label sometimes and not others (a selected line is lifted above the label layer).
- **Selection comes to the front** — a selected line or object is raised above its neighbours and stays the one you're clicking, which is what makes a bundle of overlapping lines workable.
- **Notes attach to groups like they attach to boxes** — a slight overlap is enough; you no longer have to drop a note fully inside a group for it to belong to it.
- **Clearer toolbar icons** — the shapes picker is now three flat 2-D primitives instead of an isometric cube, and the group button is a dashed container holding two members instead of a bare hexagon glyph.
- **Clearer, safer file controls** — the file cluster is now explicit **New · Open · Save As**, and the save-status pill is a non-interactive indicator that always shows the linked file and its auto-save state (Auto-saved / Auto-saving…). Replacing the on-screen diagram (New / Open) asks for confirmation first.
- **Entity fields are directly editable** — click any field's **name, type, or key** and edit in place (no double-click, no popup box), with a per-row remove (×) button. Previously only the name was editable and switching to type/key closed the editor.
- **Entities always fit their fields** — an entity's height tracks its field list, so adding or removing a field grows/shrinks the box to contain every row. Fields can no longer spill outside the object, and the height can't be resized below its content.
- **Draw ER relationships field-to-field** — drag from one entity field's connector to another's and the relationship anchors to exactly those rows; the field link is written into the `.md` (`sourceField → targetField`) so it round-trips losslessly.
- **Reconnect edges** — drag an existing edge's endpoint to a different field (or node) to re-target the relationship; the field link updates and re-serializes.
- **ER diagrams read better** — entities laid out **side by side** (so field-level relationships attach on the facing sides instead of stacking), and ER relationships always route as **right-angles**.
- **Fewer edge styles** — the Curve Style picker is now just **Curved / Straight / Stepped**.

### Fixed
- **Files with an edge into a group open again** — a link pointing at a subgraph (`explore --> places`) threw out of the layout engine, and because the throw escaped the loader entirely the window just sat there: no diagram, and not even the corrupt-file warning. Such an edge is now excluded from *layout* only (it's still drawn), a layout that fails leaves the nodes unpositioned instead of taking the document down, and a hard error surfaces the warning dialog like any other unreadable file.
- **A re-parented note stays where you dropped it** — attaching or detaching a note resolved its position one level up the parent chain instead of all the way, so a note dropped on a box that lived inside a group was flung off across the canvas and had to be hunted down. Notes that come loose now sit exactly where you left them, with a few px of drift to show they didn't attach.
- **A newly-opened document is framed on arrival** — opening or importing a file kept the previous diagram's viewport, so the new one could land completely off-screen and looked like nothing had happened until you panned around. The canvas now re-frames whenever a document replaces it.
- **Editing a note behaves like a text box** — double-click a word to select it, triple-click for the line, drag to select. The node's own click handlers were firing alongside the textarea's and resetting the draft mid-selection.
- **ER arrows land on the correct field** — relationship endpoints are resolved from the FK comment and name match before the (descriptive) label, so a label like `"paid invoices"` can no longer grab the wrong row; an entity with no `PK` marker now anchors to its first row instead of floating to the box center.
- **No more blank canvas for single-block files** — a document with only a flowchart (or only an ER diagram) always renders; the All/Flow/ER switcher appears only when both blocks are present, so you can't switch to an empty view.
- **Group sizing & membership** — subgraphs auto-grow to contain their members (no spill when a node is dropped in), and imported and hand-made groups behave the same (drag a node out to ungroup, in to join).

## [0.1.10] - 2026-06-24

### Fixed
- **Top toolbar no longer scrolls** — it expands to its natural width instead of being trapped in a horizontal scroll box.
- **Block switcher (All / Flow / ER) is always available** from launch, not just when a document already contains both a flowchart and an ER block.

## [0.1.9] - 2026-06-24

### Added
- **Standard file model** — explicit **Open** (Ctrl+O), **Save** (Ctrl+S), and **Save As** (Ctrl+Shift+S, or click the filename pill), with an unsaved-changes indicator on the pill. Auto-save remains for live `.md` sync but is now safe.

### Fixed
- **Files could be wiped on launch/open.** The old model rewrote the file immediately after loading and auto-saved aggressively, so a slow/failed load (or stale session state) could overwrite the document with an empty diagram. Opening now **never writes**, and auto-save **never writes an empty canvas over a non-empty file**.
- **Right-drag (and drag) inside a group** now pans/selects the canvas — a group's empty interior is click-through; the group has a title bar to select/move/rename it, and resize handles still work.

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

## [0.1.11] - 2026-09-14

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
