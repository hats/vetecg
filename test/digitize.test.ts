import { describe, expect, it } from 'vitest';
import { digitize } from '../src/core/digitize';
import { POLYSPECTRUM } from '../src/core/profile';
import { LEAD_IDS, type LeadTrace, type PageLayout, type Point, type UnreliableSpan } from '../src/types/contracts';

/**
 * Variant A layout "as per profile", built by hand (not via detectLayout): 4.305 px/mm on both
 * axes, plot area x80–1233. At 50 mm/s one second = 215.25 px, a 2 ms sample = 0.4305 px; 1 px = 1/43.05 mV.
 */
const V = POLYSPECTRUM.variants.A;
const PX_PER_MM = 4.305;
const CALIB = { mmPerS: 50, mmPerMv: 10 };
const PX_PER_MS = (PX_PER_MM * CALIB.mmPerS) / 1000;
const MV_PER_PX = 1 / (PX_PER_MM * CALIB.mmPerMv);
const PLOT_X = V.zones.plot!.x;

function layoutA(pxPerMm = PX_PER_MM): PageLayout {
  return {
    variant: 'A',
    frame: { ...V.frame },
    grid: { pxPerMmX: pxPerMm, pxPerMmY: pxPerMm, phaseX: 82 + 5 * pxPerMm, phaseY: V.gridRowY, confidence: 1 },
    zones: { ...V.zones },
    expectedBaselines: LEAD_IDS.map((_, k) => V.firstBaselineY + k * V.leadStepPx) as PageLayout['expectedBaselines'],
    confidence: 1,
    issues: [],
  };
}

function traceOf(points: Point[], baselineY: number, unreliable: UnreliableSpan[] = []): LeadTrace {
  return { id: 'II', points, baselineY, coverage: 1, explainedInk: 1, unreliable, confidence: 1, reasons: [] };
}

/** Time (ms) of column x with the axis origin at the left edge of the plot area. */
const tOf = (x: number) => (x - PLOT_X) / PX_PER_MS;
/** Column x of sample i. */
const xOf = (i: number) => PLOT_X + i * 2 * PX_PER_MS;

