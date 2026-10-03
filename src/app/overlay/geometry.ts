/**
 * Overlay geometry — pure functions over the sheet contracts, no Konva or DOM (tested in Node).
 *
 * Time axis — as in `digitize`: t = 0 at the left edge of the plot area (`layout.zones.plot`, without it — the frame),
 * x = plot.x + t · px/mm X · mm/s / 1000. All coordinates are pixels of the source sheet.
 */
import type { Calibration, PageLayout, Point, UnreliableKind, UnreliableSpan } from '../../types/contracts';

// ---------------------------------------------------------------------------
// The curve and its unreliable spans
// ---------------------------------------------------------------------------

/** Polyline segment joining the edges of an unreliable span: not a signal (`clipped` — clipping, `gap` — break). */
export interface Bridge {
  from: Point;
  to: Point;
  kind: UnreliableKind;
}

/**
 * Splits the trace polyline into pieces drawn as a curve and "bridges" across `clipped`/`gap` spans
 * (task 04: there are no points inside such spans, neighbouring points are joined by a segment — spec §2 forbids
 * drawing it as a curve). A pair of neighbouring points whose x range contains a span becomes a bridge;
 * on overlapping spans `clipped` wins. `ambiguous` spans do not break the curve (see `ambiguousSegments`).
 */
export function traceSegments(points: readonly Point[], unreliable: readonly UnreliableSpan[]): { curve: Point[][]; bridges: Bridge[] } {
  const spans = unreliable.filter((s) => s.kind !== 'ambiguous');
  const curve: Point[][] = [];
  const bridges: Bridge[] = [];
  let current: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const a = points[i - 1];
      const hit = spans.filter((s) => s.x0 < p.x && s.x1 > a.x);
      if (hit.length > 0) {
        bridges.push({ from: a, to: p, kind: hit.some((s) => s.kind === 'clipped') ? 'clipped' : 'gap' });
        if (current.length > 0) curve.push(current);
        current = [];
      }
    }
    current.push(p);
  }
  if (current.length > 0) curve.push(current);
  return { curve, bridges };
}

/**
 * y of the trace polyline at x: linear interpolation between x-neighbouring points (x non-decreasing), beyond the
 * edges — the edge values; no points — `undefined`. This way a marker "follows the curve vertically" (story 61).
 */
export function yOnTrace(points: readonly Point[], x: number): number | undefined {
  const n = points.length;
  if (n === 0) return undefined;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[n - 1].x) return points[n - 1].y;
  // Last point with points[k].x <= x — binary search.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  return b.x > a.x ? a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) : b.y;
}

/** Polyline pieces inside `ambiguous` spans (position interpolated) — highlighted over the curve. */
export function ambiguousSegments(points: readonly Point[], unreliable: readonly UnreliableSpan[]): Point[][] {
  const out: Point[][] = [];
  for (const span of unreliable) {
    if (span.kind !== 'ambiguous') continue;
    const inside = points.filter((p) => p.x >= span.x0 - 0.5 && p.x <= span.x1 + 0.5);
    if (inside.length >= 2) out.push(inside);
  }
  return out;
}

/** Left edge of the sheet's time axis — the plot area, without it the frame. */
export function timeOriginX(layout: PageLayout): number {
  return (layout.zones.plot ?? layout.frame).x;
}

