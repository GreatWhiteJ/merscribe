# MerScribe

A desktop whiteboard for [Mermaid.js](https://mermaid.js.org) diagrams whose **source of truth is a clean Markdown file** — editable by a human on the canvas, or by an AI agent in the `.md`, with the two kept in **lossless two-way sync**.

No account. No cloud. Runs locally.

Draw flowcharts, notes, data tables, and ER diagrams on an infinite canvas. The diagram is stored as a single Markdown document (Mermaid blocks + GFM tables + note sections). Edit the canvas *or* the file and the other follows — so an agent can sketch or revise a diagram in plain text and you watch it update live, and vice-versa.

---

## Download

Grab the build for your platform from the [Releases page](https://github.com/GreatWhiteJ/merscribe/releases):

- **Windows** — `MerScribe-<v>-setup.exe` (installer) or `MerScribe-<v>-portable.exe` (run directly)
- **macOS** — `MerScribe-<v>-arm64.dmg` (Apple Silicon) or `MerScribe-<v>-x64.dmg` (Intel)
- **Linux** — `MerScribe-<v>-x86_64.AppImage`

> **First-launch note (unsigned):** until signing certificates are added, you'll see a one-time OS prompt — Windows SmartScreen → **More info → Run anyway**; macOS Gatekeeper → **right-click → Open**. Standard for open-source apps from an unverified publisher. (Enabling signing: see [RELEASING.md](RELEASING.md).)

On launch the app silently auto-saves your diagram to `Downloads/diagram.md`, restores your last session, and live-syncs the canvas with that file. Use the save-status pill (top toolbar) to open or link a different `.md`.

---

## Run from source

```bash
git clone https://github.com/GreatWhiteJ/merscribe.git
cd merscribe
pnpm install

pnpm desktop   # build + launch the desktop app
# or:
pnpm dev       # browser dev server at http://localhost:3000
```

Build a local distributable (Windows portable zip — no admin, no signing):

```bash
pnpm dist      # → dist/MerScribe-win-x64.zip  (and dist/MerScribe-win32-x64/MerScribe.exe)
```

**Requirements:** Node.js 18+, pnpm.

### Releasing

Official multi-platform builds (Windows/macOS/Linux installers) are produced automatically when you push a version tag — see [RELEASING.md](RELEASING.md).

---

## Features

The canvas and the `.md` file are two views of the same document — edit either, and the other follows.

### Diagram objects
- **Flow nodes** — 14 shapes (rectangle, rounded, stadium, diamond, circle, hexagon, cylinder, …); double-click to rename inline.
- **Edges** — drag from any node's top/bottom/left/right handle. Solid/dashed/thick lines, per-end markers (arrow, circle, cross, none) on *each* side, and inline edge labels.
- **Groups (subgraphs)** — drop a node onto a group to nest it; drag it out to un-nest.
- **Notes (sticky)** — free notes are their own object; drop a note onto a node and it *attaches* as a footnote that tucks onto the host's most-open corner. Full Markdown note content lives in the `.md`.
- **Data tables** — an editable, spreadsheet-style grid that serializes to a GitHub-flavored Markdown table.
- **ER entities & relationships** — typed fields with PK/FK/UK keys, per-field connection handles, and crow's-foot cardinality.

### Markdown round-trip & live sync
- **Canonical `.md`** — the document is a single Markdown file: a Mermaid `flowchart` block, an optional `erDiagram` block, GFM tables, and `###` note sections. Layout positions are kept separately, so the source stays clean.
- **Lossless import & export** — export to `.md`, edit it by hand or with an AI agent, reopen, and your changes are incorporated; shapes, markers, groups, tables, notes, and entities all round-trip.
- **Live file-sync (desktop)** — change the `.md` on disk and the canvas updates in real time; edit the canvas and it auto-saves back. Sync is content-based, so there are no echo-writes and no swallowed edits.

### Layout
- **Mermaid-quality auto-layout** — the canvas uses Mermaid's own layered engine, made *size-aware* so large tables and notes get real room. Clean, crossing-free, upstream→downstream flow that matches the preview.
- **Auto-arrange** — one toolbar click re-tidies the canvas; it also runs automatically when the structure changes.
- **Direction / theme / curve** — TD / LR / BT / RL, 5 Mermaid themes, hand-drawn look, 12 edge-routing curves.

### Editing & history
- Shape & style pickers (fill / stroke / text color), inline label and table-cell editing, duplicate (`Ctrl+D`), delete, marquee multi-select, and full undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`).

### Preview & export
- **Mermaid Live panel** — renders the flowchart and ER diagram; tables and noted nodes show a 📋 / 📝 badge instead of dumping their contents.
- Copy Mermaid syntax, download `.md` / `.svg`.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` | Add a new node |
| `Backspace` / `Delete` | Delete selected node(s) or edge(s) |
| `Ctrl + D` | Duplicate selected node(s) |
| `Ctrl + Z` | Undo |
| `Ctrl + Shift + Z` | Redo |
| `Escape` | Deselect all |

---

## How it works

```
  Canvas (React Flow)  ⇄  Zustand store { nodes[], edges[] }
                            ⇅  serialize / parse
                                 lib/serializer.ts · lib/parser.ts
              Canonical Markdown (.md)
                            ⇅  live file-watch + silent auto-save (Electron)
                          file on disk  ⇄  human / AI agent edits
```

The **Markdown file is the canonical artifact**: the canvas serializes to it and parses back from it losslessly, so either side can be the editor. Layout positions live in a separate session file, keeping the `.md` clean. In the desktop app the file is watched, so external edits flow onto the canvas and canvas edits flow back — content-based diffing prevents echo loops.

| Layer | Choice |
|-------|--------|
| Framework | Next.js (App Router, static export) |
| Desktop shell | Electron |
| Visual Canvas | React Flow (XY Flow) |
| Mermaid Render & Layout | mermaid.js |
| State | Zustand |
| Styling | Tailwind CSS |
| Language | TypeScript |
| Fallback Layout | Dagre |
| Packaging | electron-builder |

---

## Roadmap

- [x] Multi-platform CI release builds (Windows / macOS / Linux)
- [ ] Code-signed builds (signing is wired up — add cert secrets per [RELEASING.md](RELEASING.md))
- [ ] Sequence, mindmap, class, and state diagram support
- [ ] Obsidian plugin
- [ ] Dark mode for the editor UI
- [ ] AI-assisted diagram generation

---

## Credits & License

MerScribe is a fork of [**saketkattu/mermaid-visual-editor**](https://github.com/saketkattu/mermaid-visual-editor) (MIT) — a visual-first Mermaid flowchart editor. It re-centers that project around a Markdown-canonical, agent-editable desktop workflow: a true desktop app, lossless `.md` round-trip, live file-sync, and richer objects (notes, tables, ER entities).

Licensed under the [MIT License](LICENSE). The original copyright notice is retained per the MIT terms.
