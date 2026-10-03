import { describe, expect, it } from 'vitest';
import { extractInk } from '../src/core/ink';
import { detectLayout } from '../src/core/layout';
import { POLYSPECTRUM } from '../src/core/profile';
import { traceLeads } from '../src/core/trace';
import { LEAD_IDS, type GrayImage, type InkMask, type LeadTrace, type PageLayout } from '../src/types/contracts';
import { getFixture, listFixtures, loadFixture, type Fixture } from './fixtures';

interface Analyzed {
  image: GrayImage;
  layout: PageLayout;
  ink: InkMask;
  traces: LeadTrace[];
  /** Plotter columns: from the first to the last column with ink of wide components. */
  xs: number;
  xe: number;
}

/** One `detectLayout` + `extractInk` + `traceLeads` run per fixture — the result is reused. */
const cache = new Map<string, Analyzed>();
function analyzed(fixture: Fixture): Analyzed {
  let entry = cache.get(fixture.name);
  if (!entry) {
    const image = loadFixture(fixture);
    const layout = detectLayout(image, POLYSPECTRUM);
    const ink = extractInk(image, layout, POLYSPECTRUM);
    const traces = traceLeads(ink, layout, POLYSPECTRUM);
    const wide = ink.components.filter((c) => c.bbox.width >= 0.5 * layout.frame.width);
    const xs = Math.min(...wide.map((c) => c.bbox.x));
    const xe = Math.max(...wide.map((c) => c.bbox.x + c.bbox.width - 1));
    entry = { image, layout, ink, traces, xs, xe };
    cache.set(fixture.name, entry);
  }
  return entry;
}

/** Whether there is ink in the 1 px Chebyshev neighbourhood of a point (x may be a half-integer). */
function inkNear(ink: InkMask, x: number, y: number): boolean {
  const ry = Math.round(y);
  for (const cx of new Set([Math.floor(x), Math.ceil(x)])) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = cx + dx;
        const py = ry + dy;
        if (px < 0 || py < 0 || px >= ink.width || py >= ink.height) continue;
        if (ink.mask[py * ink.width + px]) return true;
      }
    }
  }
  return false;
}

function insideSpan(trace: LeadTrace, x: number): boolean {
  return trace.unreliable.some((s) => x >= s.x0 - 0.5 && x <= s.x1 + 0.5);
}

/**
 * Share of plotter ink lying within 1 px of some trace: polylines are rasterized segment by segment
 * with 1 px dilation — a check independent of `explainedInk`.
 */
function explainedByTraces(a: Analyzed): number {
  const { ink, traces, xs, xe, layout } = a;
  const covered = new Uint8Array(ink.width * ink.height);
  const stamp = (x: number, y: number) => {
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const px = cx + dx;
      const py = cy + dy;
      if (px >= 0 && py >= 0 && px < ink.width && py < ink.height) covered[py * ink.width + px] = 1;
    }
  };
  for (const trace of traces) {
    const pts = trace.points;
    for (let i = 0; i < pts.length; i++) {
      stamp(pts[i].x, pts[i].y);
      if (i + 1 < pts.length) {
        const a0 = pts[i];
        const a1 = pts[i + 1];
        const steps = Math.ceil(Math.max(Math.abs(a1.x - a0.x), Math.abs(a1.y - a0.y)) * 2);
        for (let s = 1; s < steps; s++) stamp(a0.x + ((a1.x - a0.x) * s) / steps, a0.y + ((a1.y - a0.y) * s) / steps);
      }
    }
  }
  let total = 0;
  let explained = 0;
  const y0 = layout.frame.y;
  const y1 = layout.frame.y + layout.frame.height - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = xs; x <= xe; x++) {
      if (!ink.mask[y * ink.width + x]) continue;
      total++;
      if (covered[y * ink.width + x]) explained++;
    }
  }
  return explained / total;
}

/**
 * Leads whose ink mode is more than 2.5 px from the profile anchor (large complexes, drift — task 02
 * report, `test/layout.test.ts`): their trace baseline may be up to 6 px from the anchor
 * (a-01 aVF: 5.0–5.1 px with an ink mode of 4.2 px).
 */
const BASELINE_EXCEPTIONS: Record<string, string[]> = {
  'a-01': ['II', 'aVR', 'aVF'],
  'a-05': ['III'],
  'b-02': ['I', 'aVR', 'aVL'],
};