/** Sheet pixels per millisecond of recording; 0 if there is no grid or calibration. */
export function pxPerMs(layout: PageLayout, calib: Calibration): number {
  const v = (layout.grid.pxPerMmX * calib.mmPerS) / 1000;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// ---------------------------------------------------------------------------
// Detected grid (story 16: nodes coincide with the dots)
// ---------------------------------------------------------------------------

export interface GridLines {
  /** 5-mm lines along X and Y, sheet px. */
  xs5: number[];
  ys5: number[];
  /** 1-mm nodes along X and Y (the lattice is their Cartesian product), sheet px. */
  xs1: number[];
  ys1: number[];
}

/** Lattice `phase + k·step` on the segment `[from, to]` for integer k ≥ `minK`. */
function lattice(phase: number, step: number, from: number, to: number, minK = -Infinity): number[] {
  if (!(step > 0) || !Number.isFinite(phase)) return [];
  const out: number[] = [];
  for (let k = Math.max(minK, Math.ceil((from - phase) / step)); phase + k * step <= to; k++) out.push(phase + k * step);
  return out;
}

/**
 * Lines and nodes of the measured grid inside the frame: 5-mm lines — `phase + 5k·px/mm` for k ≥ 0 (`GridEstimate`:
 * the phase is the first 5-mm line), 1-mm nodes — `phase + k·px/mm` for any k (nodes also exist left of/above the
 * first line). Grid not found (px/mm = 0) — empty. `grid` can be overridden by manual calibration (story 17).
 */
export function gridLines(layout: PageLayout, grid: PageLayout['grid'] = layout.grid): GridLines {
  const { frame } = layout;
  const x1 = frame.x + frame.width - 1;
  const y1 = frame.y + frame.height - 1;
  return {
    xs5: lattice(grid.phaseX, 5 * grid.pxPerMmX, frame.x, x1, 0),
    ys5: lattice(grid.phaseY, 5 * grid.pxPerMmY, frame.y, y1, 0),
    xs1: lattice(grid.phaseX, grid.pxPerMmX, frame.x, x1),
    ys1: lattice(grid.phaseY, grid.pxPerMmY, frame.y, y1),
  };
}

// ---------------------------------------------------------------------------
// Zoom and pan (story 65: 1–8×, markers stay on the curve — everything is drawn in sheet px)
// ---------------------------------------------------------------------------

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

/** View: zoom relative to "fit to width" and the screen offset of the sheet origin. */
export interface View {
  zoom: number;
  x: number;
  y: number;
}

/** Scene viewport and sheet: `base` — the "fit" scale (viewport width / sheet width). */
export interface Viewport {
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  base: number;
}

/** Scene scale (screen px per sheet px) for the given view. */
export const viewScale = (view: View, vp: Viewport): number => vp.base * view.zoom;

/** Sheet wider than the viewport — the offset is clamped so the sheet covers the viewport; narrower — centered. */
function clampOffset(offset: number, viewportSize: number, contentSize: number): number {
  if (contentSize <= viewportSize) return (viewportSize - contentSize) / 2;
  return Math.min(0, Math.max(viewportSize - contentSize, offset));
}

export function clampView(view: View, vp: Viewport): View {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(view.zoom) ? view.zoom : ZOOM_MIN));
  const s = vp.base * zoom;
  return {
    zoom,
    x: clampOffset(view.x, vp.width, vp.contentWidth * s),
    y: clampOffset(view.y, vp.height, vp.contentHeight * s),
  };
}

/** Zoom by `factor` around the screen point `pointer`: the sheet point under the cursor stays in place. */
export function zoomAt(view: View, vp: Viewport, pointer: Point, factor: number): View {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
  const before = viewScale(view, vp);
  const after = vp.base * zoom;
  const cx = (pointer.x - view.x) / before;
  const cy = (pointer.y - view.y) / before;
  return clampView({ zoom, x: pointer.x - cx * after, y: pointer.y - cy * after }, vp);
}

/** Screen point → sheet point for the given view. */
export function toContent(view: View, vp: Viewport, screen: Point): Point {
  const s = viewScale(view, vp);
  return { x: (screen.x - view.x) / s, y: (screen.y - view.y) / s };
}

// ---------------------------------------------------------------------------
// Time axis
// ---------------------------------------------------------------------------

export function timeToX(layout: PageLayout, calib: Calibration, tMs: number): number {
  return timeOriginX(layout) + tMs * pxPerMs(layout, calib);
}

export function xToTime(layout: PageLayout, calib: Calibration, x: number): number {
  const k = pxPerMs(layout, calib);
  return k > 0 ? (x - timeOriginX(layout)) / k : 0;
}
