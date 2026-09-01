import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";

// ─── Node shape types ────────────────────────────────────────────────────────
export type NodeShape =
  | "rectangle"
  | "rounded"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "double-circle"
  | "diamond"
  | "hexagon"
  | "parallelogram"
  | "parallelogram-alt"
  | "trapezoid"
  | "trapezoid-alt"
  | "asymmetric";

// ─── Edge style types ─────────────────────────────────────────────────────────
export type EdgeStyle = "solid" | "dashed" | "thick";
// Per-end markers a Mermaid FLOWCHART link can store losslessly.
export type FlowMarker = "none" | "arrow" | "circle" | "cross";
// Per-end crow's-foot cardinality a Mermaid erDiagram can store losslessly.
export type ErEnd = "one" | "zero-one" | "zero-many" | "one-many";

// ─── Entity / table types (ERD) ───────────────────────────────────────────────
export type EntityKey = "" | "PK" | "FK" | "UK";
export interface EntityField {
  name: string;
  type: string;
  key: EntityKey;
}

// ─── Diagram-level settings ───────────────────────────────────────────────────
export type Direction = "TD" | "LR" | "BT" | "RL";
export type Theme = "default" | "dark" | "forest" | "neutral" | "base";
export type Look = "classic" | "handDrawn";
export type CurveStyle =
  | "basis"
  | "bumpX"
  | "bumpY"
  | "cardinal"
  | "catmullRom"
  | "linear"
  | "monotoneX"
  | "monotoneY"
  | "natural"
  | "step"
  | "stepAfter"
  | "stepBefore";

// ─── Data types ───────────────────────────────────────────────────────────────
export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  shape: NodeShape;
  fillColor?: string;
  strokeColor?: string;
  textColor?: string;
  isSubgraph?: boolean;
  isNote?: boolean;
  isEntity?: boolean;
  fields?: EntityField[];
  // Data table (CSV-like grid) — exported as a Markdown table.
  isTable?: boolean;
  columns?: string[];
  rows?: string[][];
  // Visual text size (px) for the object's labels/cells. Canvas-only.
  fontSize?: number;
  // A note the user has resized by hand. Auto-arrange then leaves its width
  // and height exactly as set instead of re-fitting it to its text, so a note
  // you pulled out to document size never snaps back to a sticky.
  userSized?: boolean;
  // A note whose height the user dragged. The box stays exactly that tall and
  // the text scrolls inside it instead of growing to fit. Cleared by "Fit to
  // text" in the Inspector, which hands the note back to auto-height.
  fixedHeight?: boolean;
  // Transient: an attached note placed by auto-layout that the canvas should
  // re-position against measured sizes (kitty-corner) once, then clear.
  autoPlaced?: boolean;
}

export interface FlowEdgeData extends Record<string, unknown> {
  edgeStyle?: EdgeStyle;
  strokeColor?: string;
  // Flowchart edge end markers (independent per end).
  startMarker?: FlowMarker;
  endMarker?: FlowMarker;
  // ER edge per-end crow's-foot cardinality (when both endpoints are entities).
  erStart?: ErEnd;
  erEnd?: ErEnd;
  // ER edge field-level link: which row the relationship ties together — the FK
  // field on the "many" side and the PK field on the "one" side. Inferred at
  // parse time (ephemeral; not serialized — recomputed on each load).
  sourceFieldIndex?: number;
  targetFieldIndex?: number;
}

// ─── History snapshot ─────────────────────────────────────────────────────────
type Snapshot = {
  nodes: Node<FlowNodeData>[];
  edges: Edge<FlowEdgeData>[];
};

const MAX_HISTORY = 50;
let nodeCounter = 1;

// Cascade newly-added objects diagonally around the spawn center: close enough
// to always stay on-screen (so you can see/grab them), and offset enough that
// each new object's corner is reachable. Drag apart to wire them up.
function spawnSlot(counter: number): { dx: number; dy: number } {
  const i = counter % 6;
  return { dx: i * 44 - 110, dy: i * 44 - 110 };
}