describe('traceLeads on real sheets', () => {
  describe.each(listFixtures())('$name', (fixture) => {
    it('exactly 6 traces in profile order; each baseline within ±5 px of the profile anchor (known exceptions — 6)', () => {
      const { layout, traces } = analyzed(fixture);
      expect(traces.map((t) => t.id)).toEqual(LEAD_IDS);
      const exceptions = BASELINE_EXCEPTIONS[fixture.name] ?? [];
      traces.forEach((t, k) => {
        const limit = exceptions.includes(t.id) ? 6 : 5;
        expect(Math.abs(t.baselineY - layout.expectedBaselines[k]), `${t.id}: baseline ${t.baselineY.toFixed(1)}, anchor ${layout.expectedBaselines[k].toFixed(1)}`).toBeLessThanOrEqual(limit);
      });
    });

    it('column coverage is full: an uncovered column only inside gap/clipped or in a break of ≤ 3 columns', () => {
      const a = analyzed(fixture);
      const total = a.xe - a.xs + 1;
      for (const t of a.traces) {
        const hasPoint = new Uint8Array(total);
        for (const p of t.points) {
          const x = Math.round(p.x);
          if (x >= a.xs && x <= a.xe) hasPoint[x - a.xs] = 1;
        }
        const marked = new Uint8Array(total);
        for (const u of t.unreliable) {
          if (u.kind === 'ambiguous') continue;
          for (let x = Math.max(a.xs, u.x0); x <= Math.min(a.xe, u.x1); x++) marked[x - a.xs] = 1;
        }
        const bad: number[] = [];
        let run = 0;
        for (let i = 0; i <= total; i++) {
          const missing = i < total && !hasPoint[i] && !marked[i];
          if (missing) run++;
          else {
            if (run > 3) for (let j = i - run; j < i; j++) bad.push(a.xs + j);
            run = 0;
          }
        }
        expect(bad, `${t.id}: unmarked breaks longer than 3 columns at x=${bad.slice(0, 6).join(',')}`).toEqual([]);
        const markedCount = marked.reduce((s, v) => s + v, 0);
        expect(t.coverage, t.id).toBeGreaterThanOrEqual((total - markedCount - 12) / total);
      }
    });

    it('every trace point outside marked spans lies within 1 px of ink; x is non-decreasing', () => {
      const a = analyzed(fixture);
      for (const t of a.traces) {
        let far = 0;
        for (let i = 0; i < t.points.length; i++) {
          const p = t.points[i];
          if (i > 0) expect(p.x).toBeGreaterThanOrEqual(t.points[i - 1].x);
          if (!insideSpan(t, p.x) && !inkNear(a.ink, p.x, p.y)) far++;
        }
        expect(far, `${t.id}: points farther than 1 px from ink`).toBe(0);
      }
    });

    it('at least 97 % of plotter ink is explained by traces (polyline rasterization ±1 px); explainedInk of each trace ≥ 0.9', () => {
      const a = analyzed(fixture);
      expect(explainedByTraces(a)).toBeGreaterThanOrEqual(0.97);
      for (const t of a.traces) expect(t.explainedInk, t.id).toBeGreaterThanOrEqual(0.9);
    });
  });

  it('extractInk + traceLeads fit into 3 s per sheet after warm-up (target 1.5 s)', () => {
    const fixtures = listFixtures();
    const first = analyzed(fixtures[0]);
    traceLeads(extractInk(first.image, first.layout, POLYSPECTRUM), first.layout, POLYSPECTRUM);
    const times = fixtures.map((f) => {
      const { image, layout } = analyzed(f);
      const t0 = performance.now();
      traceLeads(extractInk(image, layout, POLYSPECTRUM), layout, POLYSPECTRUM);
      return performance.now() - t0;
    });
    console.log(`ink+trace, ms per sheet:${times.map((t) => t.toFixed(0)).join(' ')}`);
    expect(Math.max(...times)).toBeLessThanOrEqual(3000);
  });
});

const pointsIn = (t: LeadTrace, x0: number, x1: number) => t.points.filter((p) => p.x >= x0 && p.x <= x1);
const minY = (pts: { y: number }[]) => Math.min(...pts.map((p) => p.y));
const maxY = (pts: { y: number }[]) => Math.max(...pts.map((p) => p.y));