describe('digitize: synthetic trace with a known curve', () => {
  // Baseline y = 150. Flat points in every integer column 86..1233; at column 600 — an R wave 60 px up
  // (entry 599.5, peak 600, exit 600.5 — as trace builds it), at column 700 — S 30 px down;
  // from 900 to 1000 — a "roof": linear rise of 20 px to column 950 and the same descent.
  const BASE = 150;
  const roof = (x: number) => Math.max(0, 20 - (20 * Math.abs(x - 950)) / 50);
  const points: Point[] = [];
  for (let x = 86; x <= 1233; x++) {
    if (x === 600) points.push({ x: 599.5, y: BASE }, { x: 600, y: BASE - 60 }, { x: 600.5, y: BASE });
    else if (x === 700) points.push({ x: 699.5, y: BASE }, { x: 700, y: BASE + 30 }, { x: 700.5, y: BASE });
    else points.push({ x, y: BASE - roof(x) });
  }
  const signal = digitize(traceOf(points, BASE), layoutA(), CALIB);

  it('time axis: 500 Hz from the left edge of the plot area to its right edge — 2679 samples (5.356 s), t0 = 0', () => {
    expect(signal.id).toBe('II');
    expect(signal.fs).toBe(500);
    expect(signal.t0).toBe(0);
    // (1153 px) / (0.21525 px/ms) / 2 ms = 2678.3 → samples 0..2678.
    expect(signal.mv.length).toBe(2679);
    expect(signal.baselineY).toBe(BASE);
    expect(signal.unreliable).toEqual([]);
    expect(signal.confidence).toBe(1);
  });

  it('amplitudes: R peak = 60 px (1.3937 mV) and S trough = −30 px preserved by resampling, peak time ±1 ms', () => {
    const mv = Array.from(signal.mv);
    const iMax = mv.indexOf(Math.max(...mv));
    const iMin = mv.indexOf(Math.min(...mv));
    expect(Math.abs(mv[iMax] - 60 * MV_PER_PX)).toBeLessThan(1e-4);
    expect(Math.abs(mv[iMin] + 30 * MV_PER_PX)).toBeLessThan(1e-4);
    // Peak at column 600 → t = 520 / 0.21525 = 2415.8 ms; the nearest sample is 2416 ms.
    expect(Math.abs(iMax * 2 - tOf(600))).toBeLessThanOrEqual(1);
    expect(Math.abs(iMin * 2 - tOf(700))).toBeLessThanOrEqual(1);
    // Samples adjacent to the peak lie on the polyline slopes, below the peak.
    expect(mv[iMax - 1]).toBeLessThan(mv[iMax]);
    expect(mv[iMax + 1]).toBeLessThan(mv[iMax]);
  });

  it('flat and sloped spans: a sample value is a polyline point (error ≤ 0.001 px, Float32 precision), no bias on slopes', () => {
    let worstFlat = 0;
    let worstRamp = 0;
    for (let i = 0; i < signal.mv.length; i++) {
      const x = xOf(i);
      if (x < 86 || x > 1233) continue;
      // Peak columns are excluded: there a sample carries the polyline extremum, not its value at its own x.
      if (Math.abs(x - 600) <= 1 || Math.abs(x - 700) <= 1 || Math.abs(x - 950) <= 0.5) continue;
      const px = signal.mv[i] / MV_PER_PX; // upward deviation from the baseline, px
      if (x >= 900 && x <= 1000) worstRamp = Math.max(worstRamp, Math.abs(px - roof(x)));
      else worstFlat = Math.max(worstFlat, Math.abs(px));
    }
    expect(worstFlat).toBeLessThan(1e-3);
    expect(worstRamp).toBeLessThan(1e-3);
    // The "roof" peak at column 950 (20 px) is also preserved by the nearest sample.
    const near = Array.from(signal.mv).filter((_, i) => Math.abs(xOf(i) - 950) <= 1);
    expect(Math.abs(Math.max(...near) / MV_PER_PX - 20)).toBeLessThan(1e-3);
  });

  it('samples left of the first trace point hold its value (no invented data)', () => {
    // x from 80 to 86 — before the curve starts: value of the first point (0 mV).
    for (let i = 0; xOf(i) < 86; i++) expect(signal.mv[i]).toBe(0);
  });

  it('peak and trough in one column (vertical pair of trace points): both preserved in adjacent samples in polyline order', () => {
    // Narrow complex: entry 499.5, R peak (+8 px) and S trough (−40 px) at column 500, exit 500.5.
    const pts: Point[] = [];
    for (let x = 86; x <= 1233; x++) {
      if (x === 500) pts.push({ x: 499.5, y: BASE }, { x: 500, y: BASE - 8 }, { x: 500, y: BASE + 40 }, { x: 500.5, y: BASE });
      else pts.push({ x, y: BASE });
    }
    const s = digitize(traceOf(pts, BASE), layoutA(), CALIB);
    const mv = Array.from(s.mv);
    const iMax = mv.indexOf(Math.max(...mv));
    const iMin = mv.indexOf(Math.min(...mv));
    expect(Math.abs(mv[iMax] - 8 * MV_PER_PX)).toBeLessThan(1e-4);
    expect(Math.abs(mv[iMin] + 40 * MV_PER_PX)).toBeLessThan(1e-4);
    expect(iMin - iMax).toBe(1);
    expect(Math.abs(iMax * 2 - tOf(500))).toBeLessThanOrEqual(2);
  });
});

