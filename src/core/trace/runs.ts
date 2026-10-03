/**
 * Per-column ink runs and the run graph: a representation in which a tall narrow wave survives
 * without loss: a steep QRS edge is one long run, not a series of jumps.
 *
 * A run is a maximal vertical ink segment in a column; white gaps ≤ `bridge` px inside it
 * are bridged (antialiasing breaks a nearly vertical stroke into 1–3-px pieces).
 */
import type { InkMask } from '../../types/contracts';

export interface Run {
  /** Global run index. */
  index: number;
  x: number;
  y0: number;
  y1: number;
  /** Number of ink pixels inside the run (excluding bridged gaps). */
  pixels: number;
  /** Position within its column. */
  slot: number;
  /** Bridged white gaps inside the run: rows [from, to] inclusive. */
  breaks: [number, number][];
}

export interface Column {
  x: number;
  runs: Run[];
}

export interface RunGraph {
  columns: Column[];
  runs: Run[];
  /** Per run: index of its connected component in the run graph. */
  component: Int32Array;
  componentCount: number;
}

export const BRIDGE = 2;

/** Vertical white gap between runs of adjacent columns: 0 if the ranges touch (8-connectivity). */
export function gapBetween(a: Run, b: Run): number {
  return Math.max(0, b.y0 - a.y1 - 1, a.y0 - b.y1 - 1);
}

export function buildRunGraph(ink: InkMask, x0: number, x1: number, y0: number, y1: number, bridge = BRIDGE): RunGraph {
  const { mask, width } = ink;
  const columns: Column[] = [];
  const runs: Run[] = [];
  for (let x = x0; x <= x1; x++) {
    const column: Column = { x, runs: [] };
    let start = -1;
    let last = -1;
    let pixels = 0;
    let breaks: [number, number][] = [];
    const close = () => {
      const run: Run = { index: runs.length, x, y0: start, y1: last, pixels, slot: column.runs.length, breaks };
      runs.push(run);
      column.runs.push(run);
      start = -1;
      pixels = 0;
      breaks = [];
    };
    for (let y = y0; y <= y1; y++) {
      if (mask[y * width + x]) {
        if (start >= 0 && y - last - 1 > bridge) close();
        if (start < 0) start = y;
        else if (y > last + 1) breaks.push([last + 1, y - 1]);
        last = y;
        pixels++;
      }
    }
    if (start >= 0) close();
    columns.push(column);
  }

  // Connected components of the graph (union by adjacency of runs in neighboring columns).
  const parent = new Int32Array(runs.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let c = 1; c < columns.length; c++) {
    for (const a of columns[c - 1].runs) {
      for (const b of columns[c].runs) {
        if (gapBetween(a, b) === 0) {
          const ra = find(a.index);
          const rb = find(b.index);
          if (ra !== rb) parent[ra] = rb;
        }
      }
    }
  }
  const component = new Int32Array(runs.length);
  const ids = new Map<number, number>();
  for (let i = 0; i < runs.length; i++) {
    const root = find(i);
    let id = ids.get(root);
    if (id === undefined) {
      id = ids.size;
      ids.set(root, id);
    }
    component[i] = id;
  }
  return { columns, runs, component, componentCount: ids.size };
}
