import { describe, expect, it } from 'vitest';
import { digitize } from '../src/core/digitize';
import { extractInk } from '../src/core/ink';
import { analyzePage, analyzePageWith } from '../src/core/page';
import { readPageMeta } from '../src/core/pagemeta';
import { POLYSPECTRUM } from '../src/core/profile';
import { LEAD_IDS, type GrayImage, type InkMask, type LeadSignal, type LeadTrace, type PageResult } from '../src/types/contracts';
import { getFixture, listFixtures, loadFixture, type Fixture } from './fixtures';
import { beatShape, renderSheet, type SyntheticLeadTruth, type SyntheticSheetSpec } from './synthetic/sheet';

interface Analyzed {
  image: GrayImage;
  result: PageResult;
  /** Ink mask — oracle for trace checks (not in `PageResult`: it would be an extra image copy). */
  ink: InkMask;
  /** Plotter columns: from the first to the last column with ink of wide components. */
  xs: number;
  xe: number;
}

const cache = new Map<string, Analyzed>();
function analyzed(fixture: Fixture): Analyzed {
  let entry = cache.get(fixture.name);
  if (!entry) {
    const image = loadFixture(fixture);
    const result = analyzePage(image, POLYSPECTRUM);
    const ink = extractInk(image, result.layout, POLYSPECTRUM);
    const wide = ink.components.filter((c) => c.bbox.width >= 0.5 * result.layout.frame.width);
    const xs = Math.min(...wide.map((c) => c.bbox.x));
    const xe = Math.max(...wide.map((c) => c.bbox.x + c.bbox.width - 1));
    entry = { image, result, ink, xs, xe };
    cache.set(fixture.name, entry);
  }
  return entry;
}

/** Whether there is ink within a Chebyshev neighbourhood of 1 px around the point (x may be a half-integer). */
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

const insideSpan = (trace: LeadTrace, x: number) => trace.unreliable.some((s) => x >= s.x0 - 0.5 && x <= s.x1 + 0.5);

/** Share of plotter ink within 1 px of some trace (polylines rasterized ±1 px). */
function explainedByTraces(a: Analyzed): number {
  const { ink, result, xs, xe } = a;
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
  for (const trace of result.leads) {
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
  const y0 = result.layout.frame.y;
  const y1 = result.layout.frame.y + result.layout.frame.height - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = xs; x <= xe; x++) {
      if (!ink.mask[y * ink.width + x]) continue;
      total++;
      if (covered[y * ink.width + x]) explained++;
    }
  }
  return explained / total;
}

/** Axis parameters: px per sample (2 ms) and mV per px from the measured grid and the sheet calibration. */
function axes(result: PageResult): { pxPerSample: number; mvPerPx: number; x0: number } {
  const { grid, zones } = result.layout;
  return {
    pxPerSample: (grid.pxPerMmX * result.calib.mmPerS * 2) / 1000,
    mvPerPx: 1 / (grid.pxPerMmY * result.calib.mmPerMv),
    x0: zones.plot!.x,
  };
}

/** Leads whose trace baseline is up to 6 px away from the profile anchor (large complexes, drift — tasks 02/04). */
const BASELINE_EXCEPTIONS: Record<string, string[]> = {
  'a-01': ['II', 'aVR', 'aVF'],
  'a-05': ['III'],
  'b-02': ['I', 'aVR', 'aVL'],
};

/** Expected sheet issues: only a-06 (aVF clipped by the frame, III–aVR contact). */
const EXPECTED_ISSUES: Record<string, string[]> = {
  'a-06': ['ambiguous:III', 'ambiguous:aVR', 'clipped:aVF'],
};