describe('digitize: unreliable trace spans are carried over to samples', () => {
  const BASE = 150;
  const BOTTOM = V.frame.y + V.frame.height - 1; // 858
  // Device clipping: column 400 goes to the frame bottom (exit 400.5 at y=855, 3 px from the border — as on a-06),
  // columns 401–410 have no points, return at column 411. Gap: no points between 599 and 621 (gap 600–620), the
  // polyline joins the edges with a straight line rising 20 px. Contact: columns 800–805 marked ambiguous, points normal.
  const points: Point[] = [];
  for (let x = 86; x <= 1233; x++) {
    if (x === 400) points.push({ x: 399.5, y: BASE }, { x: 400.5, y: BOTTOM - 3 });
    else if (x > 400 && x <= 410) continue;
    else if (x === 411) points.push({ x: 410.5, y: BOTTOM - 3 }, { x: 411.5, y: BASE });
    else if (x >= 600 && x <= 620) continue;
    else if (x === 621) points.push({ x, y: BASE + 20 });
    else if (x > 621 && x < 640) points.push({ x, y: BASE + 20 - ((x - 621) * 20) / 19 });
    else points.push({ x, y: BASE });
  }
  const spans: UnreliableSpan[] = [
    { x0: 401, x1: 410, kind: 'clipped' },
    { x0: 600, x1: 620, kind: 'gap' },
    { x0: 800, x1: 805, kind: 'ambiguous' },
  ];
  const signal = digitize(traceOf(points, BASE, spans), layoutA(), CALIB);
  const span = (kind: string) => signal.unreliable.find((u) => u.kind === kind)!;
  const idx = (x: number) => (x - PLOT_X) / PX_PER_MS / 2;

  it('clipped: span samples are at the frame border level (saturation), not a polyline segment between edges; marked in samples', () => {
    const clipped = span('clipped');
    expect(clipped).toBeDefined();
    // Columns 401..410 → x from 400.5 to 410.5 → samples ceil(744.48)=745 .. floor(767.71)=767.
    expect(clipped.i0).toBe(Math.ceil(idx(400.5)));
    expect(clipped.i1).toBe(Math.floor(idx(410.5)));
    const saturation = -(BOTTOM - BASE) * MV_PER_PX; // −16.446 mV
    const polyline = -(BOTTOM - 3 - BASE) * MV_PER_PX; // −16.376 mV — what the polyline would give
    for (let i = clipped.i0; i <= clipped.i1; i++) {
      expect(Math.abs(signal.mv[i] - saturation), `sample ${i}`).toBeLessThan(1e-3);
      expect(Math.abs(signal.mv[i] - polyline)).toBeGreaterThan(0.05);
    }
    // The deepest signal sample is exactly the frame level, not below.
    expect(Math.abs(Math.min(...signal.mv) - saturation)).toBeLessThan(1e-3);
  });

  it('gap: span samples are a linear interpolation between gap edges (not NaN, not hold), marked', () => {
    const gap = span('gap');
    expect(gap.i0).toBe(Math.ceil(idx(599.5)));
    expect(gap.i1).toBe(Math.floor(idx(620.5)));
    for (let i = gap.i0; i <= gap.i1; i++) {
      const x = xOf(i);
      const truth = -((20 * (x - 599)) / 22) * MV_PER_PX; // straight line from (599, 150) to (621, 170)
      expect(Number.isNaN(signal.mv[i])).toBe(false);
      expect(Math.abs(signal.mv[i] - truth), `sample ${i}`).toBeLessThan(1e-3);
    }
  });

  it('ambiguous: mark only, values follow trace points; spans are sorted by i0', () => {
    const ambiguous = span('ambiguous');
    expect(ambiguous.i0).toBe(Math.ceil(idx(799.5)));
    expect(ambiguous.i1).toBe(Math.floor(idx(805.5)));
    for (let i = ambiguous.i0; i <= ambiguous.i1; i++) expect(signal.mv[i]).toBe(0);
    expect(signal.unreliable.map((u) => u.kind)).toEqual(['clipped', 'gap', 'ambiguous']);
    expect(signal.confidence).toBe(1);
  });
});

describe('digitize without sheet calibration', () => {
  it('grid not found (px/mm = 0): empty signal, confidence 0, no exception', () => {
    const points: Point[] = [{ x: 86, y: 150 }, { x: 1233, y: 150 }];
    const signal = digitize(traceOf(points, 150), layoutA(0), CALIB);
    expect(signal.mv.length).toBe(0);
    expect(signal.confidence).toBe(0);
    expect(signal.unreliable).toEqual([]);
    expect(signal.id).toBe('II');
  });

  it('trace without points: empty signal, confidence 0', () => {
    const signal = digitize(traceOf([], 150), layoutA(), CALIB);
    expect(signal.mv.length).toBe(0);
    expect(signal.confidence).toBe(0);
  });
});