// React Flow requires every parent to appear before its children. Order nodes
// so each node follows its parent (handles subgraph members and notes attached
// to nodes alike).
function orderByParent(nodes: Node<FlowNodeData>[]): Node<FlowNodeData>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: Node<FlowNodeData>[] = [];
  const seen = new Set<string>();
  const visit = (n: Node<FlowNodeData>) => {
    if (seen.has(n.id)) return;
    if (n.parentId && byId.has(n.parentId)) visit(byId.get(n.parentId)!);
    seen.add(n.id);
    out.push(n);
  };
  for (const n of nodes) visit(n);
  return out;
}

// Best-known on-canvas size of a node: live measured size, else its explicit
// style size, else a per-kind default.
function nodeSize(n: Node<FlowNodeData>): { w: number; h: number } {
  const def = n.data?.isSubgraph
    ? { w: 320, h: 220 }
    : n.data?.isEntity
      ? { w: 220, h: 140 }
      : n.data?.isTable
        ? { w: 280, h: 160 }
        : n.data?.isNote
          ? { w: 220, h: 130 }
          : { w: 150, h: 60 };
  const w = n.measured?.width ?? (typeof n.style?.width === "number" ? n.style.width : def.w);
  const h = n.measured?.height ?? (typeof n.style?.height === "number" ? n.style.height : def.h);
  return { w, h };
}

// Grow a subgraph (never shrink) so it fully contains its children with padding,
// leaving room for the title bar at the top. If a child sits above/left of the
// group origin, the group expands in that direction and every child is shifted
// to keep its absolute position unchanged. Idempotent once everything fits.
const GROUP_PAD = 22;
const GROUP_HEADER = 34;
function growGroupToFit(
  nodes: Node<FlowNodeData>[],
  groupId: string,
): Node<FlowNodeData>[] {
  const group = nodes.find((n) => n.id === groupId);
  if (!group || !group.data?.isSubgraph) return nodes;
  const kids = nodes.filter((n) => n.parentId === groupId);
  if (kids.length === 0) return nodes;
  const cur = nodeSize(group);
  let x0 = 0, y0 = 0, x1 = cur.w, y1 = cur.h;
  for (const k of kids) {
    const s = nodeSize(k);
    x0 = Math.min(x0, k.position.x - GROUP_PAD);
    y0 = Math.min(y0, k.position.y - GROUP_HEADER);
    x1 = Math.max(x1, k.position.x + s.w + GROUP_PAD);
    y1 = Math.max(y1, k.position.y + s.h + GROUP_PAD);
  }
  const offX = Math.min(0, x0), offY = Math.min(0, y0);
  const newW = x1 - offX, newH = y1 - offY;
  // Already big enough and origin unchanged → nothing to do.
  if (offX === 0 && offY === 0 && newW <= cur.w && newH <= cur.h) return nodes;
  return nodes.map((n) => {
    if (n.id === groupId) {
      return {
        ...n,
        position: { x: group.position.x + offX, y: group.position.y + offY },
        width: newW,
        height: newH,
        style: { ...n.style, width: newW, height: newH },
      };
    }
    if (n.parentId === groupId) {
      return { ...n, position: { x: n.position.x - offX, y: n.position.y - offY } };
    }
    return n;
  });
}

// Entity box geometry — must match the entity render in FlowNode (title bar +
// fixed-height field rows + the "+ field" affordance + border). The box always
// grows to hold every field, so a field can never spill outside the object.
export const ENTITY_HEADER_H = 30;
export const ENTITY_ROW_H = 26;
const ENTITY_FOOTER_H = 22; // the "+ field" affordance
const ENTITY_BORDER = 6;    // top+bottom border (at the selected stroke width)
export function entityFitHeight(fieldCount: number): number {
  return ENTITY_HEADER_H + fieldCount * ENTITY_ROW_H + ENTITY_FOOTER_H + ENTITY_BORDER;
}

// ─── Store interface ──────────────────────────────────────────────────────────
interface FlowState {
  nodes: Node<FlowNodeData>[];
  edges: Edge<FlowEdgeData>[];
  direction: Direction;
  theme: Theme;
  look: Look;
  curveStyle: CurveStyle;
  past: Snapshot[];
  future: Snapshot[];

  // React Flow change handlers
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  // Drag an existing edge's endpoint to a new node/field (React Flow reconnect).
  reconnectEdge: (oldEdge: Edge<FlowEdgeData>, newConnection: Connection) => void;