describe('analyzePage on real sheets', () => {
  describe.each(listFixtures())('$name', (fixture) => {
    it('six traces and six signals in profile order; 500 Hz signal from the left edge of the plot area: A 5.36 s, B 5.23 s', () => {
      const { result } = analyzed(fixture);
      expect(result.leads.map((t) => t.id)).toEqual(LEAD_IDS);
      expect(result.signals.map((s) => s.id)).toEqual(LEAD_IDS);
      const lengths = new Set(result.signals.map((s) => s.mv.length));
      expect(lengths.size).toBe(1);
      const duration = (result.signals[0].mv.length - 1) / 500;
      // Plot area 1154 px: A — 1153 / (4.305 · 50) = 5.356 s; B — 1153 / (4.41 · 50) = 5.229 s.
      if (fixture.expected.variant === 'A') {
        expect(duration).toBeGreaterThanOrEqual(5.3);
        expect(duration).toBeLessThanOrEqual(5.5);
      } else {
        expect(duration).toBeGreaterThanOrEqual(5.2);
        expect(duration).toBeLessThan(5.3);
      }
      result.signals.forEach((s, k) => {
        expect(s.fs).toBe(500);
        expect(s.t0).toBe(0);
        expect(s.baselineY).toBe(result.leads[k].baselineY);
        expect(s.confidence).toBe(result.leads[k].confidence);
        expect(Array.from(s.mv).some((v) => Number.isNaN(v))).toBe(false);
      });
    });

    it('calibration read from the footer (50 mm/s, 10 mm/mV); precision ceiling from px/mm: A 0.0232 mV and 4.65 ms per px, B 0.0227 mV and 4.54 ms', () => {
      const { result } = analyzed(fixture);
      expect(result.calibSource).toBe('footer');
      expect(result.calib).toEqual({ mmPerS: 50, mmPerMv: 10 });
      const want = fixture.expected.variant === 'A' ? { mv: 1 / 43.05, ms: 1000 / 215.25 } : { mv: 1 / 44.1, ms: 1000 / 220.5 };
      expect(Math.abs(result.precision.mvPerPx - want.mv)).toBeLessThan(0.0002);
      expect(Math.abs(result.precision.msPerPx - want.ms)).toBeLessThan(0.03);
    });

    it('no issues (a-06: only clipped aVF and III–aVR contact); sheet confidence ≥ 0.8', () => {
      const { result } = analyzed(fixture);
      expect([...result.issues].sort()).toEqual(EXPECTED_ISSUES[fixture.name] ?? []);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      expect(result.layout.confidence).toBeGreaterThanOrEqual(0.95);
      expect(result.meta.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('HR digits read through the seam match expected.json', () => {
      const { result } = analyzed(fixture);
      expect(result.meta.hrRow.map((v) => v.value)).toEqual(fixture.expected.hrRow);
    });

    it('lead labels confirm the trace order; each baseline is within ±5 px of the profile anchor (exceptions — 6)', () => {
      const { result } = analyzed(fixture);
      expect(result.meta.leadLabels.map((l) => l.id)).toEqual(LEAD_IDS);
      expect(result.issues).not.toContain('lead_order_mismatch');
      const exceptions = BASELINE_EXCEPTIONS[fixture.name] ?? [];
      result.leads.forEach((t, k) => {
        const limit = exceptions.includes(t.id) ? 6 : 5;
        expect(Math.abs(t.baselineY - result.layout.expectedBaselines[k]), t.id).toBeLessThanOrEqual(limit);
      });
    });

    it('column coverage is complete: an uncovered column only inside gap/clipped or in a break of ≤ 3 columns', () => {
      const a = analyzed(fixture);
      const total = a.xe - a.xs + 1;
      for (const t of a.result.leads) {
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
      for (const t of a.result.leads) {
        let far = 0;
        for (let i = 0; i < t.points.length; i++) {
          const p = t.points[i];
          if (i > 0) expect(p.x).toBeGreaterThanOrEqual(t.points[i - 1].x);
          if (!insideSpan(t, p.x) && !inkNear(a.ink, p.x, p.y)) far++;
        }
        expect(far, `${t.id}: points farther than 1 px from ink`).toBe(0);
      }
    });

    it('at least 97 % of plotter ink is explained by traces; explainedInk of each trace ≥ 0.9', () => {
      const a = analyzed(fixture);
      expect(explainedByTraces(a)).toBeGreaterThanOrEqual(0.97);
      for (const t of a.result.leads) expect(t.explainedInk, t.id).toBeGreaterThanOrEqual(0.9);
    });

    it('no trace point lies on a text component (dark pixel inside the bbox of a glyph removed from the mask)', () => {
      const { image, ink, result } = analyzed(fixture);
      const dark = POLYSPECTRUM.thresholds.inkEdge;
      const onText: string[] = [];
      for (const t of result.leads) {
        for (const p of t.points) {
          const x = Math.round(p.x);
          const y = Math.round(p.y);
          const i = y * image.width + x;
          if (image.data[i] >= dark || ink.mask[i]) continue;
          const glyph = ink.textComponents.find(
            (c) => x >= c.bbox.x && x < c.bbox.x + c.bbox.width && y >= c.bbox.y && y < c.bbox.y + c.bbox.height,
          );
          if (glyph) onText.push(`${t.id}@(${p.x},${p.y.toFixed(1)})`);
        }
      }
      expect(onText, onText.slice(0, 5).join(' ')).toEqual([]);
    });

    it('peaks survive resampling: every trace wave of 4 px or more (local extremum within ±10 columns, up and down) is in the signal within ±1 sample', () => {
      const { result } = analyzed(fixture);
      const { pxPerSample, mvPerPx, x0 } = axes(result);
      let peaks = 0;
      const lost: string[] = [];
      result.leads.forEach((t, k) => {
        const s = result.signals[k];
        const n = s.mv.length;
        // At the edges of device clipping the signal saturates at the frame level, which is deeper than the outer trace points.
        const nearClipped = (x: number) => t.unreliable.some((u) => u.kind === 'clipped' && x >= u.x0 - 2 && x <= u.x1 + 2);
        for (const p of t.points) {
          const height = t.baselineY - p.y; // up the sheet is positive
          // Threshold 4 px (≈ 0.09 mV): in cats a-03/a-07 the tallest waves are 7.5–10 px.
          if (Math.abs(height) < 4 || insideSpan(t, p.x) || nearClipped(p.x)) continue;
          const up = height > 0;
          if (t.points.some((q) => q !== p && Math.abs(q.x - p.x) <= 10 && (up ? q.y <= p.y : q.y >= p.y))) continue;
          const j = Math.round((p.x - x0) / pxPerSample);
          if (j < 1 || j + 1 >= n) continue;
          peaks++;
          const window = [s.mv[j - 1], s.mv[j], s.mv[j + 1]];
          const got = up ? Math.max(...window) : Math.min(...window);
          if (Math.abs(got - height * mvPerPx) > 1e-3) lost.push(`${t.id}@${p.x}: trace ${height.toFixed(1)} px, signal ${(got / mvPerPx).toFixed(1)} px`);
        }
        // Global signal maximum equals the trace points maximum (in mV); global minimum is not above the points minimum.
        const inside = t.points.filter((p) => (p.x - x0) / pxPerSample <= n - 1);
        const maxPx = Math.max(...inside.map((p) => t.baselineY - p.y));
        expect(Math.abs(Math.max(...s.mv) - maxPx * mvPerPx), t.id).toBeLessThan(1e-3);
      });
      expect(peaks).toBeGreaterThanOrEqual(10);
      expect(lost, lost.slice(0, 5).join('; ')).toEqual([]);
    });
  });

  it('a-06: clipped aVF spans in the signal — saturation at the frame bottom level, no trace points inside; III–aVR contact marked ambiguous', () => {
    const { result } = analyzed(getFixture('a-06'));
    const aVF = result.signals[5];
    const trace = result.leads[5];
    const { mvPerPx } = axes(result);
    const bottom = result.layout.frame.y + result.layout.frame.height - 1;
    const saturation = (trace.baselineY - bottom) * mvPerPx;
    const clipped = aVF.unreliable.filter((u) => u.kind === 'clipped');
    expect(clipped.length).toBe(trace.unreliable.filter((u) => u.kind === 'clipped').length);
    expect(clipped.length).toBeGreaterThanOrEqual(5);
    for (const u of clipped) for (let i = u.i0; i <= u.i1; i++) expect(Math.abs(aVF.mv[i] - saturation)).toBeLessThan(1e-3);
    expect(Math.min(...aVF.mv)).toBeGreaterThanOrEqual(saturation - 1e-3);
    expect(result.signals[2].unreliable.some((u) => u.kind === 'ambiguous')).toBe(true);
    expect(result.signals[3].unreliable.some((u) => u.kind === 'ambiguous')).toBe(true);
    expect(result.confidence).toBeLessThan(1);
  });

  // Test timeout follows the ticket threshold for 11 runs (10 sheets + warm-up), not the vitest default (5 s for the whole loop).
  it('analyzePage fits the budget: ≤ 8 s per sheet (target 4 s) after warm-up', { timeout: 11 * 8000 }, () => {
    const fixtures = listFixtures();
    const images = fixtures.map((f) => analyzed(f).image);
    analyzePage(images[0], POLYSPECTRUM);
    const times = images.map((image) => {
      const t0 = performance.now();
      analyzePage(image, POLYSPECTRUM);
      return performance.now() - t0;
    });
    console.log(`analyzePage, ms per sheet:${times.map((t) => t.toFixed(0)).join(' ')}`);
    expect(Math.max(...times)).toBeLessThanOrEqual(8000);
  });

  it('memory (TECH-04): five sheets retaining gray images and all PageResults — rss growth ≤ 200 MB', { timeout: 60_000 }, () => {
    // `global.gc` exists only with --expose-gc; without it the measurement includes uncollected garbage (an upper bound).
    const gc = (globalThis as { gc?: () => void }).gc;
    const names = ['a-01', 'a-02', 'a-03', 'a-04', 'b-01'];
    gc?.();
    const before = process.memoryUsage();
    const kept: { image: GrayImage; result: PageResult }[] = [];
    for (const name of names) {
      const image = loadFixture(name);
      kept.push({ image, result: analyzePage(image, POLYSPECTRUM) });
    }
    gc?.();
    const after = process.memoryUsage();
    const mb = (bytes: number) => bytes / 1048576;
    const rssGrowth = mb(after.rss - before.rss);
    const heapGrowth = mb(after.heapUsed - before.heapUsed);
    console.log(
      `memory (gc ${gc ? 'yes' : 'no'}): rss ${mb(before.rss).toFixed(1)} → ${mb(after.rss).toFixed(1)} MB (+${rssGrowth.toFixed(1)}); ` +
        `heapUsed ${mb(before.heapUsed).toFixed(1)} → ${mb(after.heapUsed).toFixed(1)} MB (+${heapGrowth.toFixed(1)})`,
    );
    expect(kept.length).toBe(5);
    expect(kept.every((k) => k.result.signals.length === 6 && k.image.data.length > 0)).toBe(true);
    expect(rssGrowth).toBeLessThanOrEqual(200);
  });
});

const PERIOD = 120;

/** Six curves without drift: peaks up to 100 px, deep S; the II–III pair touches. */
const SIX_LEADS: SyntheticSheetSpec = {
  leads: {
    I: beatShape({ periodPx: PERIOD, r: 45, s: 10, phasePx: 7 }),
    II: beatShape({ periodPx: PERIOD, r: 100, s: 64, q: 8, phasePx: 7 }),
    III: beatShape({ periodPx: PERIOD, r: 65, s: 20, phasePx: 7 + 0.04 * PERIOD }),
    aVR: beatShape({ periodPx: PERIOD, r: 15, s: 60, t: -10, phasePx: 7 }),
    aVL: beatShape({ periodPx: PERIOD, r: 30, s: 8, phasePx: 7 }),
    aVF: beatShape({ periodPx: PERIOD, r: 70, s: 30, phasePx: 7 }),
  },
};

/** Flat column: the true curve range in the column and its neighbours is at most 0.6 px. */
function isFlat(lead: SyntheticLeadTruth, x: number): boolean {
  return [x - 1, x, x + 1].every((c) => {
    const e = lead.extremes(c);
    return e.bottom - e.top <= 0.6;
  });
}

/** True curve extremes: local minima of the top and maxima of the bottom more than 8 px from the baseline. */
function trueExtremes(lead: SyntheticLeadTruth, x0: number, x1: number): { x: number; y: number; kind: 'top' | 'bottom' }[] {
  const out: { x: number; y: number; kind: 'top' | 'bottom' }[] = [];
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (let x = x0; x <= x1; x++) {
    const e = lead.extremes(x);
    tops.push(e.top);
    bottoms.push(e.bottom);
  }
  for (let i = 3; i < tops.length - 3; i++) {
    const x = x0 + i;
    if (lead.baselineY - tops[i] >= 8 && [1, 2, 3].every((d) => tops[i] < tops[i - d] && tops[i] < tops[i + d])) out.push({ x, y: tops[i], kind: 'top' });
    if (bottoms[i] - lead.baselineY >= 8 && [1, 2, 3].every((d) => bottoms[i] > bottoms[i - d] && bottoms[i] > bottoms[i + d])) out.push({ x, y: bottoms[i], kind: 'bottom' });
  }
  return out;
}

/** Sheet y that a signal sample corresponds to (inverse digitization relative to the trace baseline). */
const yOfSample = (s: LeadSignal, i: number, mvPerPx: number) => s.baselineY - s.mv[i] / mvPerPx;

describe('analyzePage on a synthetic sheet with a known curve', () => {
  const sheet = renderSheet(SIX_LEADS);
  const result = analyzePage(sheet.image, POLYSPECTRUM);
  const { pxPerSample, mvPerPx, x0 } = axes(result);
  const xStart = sheet.spec.xStart + 4;
  const xEnd = sheet.spec.xEnd - 4;

  it('without a footer calibration defaults to 50/10 (default); with options.calib — manual', () => {
    expect(result.calibSource).toBe('default');
    expect(result.calib).toEqual({ mmPerS: 50, mmPerMv: 10 });
    const manual = analyzePage(sheet.image, POLYSPECTRUM, { calib: { mmPerS: 25, mmPerMv: 20 } });
    expect(manual.calibSource).toBe('manual');
    expect(manual.calib).toEqual({ mmPerS: 25, mmPerMv: 20 });
    // Half the paper speed → twice the recording length in seconds; twice the gain → half the mV.
    expect(manual.signals[1].mv.length).toBeGreaterThan(result.signals[1].mv.length * 1.9);
    expect(Math.max(...manual.signals[1].mv)).toBeCloseTo(Math.max(...result.signals[1].mv) / 2, 3);
  });

  it('sheet without text: empty pagemeta fields in issues (hr_row_empty, footer_empty) and header_name_unanchored; no exceptions', () => {
    expect(result.issues).toEqual(expect.arrayContaining(['hr_row_empty', 'footer_empty', 'header_name_unanchored']));
    expect(result.issues.some((i) => i.startsWith('exception'))).toBe(false);
    expect(result.meta.footerCalib).toBeUndefined();
  });

  it('flat spans: the signal restores the curve with error ≤ 0.5 px — both in position and in amplitude from the true baseline', () => {
    result.signals.forEach((s, k) => {
      const lead = sheet.leads[k];
      const trace = result.leads[k];
      const errors: string[] = [];
      let checked = 0;
      let worst = 0;
      let worstAmplitude = 0;
      for (let i = 0; i < s.mv.length; i++) {
        const x = x0 + i * pxPerSample;
        const column = Math.round(x);
        if (column < xStart || column > xEnd || !isFlat(lead, column) || insideSpan(trace, x)) continue;
        // Near a "+" on the curve the trace allows 1 px (task 04 test).
        if (sheet.plusMarks.some((m) => Math.abs(m.x - x) <= 3 && Math.abs(lead.y(m.x) - m.y) <= 6)) continue;
        const err = Math.abs(yOfSample(s, i, mvPerPx) - lead.y(x));
        // Amplitude in px relative to the true baseline — includes the trace baseline error (≤ 0.27 px here).
        const amplitudeErr = Math.abs(s.mv[i] / mvPerPx - (lead.baselineY - lead.y(x)));
        checked++;
        worst = Math.max(worst, err);
        worstAmplitude = Math.max(worstAmplitude, amplitudeErr);
        if (err > 0.5) errors.push(`x=${x.toFixed(1)}: ${err.toFixed(2)}`);
      }
      expect(checked, s.id).toBeGreaterThan(500);
      expect(errors, `${s.id}: ${errors.length} errors, worst ${worst.toFixed(2)}`).toEqual([]);
      expect(worstAmplitude, `${s.id}: amplitude`).toBeLessThanOrEqual(0.5);
    });
  });

  it('peaks: the signal extremum at each wave equals the trace extremum (nothing lost) and lies within ±1 px of truth', () => {
    result.signals.forEach((s, k) => {
      const lead = sheet.leads[k];
      const trace = result.leads[k];
      const extremes = trueExtremes(lead, xStart, xEnd);
      expect(extremes.length, s.id).toBeGreaterThan(10);
      const lost: string[] = [];
      const off: string[] = [];
      let worstTruth = 0;
      for (const e of extremes) {
        const nearPts = trace.points.filter((p) => Math.abs(p.x - e.x) <= 1);
        const j = Math.round((e.x - x0) / pxPerSample);
        const samples = [j - 3, j - 2, j - 1, j, j + 1, j + 2, j + 3].map((i) => yOfSample(s, i, mvPerPx));
        const traceY = e.kind === 'top' ? Math.min(...nearPts.map((p) => p.y)) : Math.max(...nearPts.map((p) => p.y));
        const signalY = e.kind === 'top' ? Math.min(...samples) : Math.max(...samples);
        if (Math.abs(signalY - traceY) > 1e-3) lost.push(`${e.kind}@${e.x}: trace ${traceY.toFixed(2)}, signal ${signalY.toFixed(2)}`);
        const err = Math.abs(signalY - e.y);
        worstTruth = Math.max(worstTruth, err);
        if (err > 1) off.push(`${e.kind}@${e.x}: truth ${e.y.toFixed(1)}, signal ${signalY.toFixed(1)}`);
      }
      expect(lost, `${s.id}: ${lost.slice(0, 4).join('; ')}`).toEqual([]);
      expect(off, `${s.id}: worst ${worstTruth.toFixed(2)}: ${off.slice(0, 4).join('; ')}`).toEqual([]);
    });
  });
});

describe('analyzePage: a step exception is caught and becomes a sheet issue', () => {
  const sheet = renderSheet({ leads: { II: beatShape({ periodPx: PERIOD, r: 40, phasePx: 7 }) } });
  const boom = (step: string) => () => {
    throw new Error(`boom ${step}`);
  };

  it('throwing traceLeads: issues start with exception:trace:<msg>, confidence 0, layout and meta kept, no traces or signals', () => {
    const result = analyzePageWith({ traceLeads: boom('trace') }, sheet.image, POLYSPECTRUM);
    expect(result.issues[0]).toBe('exception:trace:boom trace');
    expect(result.confidence).toBe(0);
    expect(result.layout.confidence).toBeGreaterThan(0.8);
    expect(result.leads).toEqual([]);
    expect(result.signals).toEqual([]);
    expect(result.meta.leadLabels).toEqual([]);
    expect(result.calibSource).toBe('default');
  });

  it('traceLeads that caught the exception itself (six empty traces with reasons exception:<msg>): one exception:trace:<msg> entry first in issues, six empty signals, confidence 0', () => {
    const emptyTraces = (): LeadTrace[] =>
      LEAD_IDS.map((id, k) => ({ id, points: [], baselineY: 100 + k * 129, coverage: 0, explainedInk: 0, unreliable: [], confidence: 0, reasons: ['exception:boom inside'] }));
    const result = analyzePageWith({ traceLeads: emptyTraces }, sheet.image, POLYSPECTRUM);
    expect(result.issues[0]).toBe('exception:trace:boom inside');
    expect(result.issues.filter((i) => i.startsWith('exception:')).length).toBe(1);
    expect(result.leads.map((t) => t.id)).toEqual(LEAD_IDS);
    expect(result.signals.map((s) => s.id)).toEqual(LEAD_IDS);
    for (const s of result.signals) {
      expect(s.mv.length).toBe(0);
      expect(s.confidence).toBe(0);
    }
    expect(result.confidence).toBe(0);
    expect(result.issues).not.toContain('coverage:I');
  });

  it('throwing readPageMeta: exception:pagemeta:<msg>, traces and signals present, default calibration, confidence 0', () => {
    const result = analyzePageWith({ readPageMeta: boom('meta') }, sheet.image, POLYSPECTRUM);
    expect(result.issues).toContain('exception:pagemeta:boom meta');
    expect(result.leads.map((t) => t.id)).toEqual(LEAD_IDS);
    expect(result.signals.map((s) => s.id)).toEqual(LEAD_IDS);
    expect(result.signals[1].mv.length).toBeGreaterThan(2000);
    expect(result.calibSource).toBe('default');
    expect(result.meta.confidence).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('throwing digitize for one lead: exception:digitize:<id>:<msg>, its signal is empty with confidence 0, the others are digitized', () => {
    const result = analyzePageWith(
      {
        digitize: (trace, layout, calib) => {
          if (trace.id === 'III') throw new Error('boom digitize');
          return digitize(trace, layout, calib);
        },
      },
      sheet.image,
      POLYSPECTRUM,
    );
    expect(result.issues).toContain('exception:digitize:III:boom digitize');
    expect(result.signals.map((s) => s.id)).toEqual(LEAD_IDS);
    expect(result.signals[2].mv.length).toBe(0);
    expect(result.signals[2].confidence).toBe(0);
    expect(result.signals[1].mv.length).toBeGreaterThan(2000);
    expect(result.leads.map((t) => t.id)).toEqual(LEAD_IDS);
    expect(result.confidence).toBe(0);
  });

  it('throwing detectLayout: exception:layout:<msg>, a placeholder result — no traces, signals or reading, confidence 0', () => {
    const result = analyzePageWith({ detectLayout: boom('layout') }, sheet.image, POLYSPECTRUM);
    expect(result.issues).toEqual(['exception:layout:boom layout']);
    expect(result.leads).toEqual([]);
    expect(result.signals).toEqual([]);
    expect(result.layout.confidence).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.precision).toEqual({ mvPerPx: 0, msPerPx: 0 });
  });

  it('throwing extractInk: exception:ink:<msg>, layout and reading kept, no traces', () => {
    const result = analyzePageWith({ extractInk: boom('ink') }, sheet.image, POLYSPECTRUM);
    expect(result.issues[0]).toBe('exception:ink:boom ink');
    expect(result.layout.confidence).toBeGreaterThan(0.8);
    expect(result.leads).toEqual([]);
    expect(result.signals).toEqual([]);
    expect(result.confidence).toBe(0);
  });
});

describe('analyzePage: manual calibration beats the footer (INPUT-03)', () => {
  it('a-02 with a readable 50/10 footer and options.calib 25/20: calibSource manual, signal recomputed, issue calib_manual_overrides_footer:50/10', () => {
    const { image, result: byFooter } = analyzed(getFixture('a-02'));
    expect(byFooter.calibSource).toBe('footer');
    const manual = analyzePage(image, POLYSPECTRUM, { calib: { mmPerS: 25, mmPerMv: 20 } });
    expect(manual.calibSource).toBe('manual');
    expect(manual.calib).toEqual({ mmPerS: 25, mmPerMv: 20 });
    expect(manual.meta.footerCalib).toEqual({ mmPerS: 50, mmPerMv: 10 });
    expect(manual.issues).toContain('calib_manual_overrides_footer:50/10');
    // Half the paper speed → twice the samples for the same width; twice the gain → half the mV.
    expect(manual.signals[1].mv.length).toBeGreaterThan(byFooter.signals[1].mv.length * 1.99);
    expect(Math.max(...manual.signals[1].mv)).toBeCloseTo(Math.max(...byFooter.signals[1].mv) / 2, 4);
    expect(manual.precision.msPerPx).toBeCloseTo(byFooter.precision.msPerPx * 2, 6);
    expect(manual.precision.mvPerPx).toBeCloseTo(byFooter.precision.mvPerPx / 2, 6);
    // The other sheet issues are unchanged.
    expect(manual.issues.filter((i) => !i.startsWith('calib_manual_overrides_footer'))).toEqual(byFooter.issues);
  });

  it('manual calibration equal to the footer: source manual, no mismatch warning', () => {
    const { image, result: byFooter } = analyzed(getFixture('a-02'));
    const same = analyzePage(image, POLYSPECTRUM, { calib: { mmPerS: 50, mmPerMv: 10 } });
    expect(same.calibSource).toBe('manual');
    expect(same.issues).toEqual(byFooter.issues);
    expect(same.signals[1].mv.length).toBe(byFooter.signals[1].mv.length);
  });
});

describe('analyzePage: labels and trace order', () => {
  it('pagemeta labels not matching the traces by y (I and II swapped) give lead_order_mismatch and halve the confidence', () => {
    const fixture = getFixture('a-02');
    const { image, result: clean } = analyzed(fixture);
    const swapped = analyzePageWith(
      {
        readPageMeta: (img, layout, profile) => {
          const meta = readPageMeta(img, layout, profile);
          const [a, b] = meta.leadLabels;
          meta.leadLabels = [{ ...a, id: b.id }, { ...b, id: a.id }, ...meta.leadLabels.slice(2)];
          return meta;
        },
      },
      image,
      POLYSPECTRUM,
    );
    expect(swapped.issues).toContain('lead_order_mismatch');
    expect(swapped.confidence).toBeCloseTo(clean.confidence / 2, 6);
    expect(swapped.leads.map((t) => t.id)).toEqual(LEAD_IDS);
  });
});