describe('a-06: III–aVR contact and aVF clipped by the frame', () => {
  it('III S waves and aVR complexes belong to their own traces: III goes down to the aVR baseline, aVR stays at its own; contact is marked ambiguous', () => {
    const { traces, layout } = analyzed(getFixture('a-06'));
    const III = traces[2];
    const aVR = traces[3];
    // Deep III S waves (≥ 120 px below the baseline) are present in each of ~15 complexes.
    const deepColumns = new Set(III.points.filter((p) => p.y >= III.baselineY + 120).map((p) => Math.round(p.x)));
    expect(deepColumns.size).toBeGreaterThanOrEqual(12);
    // aVR does not go up to III: with a wrong separation it would take the III stroke up to y≈383 (155 px above its baseline).
    expect(minY(aVR.points)).toBeGreaterThanOrEqual(aVR.baselineY - 70);
    // The "trace does not cross another lead's baseline" invariant — with 15 px tolerance: the III S trough hits the aVR baseline.
    expect(maxY(III.points)).toBeLessThanOrEqual(aVR.baselineY + 15);
    expect(minY(aVR.points)).toBeGreaterThanOrEqual(III.baselineY - 15);
    expect(minY(III.points)).toBeGreaterThanOrEqual(layout.expectedBaselines[1] - 15);
    const ambiguous = III.unreliable.filter((u) => u.kind === 'ambiguous');
    const columns = ambiguous.reduce((s, u) => s + (u.x1 - u.x0 + 1), 0);
    expect(ambiguous.length).toBeGreaterThanOrEqual(6);
    expect(columns).toBeGreaterThanOrEqual(20);
    expect(columns).toBeLessThanOrEqual(80);
    expect(III.reasons).toContain('ambiguous');
    expect(aVR.reasons).toContain('ambiguous');
  });

  it('aVF: S waves below the frame — clipped spans at the bottom edge, no points inside, 25–45 columns in total', () => {
    const { traces, layout } = analyzed(getFixture('a-06'));
    const aVF = traces[5];
    const bottom = layout.frame.y + layout.frame.height - 1;
    const clipped = aVF.unreliable.filter((u) => u.kind === 'clipped');
    expect(clipped.length).toBeGreaterThanOrEqual(5);
    const columns = clipped.reduce((s, u) => s + (u.x1 - u.x0 + 1), 0);
    expect(columns).toBeGreaterThanOrEqual(25);
    expect(columns).toBeLessThanOrEqual(45);
    for (const u of clipped) {
      expect(pointsIn(aVF, u.x0, u.x1), `points inside clipped ${u.x0}-${u.x1}`).toEqual([]);
      const edges = [...pointsIn(aVF, u.x0 - 2, u.x0 - 0.5), ...pointsIn(aVF, u.x1 + 0.5, u.x1 + 2)];
      expect(edges.length).toBeGreaterThan(0);
      expect(maxY(edges), `edges of span ${u.x0}-${u.x1} at the bottom frame edge`).toBeGreaterThanOrEqual(bottom - 3);
    }
    expect(aVF.reasons).toContain('clipped');
    expect(aVF.unreliable.filter((u) => u.kind === 'gap')).toEqual([]);
    expect(aVF.confidence).toBeLessThan(1);
  });
});

describe('a-04: diagonal aVF segment', () => {
  it('is connected: no gaps, no clipping, coverage 100 %', () => {
    const { traces } = analyzed(getFixture('a-04'));
    const aVF = traces[5];
    expect(aVF.unreliable).toEqual([]);
    expect(aVF.coverage).toBe(1);
    expect(aVF.reasons).toEqual([]);
  });
});

describe('a-01: the tallest R (II, x≈860, run ≈ 100 px at hysteresis 170)', () => {
  it('the trace peak reaches the ink top ±1 px; steep columns yield several points each', () => {
    const a = analyzed(getFixture('a-01'));
    const II = a.traces[1];
    // The trace peak is the highest point in columns 859–864; it must lie on its run no lower than
    // 1 px from the run top (the lead I S wave in neighbouring columns comes down to 1 px from the R peak,
    // so the "ink top" is taken from the run the point sits on, not from the band).
    const near = pointsIn(II, 858.5, 864.5);
    const top = minY(near);
    const peak = near.find((p) => p.y === top)!;
    expect(top).toBeLessThan(II.baselineY - 90);
    const column = Math.round(peak.x);
    expect(a.ink.mask[Math.round(top) * a.ink.width + column], 'peak on ink').not.toBe(0);
    let runTop = Math.round(top);
    while (runTop > 0 && a.ink.mask[(runTop - 1) * a.ink.width + column]) runTop--;
    expect(Math.round(top) - runTop, `trace peak ${top} in column ${column}, run top ${runTop}`).toBeLessThanOrEqual(1);
    for (let x = 859; x <= 865; x++) expect(pointsIn(II, x - 0.5, x + 0.5).length, `column ${x}`).toBeGreaterThanOrEqual(2);
  });
});