  // Node operations
  addNode: (shape?: NodeShape) => void;
  addNodeAtPosition: (
    position: { x: number; y: number },
    shape?: NodeShape,
    width?: number,
    height?: number,
  ) => void;
  updateNodeLabel: (id: string, label: string) => void;
  updateNodeShape: (id: string, shape: NodeShape) => void;
  updateNodeStyle: (
    id: string,
    style: Partial<
      Pick<FlowNodeData, "fillColor" | "strokeColor" | "textColor" | "fontSize">
    >,
  ) => void;
  setNodes: (nodes: Node<FlowNodeData>[]) => void;
  loadDiagram: (
    nodes: Node<FlowNodeData>[],
    edges: Edge<FlowEdgeData>[],
  ) => void;
  importDiagram: (
    nodes: Node<FlowNodeData>[],
    edges: Edge<FlowEdgeData>[],
    settings: { direction: Direction; theme: Theme; look: Look; curveStyle: CurveStyle },
  ) => void;

  // Subgraph operations
  addSubgraph: (title?: string, at?: { x: number; y: number }) => void;
  assignToSubgraph: (nodeIds: string[], subgraphId: string | null) => void;
  // Grow every subgraph so it contains its children (called after a drag settles).
  fitGroups: () => void;

  // Note operations
  addNote: (text?: string, at?: { x: number; y: number }) => void;
  // Set a note's height to the one its text actually needs (measured on the
  // canvas). Not undoable on its own — it would flood history with a step per
  // keystroke; the surrounding edit is what gets recorded.
  fitNoteHeight: (id: string, height: number) => void;
  // Mark a note as hand-sized (see FlowNodeData.userSized).
  markNoteSized: (id: string) => void;
  // Pin a note's height to its current box (text scrolls inside it), or let it
  // go back to growing with the text.
  setNoteFixedHeight: (id: string, fixed: boolean) => void;

  // Entity operations (ERD)
  addEntity: (name?: string, at?: { x: number; y: number }) => void;
  addEntityField: (id: string) => void;
  updateEntityField: (id: string, index: number, patch: Partial<EntityField>) => void;
  removeEntityField: (id: string, index: number) => void;

  // Data table operations (CSV-like grid → Markdown table)
  addTable: (name?: string, at?: { x: number; y: number }) => void;
  updateTableHeader: (id: string, col: number, value: string) => void;
  updateTableCell: (id: string, row: number, col: number, value: string) => void;
  addTableRow: (id: string) => void;
  addTableColumn: (id: string) => void;
  removeTableRow: (id: string, row: number) => void;
  removeTableColumn: (id: string, col: number) => void;

  // Edge operations
  updateEdgeLabel: (id: string, label: string) => void;
  updateEdgeType: (id: string, updates: Partial<FlowEdgeData>) => void;

  // Diagram settings
  setDirection: (direction: Direction) => void;
  setTheme: (theme: Theme) => void;
  setLook: (look: Look) => void;
  setCurveStyle: (curveStyle: CurveStyle) => void;

  // History
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // Selection operations
  duplicateSelected: () => void;
  clipboard: { nodes: Node<FlowNodeData>[]; edges: Edge<FlowEdgeData>[] } | null;
  copySelected: () => void;
  pasteClipboard: () => void;

  // Draw mode
  drawingShape: NodeShape | null;
  setDrawingShape: (shape: NodeShape | null) => void;

  // Which Mermaid block is shown when a document holds more than one. 'all' shows
  // everything; 'flow'/'er' restrict the canvas to the flowchart / ER block.
  activeBlock: "all" | "flow" | "er";
  setActiveBlock: (b: "all" | "flow" | "er") => void;

  // Group drag-and-drop highlight (transient, not persisted/serialized)
  dropTargetId: string | null;
  // Bumped every time a whole document replaces the canvas (open / import /
  // new). The canvas watches it so a freshly-loaded diagram is framed straight
  // away instead of sitting off-screen until the user pans around looking for it.
  docEpoch: number;
  setDropTargetId: (id: string | null) => void;

