/**
 * Overlay geometry (pure functions, no Konva/DOM): sheet time axis, the curve and its unreliable spans,
 * detected grid, zoom. Expected numbers come from the spec and the profile (variant A: 4.305 px/mm, 50 mm/s).
 */
import { describe, expect, it } from 'vitest';
import type { PageLayout } from '../../types/contracts';
import { gridLines, timeToX, traceSegments, xToTime, yOnTrace, zoomAt, type View, type Viewport } from './geometry';

const CALIB = { mmPerS: 50, mmPerMv: 10 };

/** Variant A layout per spec numbers: 4.305 px/mm, first 5-mm row y = 64.75, plot area from x = 60. */
function layoutA(): PageLayout {
  return {
    variant: 'A',
    frame: { x: 20, y: 40, width: 1240, height: 840 },
    grid: { pxPerMmX: 4.305, pxPerMmY: 4.305, phaseX: 23.5, phaseY: 64.75, confidence: 1 },
    zones: { plot: { x: 60, y: 60, width: 1200, height: 800 } },
    expectedBaselines: [194, 323, 452, 581, 710, 839],
    confidence: 1,
    issues: [],
  };
}

describe('overlay geometry: sheet time axis', () => {
  it('variant A, 50 mm/s: one second = 215.25 px from the left edge of the plot area, and back', () => {
    const layout = layoutA();
    expect(timeToX(layout, CALIB, 0)).toBe(60);
    expect(timeToX(layout, CALIB, 1000)).toBeCloseTo(60 + 215.25, 6);
    expect(xToTime(layout, CALIB, 60 + 215.25)).toBeCloseTo(1000, 6);
  });
});

describe('overlay geometry: the curve and unreliable spans', () => {
  it('a polyline segment across a clipped span is not part of the curve but returned separately as "clipped"; gap — as a break', () => {
    // Task 04 trace: no points inside clipped, neighbouring points joined by a segment; gap — the polyline joins the edges.
    const points = [
      { x: 0, y: 10 },
      { x: 1, y: 10 },
      { x: 2, y: 12 },
      { x: 10, y: 50 },
      { x: 11, y: 50 },
      { x: 12, y: 49 },
      { x: 20, y: 20 },
      { x: 21, y: 20 },
    ];
    const unreliable = [
      { x0: 3, x1: 9, kind: 'clipped' as const },
      { x0: 13, x1: 19, kind: 'gap' as const },
    ];
    const { curve, bridges } = traceSegments(points, unreliable);
    expect(curve).toEqual([
      [{ x: 0, y: 10 }, { x: 1, y: 10 }, { x: 2, y: 12 }],
      [{ x: 10, y: 50 }, { x: 11, y: 50 }, { x: 12, y: 49 }],
      [{ x: 20, y: 20 }, { x: 21, y: 20 }],
    ]);
    expect(bridges).toEqual([
      { from: { x: 2, y: 12 }, to: { x: 10, y: 50 }, kind: 'clipped' },
      { from: { x: 12, y: 49 }, to: { x: 20, y: 20 }, kind: 'gap' },
    ]);
  });

  it('curve y at x is linear interpolation between trace points, beyond the edges — the edge values', () => {
    const points = [
      { x: 10, y: 100 },
      { x: 20, y: 120 },
      { x: 30, y: 80 },
    ];
    expect(yOnTrace(points, 15)).toBe(110);
    expect(yOnTrace(points, 25)).toBe(100);
    expect(yOnTrace(points, 5)).toBe(100);
    expect(yOnTrace(points, 35)).toBe(80);
  });
});

describe('overlay geometry: detected grid (story 16)', () => {
  it('5-mm lines are phase + 5k·px/mm inside the frame, 1-mm nodes are phase + k·px/mm, including left of the first 5-mm line', () => {
    const layout = { ...layoutA(), frame: { x: 10, y: 40, width: 1250, height: 840 } };
    const g = gridLines(layout);
    // Along X: first 5-mm line 23.5, step 5 · 4.305 = 21.525; the last one is inside the frame (x ≤ 1259).
    expect(g.xs5[0]).toBeCloseTo(23.5, 6);
    expect(g.xs5[1]).toBeCloseTo(45.025, 6);
    expect(g.xs5[2]).toBeCloseTo(66.55, 6);
    expect(g.xs5.at(-1)!).toBeLessThanOrEqual(1259);
    expect(g.xs5.at(-1)! + 21.525).toBeGreaterThan(1259);
    // 1-mm nodes start at the frame's left edge: 23.5 − 3 · 4.305 = 10.585; the fourth node is the 5-mm line itself.
    expect(g.xs1[0]).toBeCloseTo(10.585, 6);
    expect(g.xs1[3]).toBeCloseTo(23.5, 6);
    // Along Y: first 5-mm row 64.75; nodes above it up to the frame: 64.75 − 5 · 4.305 = 43.225 ≥ 40.
    expect(g.ys5[0]).toBeCloseTo(64.75, 6);
    expect(g.ys1[0]).toBeCloseTo(43.225, 6);
  });

  it('grid not found (px/mm = 0) — no lines or nodes', () => {
    const layout = { ...layoutA(), grid: { pxPerMmX: 0, pxPerMmY: 0, phaseX: 0, phaseY: 0, confidence: 0 } };
    expect(gridLines(layout)).toEqual({ xs5: [], ys5: [], xs1: [], ys1: [] });
  });
});

describe('overlay geometry: zoom 1–8× (story 65)', () => {
  // Viewport 1000×700, sheet 1280×905 "fitted" to width: base scale 1000/1280 = 0.78125.
  const viewport: Viewport = { width: 1000, height: 700, contentWidth: 1280, contentHeight: 905, base: 0.78125 };
  const fit: View = { zoom: 1, x: 0, y: 0 };

  it('zoom ×2 around the cursor keeps the sheet point under the cursor in place', () => {
    // Under the cursor (500, 350) at zoom 1 lies sheet point (640, 448); at zoom 2 it must stay under the cursor:
    // 500 − 640 · 0.78125 · 2 = −500, 350 − 448 · 0.78125 · 2 = −350.
    const view = zoomAt(fit, viewport, { x: 500, y: 350 }, 2);
    expect(view.zoom).toBe(2);
    expect(view.x).toBeCloseTo(-500, 6);
    expect(view.y).toBeCloseTo(-350, 6);
  });

  it('zoom is clamped to 1–8: ×20 gives 8, ×0.1 returns to "fit" with no offset', () => {
    expect(zoomAt(fit, viewport, { x: 0, y: 0 }, 20).zoom).toBe(8);
    const back = zoomAt({ zoom: 3, x: -400, y: -300 }, viewport, { x: 500, y: 350 }, 0.1);
    expect(back).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('panning does not move the sheet out of the viewport: the offset is clamped so the sheet covers the viewport', () => {
    // At zoom 2 the on-screen sheet width is 2000, height 1414: x ∈ [−1000, 0], y ∈ [−714.06, 0].
    const view = zoomAt({ zoom: 2, x: 0, y: 0 }, viewport, { x: 0, y: 0 }, 1);
    expect(view).toEqual({ zoom: 2, x: 0, y: 0 });
    const dragged = zoomAt({ zoom: 2, x: 300, y: -2000 }, viewport, { x: 0, y: 0 }, 1);
    expect(dragged.x).toBe(0);
    expect(dragged.y).toBeCloseTo(700 - 905 * 0.78125 * 2, 6);
  });
});
