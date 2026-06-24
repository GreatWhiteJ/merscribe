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

  // Note operations
  addNote: (text?: string, at?: { x: number; y: number }) => void;

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
  setDropTargetId: (id: string | null) => void;

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
    setDropTargetId: (id) => set({ dropTargetId: id }),

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
            },
          },
          get().edges,
        ) as Edge<FlowEdgeData>[],
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
        style: { width: 220, height: 130 },
      };
      set({ nodes: [...get().nodes, newNode] });
    }),

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
        style: { width: 220, height: 140 },
      };
      set({ nodes: [...get().nodes, newNode] });
    }),

    addEntityField: withHistory((id) => {
      set({
        nodes: get().nodes.map((n) =>
          n.id === id && n.data.isEntity
            ? {
                ...n,
                data: {
                  ...n.data,
                  fields: [...(n.data.fields ?? []), { name: "field", type: "string", key: "" }],
                },
              }
            : n,
        ),
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
          return { ...n, data: { ...n.data, fields } };
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
      const mapped = nodes.map((n) => {
          if (!nodeIds.includes(n.id)) return n;
          // Resolve the node's CURRENT absolute position first. A node already
          // inside a group stores a parent-relative position, so we must add
          // the old parent's position back before re-parenting. This makes
          // free→group, group→free, and group→group all land correctly.
          const oldParent = n.parentId ? nodes.find((p) => p.id === n.parentId) : null;
          const abs = oldParent
            ? { x: oldParent.position.x + n.position.x, y: oldParent.position.y + n.position.y }
            : { x: n.position.x, y: n.position.y };
          if (!newParent) {
            return { ...n, parentId: undefined, extent: undefined, position: abs };
          }
          const relPos = { x: abs.x - newParent.position.x, y: abs.y - newParent.position.y };
          return { ...n, parentId: newParent.id, position: relPos };
      });
      // Attaching to a regular node makes the assigned nodes addenda (e.g. a
      // sticky note) — they can't have edges, so drop any connected to them.
      const attachIds = new Set(nodeIds);
      const newEdges =
        newParent && !newParent.data.isSubgraph
          ? edges.filter((e) => !attachIds.has(e.source) && !attachIds.has(e.target))
          : edges;
      set({ nodes: orderByParent(mapped), edges: newEdges });
    }),

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