  // Set when a linked .md fails to parse (bad/unsupported syntax) so the UI can
  // warn instead of silently showing a blank canvas. Carries the raw file text
  // so the user can copy it (plus the error) to an LLM to repair. Transient.
  loadError: { message: string; content: string } | null;
  setLoadError: (e: { message: string; content: string } | null) => void;

  // Flow-coords of the visible canvas center; new objects spawn here so they
  // always appear where the user is looking. Kept in sync by the Canvas.
  spawnCenter: { x: number; y: number };
  setSpawnCenter: (p: { x: number; y: number }) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────
export const useFlowStore = create<FlowState>((set, get) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withHistory = <T extends (...args: any[]) => void>(fn: T): T => {
    return ((...args: Parameters<T>) => {
      const { nodes: beforeNodes, edges: beforeEdges } = get();

      fn(...args);

      const { nodes: afterNodes, edges: afterEdges, past } = get();

      if (beforeNodes !== afterNodes || beforeEdges !== afterEdges) {
        const snapshot: Snapshot = {
          nodes: beforeNodes.map((n) => ({ ...n, data: { ...n.data } })),
          edges: beforeEdges.map((e) => ({
            ...e,
            data: { ...(e.data ?? {}) } as FlowEdgeData,
          })),
        };
        set({
          past: [...past.slice(-(MAX_HISTORY - 1)), snapshot],
          future: [],
        });
      }
    }) as T;
  };

  return {
    nodes: [],
    edges: [],
    direction: "TD",
    theme: "default",
    look: "classic",
    curveStyle: "basis",
    past: [],
    future: [],
    clipboard: null,
    drawingShape: null,
    setDrawingShape: (shape) => set({ drawingShape: shape }),

    activeBlock: "all",
    setActiveBlock: (b) => set({ activeBlock: b }),

    dropTargetId: null,
    docEpoch: 0,
    setDropTargetId: (id) => set({ dropTargetId: id }),

    loadError: null,
    setLoadError: (e) => set({ loadError: e }),

    spawnCenter: { x: 300, y: 200 },
    setSpawnCenter: (p) => set({ spawnCenter: p }),

    pushHistory: () => {
      const { nodes, edges, past } = get();
      const snapshot: Snapshot = {
        nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
        edges: edges.map((e) => ({
          ...e,
          data: { ...(e.data ?? {}) } as FlowEdgeData,
        })),
      };
      set({ past: [...past.slice(-(MAX_HISTORY - 1)), snapshot], future: [] });
    },

    undo: () => {
      const { past, nodes, edges, future } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      const current: Snapshot = { nodes, edges };
      set({
        nodes: prev.nodes,
        edges: prev.edges,
        past: past.slice(0, -1),
        future: [current, ...future.slice(0, MAX_HISTORY - 1)],
      });
    },

    redo: () => {
      const { past, nodes, edges, future } = get();
      if (future.length === 0) return;
      const next = future[0];
      const current: Snapshot = { nodes, edges };
      set({
        nodes: next.nodes,
        edges: next.edges,
        past: [...past.slice(-(MAX_HISTORY - 1)), current],
        future: future.slice(1),
      });
    },

    onNodesChange: (changes) =>
      set({
        nodes: applyNodeChanges(changes, get().nodes) as Node<FlowNodeData>[],
      }),

    onEdgesChange: (changes) =>
      set({
        edges: applyEdgeChanges(changes, get().edges) as Edge<FlowEdgeData>[],
      }),

    onConnect: withHistory((connection) => {
      // When connecting entity field handles (`f-<i>-s` / `f-<i>-t`), record which
      // rows so the ER edge anchors to those fields instead of the box center.
      const fieldOf = (h?: string | null) => {
        const m = /^f-(\d+)-/.exec(h ?? "");
        return m ? Number(m[1]) : undefined;
      };
      const sFI = fieldOf(connection.sourceHandle);
      const tFI = fieldOf(connection.targetHandle);
      set({
        edges: addEdge(
          {
            ...connection,
            type: "flowEdge",
            data: {
              edgeStyle: "solid",
              startMarker: "none",
              endMarker: "arrow",
              erStart: "one",
              erEnd: "zero-many",
              ...(sFI !== undefined ? { sourceFieldIndex: sFI } : {}),
              ...(tFI !== undefined ? { targetFieldIndex: tFI } : {}),
            },
          },
          get().edges,
        ) as Edge<FlowEdgeData>[],
      });
    }),

    reconnectEdge: withHistory((oldEdge, newConnection) => {
      const fieldOf = (h?: string | null) => {
        const m = /^f-(\d+)-/.exec(h ?? "");
        return m ? Number(m[1]) : undefined;
      };
      const sFI = fieldOf(newConnection.sourceHandle);
      const tFI = fieldOf(newConnection.targetHandle);
      set({
        edges: get().edges.map((e) => {
          if (e.id !== oldEdge.id) return e;
          const data: FlowEdgeData = { ...(e.data ?? {}) };
          // Re-derive the ER field anchor from the handle the endpoint moved to
          // (dropped on a non-field handle clears it).
          if (sFI !== undefined) data.sourceFieldIndex = sFI; else delete data.sourceFieldIndex;
          if (tFI !== undefined) data.targetFieldIndex = tFI; else delete data.targetFieldIndex;
          return {
            ...e,
            source: newConnection.source,
            target: newConnection.target,
            sourceHandle: newConnection.sourceHandle ?? null,
            targetHandle: newConnection.targetHandle ?? null,
            data,
          };
        }) as Edge<FlowEdgeData>[],
      });
    }),

    addNode: withHistory((shape: NodeShape = "rectangle") => {
      const id = `node_${nodeCounter++}`;
      const offset = (nodeCounter * 30) % 200;
      const newNode: Node<FlowNodeData> = {
        id,
        type: "flowNode",
        position: { x: 150 + offset, y: 100 + offset },
        data: { label: "Node", shape },
      };
      set({ nodes: [...get().nodes, newNode] });
    }),

    addNodeAtPosition: withHistory(
      (position, shape: NodeShape = "rectangle", width?: number, height?: number) => {
        const id = `node_${nodeCounter++}`;
        const newNode: Node<FlowNodeData> = {
          id,
          type: "flowNode",
          position,
          data: { label: "Node", shape },
          ...(width && height ? { style: { width, height } } : {}),
        };
        set({ nodes: [...get().nodes, newNode] });
      },
    ),

    updateNodeLabel: withHistory((id, label) => {
      set({
        nodes: get().nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, label } } : n,
        ),
      });
    }),

    updateNodeShape: withHistory((id, shape) => {
      set({
        nodes: get().nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, shape } } : n,
        ),
      });
    }),

    updateNodeStyle: withHistory((id, style) => {
      set({
        nodes: get().nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...style } } : n,
        ),
      });
    }),

    updateEdgeLabel: withHistory((id, label) => {
      set({
        edges: get().edges.map((e) => (e.id === id ? { ...e, label } : e)),
      });
    }),

    updateEdgeType: withHistory((id, updates) => {
      set({
        edges: get().edges.map((e) =>
          e.id === id
            ? { ...e, data: { ...(e.data ?? {}), ...updates } as FlowEdgeData }
            : e,
        ),
      });
    }),

    setNodes: withHistory((nodes) => {
      set({ nodes });
    }),

    loadDiagram: withHistory((nodes, edges) => {
      const stampedNodes = nodes.map((n) => ({ ...n, type: "flowNode" }));
      const stampedEdges = edges.map((e) => ({
        ...e,
        type: "flowEdge",
      })) as Edge<FlowEdgeData>[];
      set({ nodes: stampedNodes, edges: stampedEdges });
    }),

    importDiagram: withHistory((nodes, edges, settings) => {
      const stampedNodes = nodes.map((n) => ({ ...n, type: "flowNode" }));
      const stampedEdges = edges.map((e) => ({
        ...e,
        type: "flowEdge",
      })) as Edge<FlowEdgeData>[];
      // Advance nodeCounter to avoid ID collisions with imported nodes
      const maxId = stampedNodes.reduce((max, n) => {
        const m = n.id.match(/(\d+)$/)
        return m ? Math.max(max, parseInt(m[1], 10)) : max
      }, 0)
      if (maxId >= nodeCounter) nodeCounter = maxId + 1
      set({
        nodes: stampedNodes,
        edges: stampedEdges,
        direction: settings.direction,
        theme: settings.theme,
        look: settings.look,
        curveStyle: settings.curveStyle,
        docEpoch: get().docEpoch + 1,
      });
    }),

    addSubgraph: withHistory((title = "Group", at?: { x: number; y: number }) => {
      const id = `sg_${nodeCounter++}`;
      const { spawnCenter } = get();
      const s = spawnSlot(nodeCounter);
      const c = at ?? { x: spawnCenter.x + s.dx, y: spawnCenter.y + s.dy };
      const newNode: Node<FlowNodeData> = {
        id,
        type: "flowNode",
        position: { x: c.x - 160, y: c.y - 110 },
        data: { label: title, shape: "rectangle", isSubgraph: true },
        style: { width: 320, height: 220 },
        zIndex: -1,
      };
      set({ nodes: [...get().nodes, newNode] });
    }),

    addNote: withHistory((text = "New note", at?: { x: number; y: number }) => {
      const id = `note_${nodeCounter++}`;
      const { spawnCenter } = get();
      const s = spawnSlot(nodeCounter);
      const c = at ?? { x: spawnCenter.x + s.dx, y: spawnCenter.y + s.dy };
      const newNode: Node<FlowNodeData> = {
        id,
        type: "flowNode",
        position: { x: c.x - 110, y: c.y - 65 },
        data: { label: text, shape: "rectangle", isNote: true },
        style: { width: 220, height: 64 },
      };
      set({ nodes: [...get().nodes, newNode] });
    }),

    fitNoteHeight: (id, height) => {
      const h = Math.round(height);
      set({
        nodes: get().nodes.map((n) =>
          // A note with a pinned height owns its box; don't grow it back.
          n.id === id && !n.data.fixedHeight && (n.height ?? 0) !== h
            ? { ...n, height: h, style: { ...n.style, height: h } }
            : n,
        ),
      });
    },

    markNoteSized: (id) => {
      set({
        nodes: get().nodes.map((n) =>
          n.id === id && !n.data.userSized
            ? { ...n, data: { ...n.data, userSized: true } }
            : n,
        ),
      });
    },

    setNoteFixedHeight: (id, fixed) => {
      set({
        nodes: get().nodes.map((n) =>
          n.id === id && !!n.data.fixedHeight !== fixed
            ? { ...n, data: { ...n.data, fixedHeight: fixed || undefined } }
            : n,
        ),
      });
    },

    addEntity: withHistory((name = "Entity", at?: { x: number; y: number }) => {
      const id = `ent_${nodeCounter++}`;
      const { spawnCenter } = get();
      const s = spawnSlot(nodeCounter);
      const c = at ?? { x: spawnCenter.x + s.dx, y: spawnCenter.y + s.dy };
      const newNode: Node<FlowNodeData> = {
        id,
        type: "flowNode",
        position: { x: c.x - 110, y: c.y - 70 },
        data: {
          label: name,
          shape: "rectangle",
          isEntity: true,
          fields: [
            { name: "id", type: "int", key: "PK" },
            { name: "name", type: "string", key: "" },
          ],
        },
        style: { width: 220, height: entityFitHeight(2) },
      };
      set({ nodes: [...get().nodes, newNode] });
    }),

    addEntityField: withHistory((id) => {
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== id || !n.data.isEntity) return n;
          const fields: EntityField[] = [...(n.data.fields ?? []), { name: "field", type: "string", key: "" }];
          // Grow the box to fit the new field so nothing spills.
          const h = entityFitHeight(fields.length);
          return { ...n, height: h, style: { ...n.style, height: h }, data: { ...n.data, fields } };
        }),
      });
    }),

    updateEntityField: withHistory((id, index, patch) => {
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== id || !n.data.isEntity) return n;
          const fields = (n.data.fields ?? []).map((f, i) =>
            i === index ? { ...f, ...patch } : f,
          );
          return { ...n, data: { ...n.data, fields } };
        }),
      });
    }),

    removeEntityField: withHistory((id, index) => {
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== id || !n.data.isEntity) return n;
          const fields = (n.data.fields ?? []).filter((_, i) => i !== index);
          // Shrink the box back to fit the remaining fields.
          const h = entityFitHeight(fields.length);
          return { ...n, height: h, style: { ...n.style, height: h }, data: { ...n.data, fields } };
        }),
      });
    }),

    addTable: withHistory((name = "Table", at?: { x: number; y: number }) => {
      const id = `tbl_${nodeCounter++}`;
      const { spawnCenter } = get();
      const s = spawnSlot(nodeCounter);
      const c = at ?? { x: spawnCenter.x + s.dx, y: spawnCenter.y + s.dy };
      const newNode: Node<FlowNodeData> = {
        id,
        type: "flowNode",
        position: { x: c.x - 140, y: c.y - 80 },
        data: {
          label: name,
          shape: "rectangle",
          isTable: true,
          columns: ["Column 1", "Column 2"],
          rows: [
            ["", ""],
            ["", ""],
          ],
        },
        style: { width: 280, height: 160 },
      };
      set({ nodes: [...get().nodes, newNode] });
    }),

    updateTableHeader: withHistory((id, col, value) => {
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== id || !n.data.isTable) return n;
          const columns = [...(n.data.columns ?? [])];
          columns[col] = value;
          return { ...n, data: { ...n.data, columns } };
        }),
      });
    }),

    updateTableCell: withHistory((id, row, col, value) => {
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== id || !n.data.isTable) return n;
          const rows = (n.data.rows ?? []).map((r) => [...r]);
          if (rows[row]) rows[row][col] = value;
          return { ...n, data: { ...n.data, rows } };
        }),
      });
    }),

    addTableRow: withHistory((id) => {
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== id || !n.data.isTable) return n;
          const width = (n.data.columns ?? []).length;
          const rows = [...(n.data.rows ?? []), Array(width).fill("")];
          return { ...n, data: { ...n.data, rows } };
        }),
      });
    }),

    addTableColumn: withHistory((id) => {
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== id || !n.data.isTable) return n;
          const columns = [...(n.data.columns ?? []), `Column ${(n.data.columns ?? []).length + 1}`];
          const rows = (n.data.rows ?? []).map((r) => [...r, ""]);
          return { ...n, data: { ...n.data, columns, rows } };
        }),
      });
    }),

    removeTableRow: withHistory((id, row) => {
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== id || !n.data.isTable) return n;
          const rows = (n.data.rows ?? []).filter((_, i) => i !== row);
          return { ...n, data: { ...n.data, rows } };
        }),
      });
    }),

    removeTableColumn: withHistory((id, col) => {
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== id || !n.data.isTable) return n;
          const allCols = n.data.columns ?? [];
          if (allCols.length <= 1) return n; // keep at least one column
          const columns = allCols.filter((_, i) => i !== col);
          const rows = (n.data.rows ?? []).map((r) => r.filter((_, i) => i !== col));
          return { ...n, data: { ...n.data, columns, rows } };
        }),
      });
    }),

    assignToSubgraph: withHistory((nodeIds, subgraphId) => {
      const { nodes, edges } = get();
      const newParent = subgraphId ? nodes.find((p) => p.id === subgraphId) : null;
      // Absolute position of a node, following the WHOLE parent chain. Adding
      // back just one level is wrong whenever anything nests (a note on a node
      // that lives in a group), and the leftover offset is what used to hurl a
      // re-parented note clear across the canvas.
      const absOf = (node: (typeof nodes)[number]) => {
        let x = node.position.x;
        let y = node.position.y;
        const seen = new Set<string>([node.id]);
        let p = node.parentId ? nodes.find((m) => m.id === node.parentId) : undefined;
        while (p && !seen.has(p.id)) {
          seen.add(p.id);
          x += p.position.x;
          y += p.position.y;
          p = p.parentId ? nodes.find((m) => m.id === p!.parentId) : undefined;
        }
        return { x, y };
      };
      const newParentAbs = newParent ? absOf(newParent) : null;
      const mapped = nodes.map((n) => {
          if (!nodeIds.includes(n.id)) return n;
          // Resolve the node's CURRENT absolute position first, so free→group,
          // group→free, and group→group all land where the user dropped it.
          const abs = absOf(n);
          if (!newParent) {
            // Came loose. Stay exactly where it was dropped — a note that missed
            // its target must never go hunting off-screen — but a note that was
            // attached gets a few px of drift so the detach is visible.
            const drift = n.data?.isNote && n.parentId ? 8 : 0;
            return { ...n, parentId: undefined, extent: undefined, position: { x: abs.x + drift, y: abs.y + drift } };
          }
          const relPos = { x: abs.x - newParentAbs!.x, y: abs.y - newParentAbs!.y };
          // Clear any extent lock (imported nodes carried extent:'parent') so the
          // node stays freely draggable in/out for membership reconciliation.
          return { ...n, parentId: newParent.id, extent: undefined, position: relPos };
      });
      // Attaching to a regular node makes the assigned nodes addenda (e.g. a
      // sticky note) — they can't have edges, so drop any connected to them.
      const attachIds = new Set(nodeIds);
      const newEdges =
        newParent && !newParent.data.isSubgraph
          ? edges.filter((e) => !attachIds.has(e.source) && !attachIds.has(e.target))
          : edges;
      // Grow the target subgraph so the newly-added node sits inside it (no spill).
      let result = orderByParent(mapped);
      if (newParent && newParent.data.isSubgraph) result = growGroupToFit(result, newParent.id);
      set({ nodes: result, edges: newEdges });
    }),

    fitGroups: () => {
      const orig = get().nodes;
      let ns = orig;
      for (const g of orig.filter((n) => n.data?.isSubgraph)) ns = growGroupToFit(ns, g.id);
      if (ns !== orig) set({ nodes: ns });
    },

    setDirection: (direction) => set({ direction }),
    setTheme: (theme) => set({ theme }),
    setLook: (look) => set({ look }),
    setCurveStyle: (curveStyle) => set({ curveStyle }),

    copySelected: () => {
      const { nodes, edges } = get();
      const selectedNodes = nodes.filter((n) => n.selected);
      if (selectedNodes.length === 0) return;
      const selectedIds = new Set(selectedNodes.map((n) => n.id));
      const selectedEdges = edges.filter(
        (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
      );
      set({ clipboard: { nodes: selectedNodes, edges: selectedEdges } });
    },

    pasteClipboard: withHistory(() => {
      const { clipboard, nodes, edges } = get();
      if (!clipboard || clipboard.nodes.length === 0) return;

      const idMap = new Map<string, string>();

      const newNodes = clipboard.nodes.map((n) => {
        const newId = `node_${nodeCounter++}`;
        idMap.set(n.id, newId);
        return {
          ...n,
          id: newId,
          selected: true,
          position: { x: n.position.x + 40, y: n.position.y + 40 },
          parentId: n.parentId && idMap.has(n.parentId) ? idMap.get(n.parentId) : undefined,
        };
      });

      const newEdges = clipboard.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          ...e,
          id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
          selected: true,
        }));

      set({
        nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...newNodes],
        edges: [...edges.map((e) => ({ ...e, selected: false })), ...newEdges],
      });
    }),

    duplicateSelected: withHistory(() => {
      const { nodes, edges } = get();
      const selectedNodes = nodes.filter((n) => n.selected);
      if (selectedNodes.length === 0) return;
      const idMap = new Map<string, string>();

      // Duplicate the selected nodes themselves
      const newNodes = selectedNodes.map((n) => {
        const newId = `node_${nodeCounter++}`;
        idMap.set(n.id, newId);
        const label = n.data.isSubgraph ? `Copy of ${n.data.label}` : n.data.label;
        return {
          ...n,
          id: newId,
          data: { ...n.data, label },
          position: { x: n.position.x + 30, y: n.position.y + 30 },
          selected: true,
        };
      });

      // For each duplicated subgraph, also duplicate its children
      const childNodes: Node<FlowNodeData>[] = [];
      for (const n of selectedNodes) {
        if (!n.data.isSubgraph) continue;
        const newParentId = idMap.get(n.id)!;
        for (const child of nodes.filter((c) => c.parentId === n.id)) {
          const newChildId = `node_${nodeCounter++}`;
          idMap.set(child.id, newChildId);
          childNodes.push({ ...child, id: newChildId, parentId: newParentId, selected: true });
        }
      }

      // Duplicate edges where both endpoints were duplicated
      const newEdges = edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          ...e,
          id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
        }));

      set({
        nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...newNodes, ...childNodes],
        edges: [...edges, ...newEdges],
      });
    }),
  };
});
