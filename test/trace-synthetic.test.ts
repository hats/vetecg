import { describe, expect, it } from 'vitest';
import { createGrayImage } from '../src/core/image';
import { extractInk } from '../src/core/ink';
import { detectLayout } from '../src/core/layout';
import { POLYSPECTRUM } from '../src/core/profile';
import { traceLeads } from '../src/core/trace';
import { LEAD_IDS, type LeadTrace, type TraceHint } from '../src/types/contracts';
import { beatShape, renderSheet, type SyntheticLeadTruth, type SyntheticSheet, type SyntheticSheetSpec } from './synthetic/sheet';

function analyze(spec: SyntheticSheetSpec, hints?: TraceHint[]): { sheet: SyntheticSheet; traces: LeadTrace[] } {
  const sheet = renderSheet(spec);
  const layout = detectLayout(sheet.image, POLYSPECTRUM);
  const ink = extractInk(sheet.image, layout, POLYSPECTRUM);
  return { sheet, traces: traceLeads(ink, layout, POLYSPECTRUM, hints) };
}

const PERIOD = 120;

/** Six curves: peaks up to 100 px, deep S, drift; the II–III pair touches (S II + R III = lead step). */
const SIX_LEADS: SyntheticSheetSpec = {
  leads: {
    I: beatShape({ periodPx: PERIOD, r: 45, s: 10, phasePx: 7 }),
    II: beatShape({ periodPx: PERIOD, r: 100, s: 64, q: 8, phasePx: 7 }),
    III: beatShape({ periodPx: PERIOD, r: 65, s: 20, phasePx: 7 + 0.04 * PERIOD }),
    aVR: beatShape({ periodPx: PERIOD, r: 15, s: 60, t: -10, phasePx: 7 }),
    aVL: beatShape({ periodPx: PERIOD, r: 30, s: 8, phasePx: 7 }),
    aVF: beatShape({ periodPx: PERIOD, r: 70, s: 30, phasePx: 7, driftPerPx: 0.01 }),
  },
};

interface Extreme {
  x: number;
  y: number;
  kind: 'top' | 'bottom';
}

/** True curve extremes: local minima of the top and maxima of the bottom deeper than 8 px from the baseline. */
function trueExtremes(lead: SyntheticLeadTruth, x0: number, x1: number): Extreme[] {
  const out: Extreme[] = [];
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

/** Flat column: curve span in the column and its neighbours is at most 0.6 px. */
function isFlat(lead: SyntheticLeadTruth, x: number): boolean {
  return [x - 1, x, x + 1].every((c) => {
    const e = lead.extremes(c);
    return e.bottom - e.top <= 0.6;
  });
}

describe('traceLeads on a synthetic sheet', () => {
  const { sheet, traces } = analyze(SIX_LEADS);
  const x0 = sheet.spec.xStart + 4;
  const x1 = sheet.spec.xEnd - 4;

  it('six traces are not mixed up: each baseline within 1 px of truth (drifting aVF — mid-sheet level ±2.5), the touching II–III pair is separated', () => {
    expect(traces.map((t) => t.id)).toEqual(LEAD_IDS);
    traces.forEach((t, k) => {
      // aVF drifts by 0.01 px/column: its single baseline is the mid-sheet level.
      const drift = t.id === 'aVF' ? 0.01 * ((x0 + x1) / 2) : 0;
      expect(Math.abs(t.baselineY - (sheet.leads[k].baselineY - drift)), t.id).toBeLessThanOrEqual(t.id === 'aVF' ? 2.5 : 1);
    });
    // The pair touches at ink level: in the S II trough column there are at most 2 white rows between its ink and
    // the ink of the R III peak (such a gap merges into one run).
    const II = sheet.leads[1];
    const III = sheet.leads[2];
    // Third deep S II trough (≥ 40 px) and third tall R III peak (≥ 40 px; P waves are not counted).
    const s = trueExtremes(II, x0, x1).filter((e) => e.kind === 'bottom' && e.y - II.baselineY >= 40)[2];
    const r = trueExtremes(III, x0, x1).filter((e) => e.kind === 'top' && III.baselineY - e.y >= 40)[2];
    expect(Math.abs(s.x - r.x)).toBeLessThanOrEqual(1);
    expect(r.y - s.y).toBeLessThanOrEqual(4);
    const ink = extractInk(sheet.image, detectLayout(sheet.image, POLYSPECTRUM), POLYSPECTRUM);
    const isInk = (y: number) => ink.mask[y * ink.width + s.x] !== 0;
    let sInk = Math.round(s.y) + 2;
    while (!isInk(sInk)) sInk--;
    let rInk = Math.round(r.y) - 2;
    while (!isInk(rInk)) rInk++;
    expect(rInk - sInk - 1, `white rows between the tips in column ${s.x}`).toBeLessThanOrEqual(2);
  });

  it('flat segments: error ≤ 0.5 px (≤ 1 px within ±3 columns of a "+" on the curve), no outliers', () => {
    traces.forEach((t, k) => {
      const lead = sheet.leads[k];
      const marksX = sheet.plusMarks.filter((m) => Math.abs(lead.y(m.x) - m.y) <= 6).map((m) => m.x);
      const errors: string[] = [];
      let checked = 0;
      let worst = 0;
      for (let x = x0; x <= x1; x++) {
        if (!isFlat(lead, x)) continue;
        if (t.unreliable.some((u) => x >= u.x0 && x <= u.x1)) continue;
        const p = t.points.find((q) => q.x === x);
        if (!p) {
          errors.push(`x=${x}: no point`);
          continue;
        }
        const err = Math.abs(p.y - lead.y(x));
        const nearPlus = marksX.some((mx) => Math.abs(mx - x) <= 3);
        checked++;
        worst = Math.max(worst, err);
        if (err > (nearPlus ? 1 : 0.5)) errors.push(`x=${x}: ${err.toFixed(2)}${nearPlus ? ' (near "+")' : ''}`);
      }
      expect(checked, t.id).toBeGreaterThan(300);
      expect(errors, `${t.id}: ${errors.length} errors, worst ${worst.toFixed(2)}`).toEqual([]);
    });
  });

  it('peaks: trace peak/trough within ±1 px of the true extreme for every wave', () => {
    traces.forEach((t, k) => {
      const lead = sheet.leads[k];
      const extremes = trueExtremes(lead, x0, x1);
      expect(extremes.length, t.id).toBeGreaterThan(10);
      const errors: string[] = [];
      for (const e of extremes) {
        const near = t.points.filter((p) => Math.abs(p.x - e.x) <= 1);
        const got = e.kind === 'top' ? Math.min(...near.map((p) => p.y)) : Math.max(...near.map((p) => p.y));
        if (!(Math.abs(got - e.y) <= 1)) errors.push(`${e.kind}@${e.x}: truth ${e.y.toFixed(1)}, trace ${got.toFixed(1)}`);
      }
      expect(errors, `${t.id}: ${errors.join('; ')}`).toEqual([]);
    });
  });

  it('confidence of each trace is 1 with no reasons: no gaps, clipping or ambiguity', () => {
    for (const t of traces) {
      expect(t.coverage, t.id).toBe(1);
      expect(t.explainedInk, t.id).toBeGreaterThanOrEqual(0.99);
      expect(t.reasons, t.id).toEqual([]);
      expect(t.confidence, t.id).toBe(1);
    }
  });
});

describe('synthetic double of a-06: a deep S runs into the neighbour\'s flat baseline', () => {
  // II: wide S 150 px deep — the trough is ~21 px below the III anchor (409), contact lasts 3–4 columns;
  // III: almost flat with small waves at the same x. No white row between the curves — as with III–aVR in a-06.
  const { sheet, traces } = analyze({
    leads: {
      II: beatShape({ periodPx: PERIOD, r: 20, s: 150, q: 0, phasePx: 7, widths: { qrs: 12 } }),
      III: beatShape({ periodPx: PERIOD, r: 5, s: 2, p: 3, t: 4, phasePx: 7, widths: { qrs: 12 } }),
    },
  });
  const II = traces[1];
  const III = traces[2];
  const x0 = sheet.spec.xStart + 4;
  const x1 = sheet.spec.xEnd - 4;

  it('S II troughs reach truth ±1 px, III stays on its baseline (±0.5 px outside contact), contact is marked ambiguous on both', () => {
    expect(Math.abs(II.baselineY - sheet.leads[1].baselineY)).toBeLessThanOrEqual(1);
    expect(Math.abs(III.baselineY - sheet.leads[2].baselineY)).toBeLessThanOrEqual(1);
    const troughs = trueExtremes(sheet.leads[1], x0, x1).filter((e) => e.kind === 'bottom' && e.y - sheet.leads[1].baselineY >= 100);
    expect(troughs.length).toBeGreaterThanOrEqual(8);
    const errors: string[] = [];
    for (const e of troughs) {
      const got = Math.max(...II.points.filter((p) => Math.abs(p.x - e.x) <= 1).map((p) => p.y));
      if (!(Math.abs(got - e.y) <= 1)) errors.push(`x=${e.x}: truth ${e.y.toFixed(1)}, trace ${got.toFixed(1)}`);
    }
    expect(errors, errors.join('; ')).toEqual([]);
    const ambiguousII = II.unreliable.filter((u) => u.kind === 'ambiguous');
    const ambiguousIII = III.unreliable.filter((u) => u.kind === 'ambiguous');
    expect(ambiguousII.length).toBeGreaterThanOrEqual(troughs.length);
    expect(ambiguousIII.length).toBeGreaterThanOrEqual(troughs.length);
    const flatErrors: string[] = [];
    for (let x = x0; x <= x1; x++) {
      if (!isFlat(sheet.leads[2], x) || III.unreliable.some((u) => x >= u.x0 - 1 && x <= u.x1 + 1)) continue;
      const p = III.points.find((q) => q.x === x);
      const err = p ? Math.abs(p.y - sheet.leads[2].y(x)) : Infinity;
      if (err > 0.5) flatErrors.push(`x=${x}: ${err.toFixed(2)}`);
    }
    expect(flatErrors, flatErrors.slice(0, 8).join('; ')).toEqual([]);
    // III does not follow the II trough down: no point deeper than 12 px below its own baseline.
    expect(Math.max(...III.points.map((p) => p.y))).toBeLessThanOrEqual(III.baselineY + 12);
  });
});

describe('empty sheet', () => {
  it('no grid and no ink: exactly 6 traces without points, confidence 0, no exceptions', () => {
    const image = createGrayImage(1280, 905);
    const layout = detectLayout(image, POLYSPECTRUM);
    const ink = extractInk(image, layout, POLYSPECTRUM);
    expect(ink.issues ?? []).toEqual([]);
    expect(ink.components).toEqual([]);
    const traces = traceLeads(ink, layout, POLYSPECTRUM);
    expect(traces.map((t) => t.id)).toEqual(LEAD_IDS);
    for (const t of traces) {
      expect(t.points).toEqual([]);
      expect(t.confidence).toBe(0);
      expect(t.reasons.some((r) => r.startsWith('exception'))).toBe(false);
    }
  });
});

describe('unreliable spans and reasons', () => {
  it('a gap longer than 3 columns is interpolated by a polyline and marked gap; a 3-column gap is bridged silently', () => {
    const base = beatShape({ periodPx: PERIOD, r: 40, s: 10, phasePx: 7 });
    const { traces } = analyze({
      leads: { II: base, III: base },
      cutouts: [
        { x: 500, y: 240, width: 21, height: 80 },
        { x: 700, y: 370, width: 3, height: 80 },
      ],
    });
    const II = traces[1];
    const gap = II.unreliable.find((u) => u.kind === 'gap');
    expect(gap).toBeDefined();
    expect(gap!.x0).toBeGreaterThanOrEqual(499);
    expect(gap!.x0).toBeLessThanOrEqual(501);
    expect(gap!.x1).toBeGreaterThanOrEqual(519);
    expect(gap!.x1).toBeLessThanOrEqual(521);
    expect(II.points.filter((p) => p.x > gap!.x0 && p.x < gap!.x1)).toEqual([]);
    // The polyline joins the gap edges: the neighbouring points lie on both sides.
    const left = II.points.filter((p) => p.x < gap!.x0).at(-1)!;
    const right = II.points.find((p) => p.x > gap!.x1)!;
    expect(right.x - left.x).toBeGreaterThan(18);
    expect(II.reasons).toContain('gap');
    expect(II.confidence).toBeLessThan(1);
    expect(II.confidence).toBeGreaterThan(0.6);
    const III = traces[2];
    expect(III.unreliable).toEqual([]);
    expect(III.reasons).toEqual([]);
    expect(III.points.some((p) => p.x >= 699 && p.x <= 699.5)).toBe(true);
    expect(III.points.some((p) => p.x >= 703 && p.x <= 703.5)).toBe(true);
  });

  it('a curve going past the bottom frame edge gives clipped spans with no points inside and no interpolation', () => {
    // Wide S (half-width 12 px): goes below the frame for ~8 columns per beat, not a fraction of a column.
    const { sheet, traces } = analyze({
      leads: { aVF: beatShape({ periodPx: PERIOD, r: 30, s: 95, phasePx: 7, widths: { qrs: 12 } }) },
    });
    const aVF = traces[5];
    const bottom = sheet.frame.y + sheet.frame.height - 1;
    const clipped = aVF.unreliable.filter((u) => u.kind === 'clipped');
    expect(clipped.length).toBeGreaterThanOrEqual(8);
    expect(aVF.unreliable.filter((u) => u.kind === 'gap')).toEqual([]);
    for (const u of clipped) {
      expect(aVF.points.filter((p) => p.x >= u.x0 && p.x <= u.x1)).toEqual([]);
    }
    expect(Math.max(...aVF.points.map((p) => p.y))).toBeLessThanOrEqual(bottom);
    expect(Math.max(...aVF.points.map((p) => p.y))).toBeGreaterThanOrEqual(bottom - 2);
    expect(aVF.reasons).toContain('clipped');
    expect(aVF.confidence).toBeLessThan(1);
    expect(traces[4].reasons).toEqual([]);
  });

  it('a curve starting far from the profile anchor: the trace follows the ink, reason anchor_weak', () => {
    const { sheet, traces } = analyze({
      leads: { III: beatShape({ periodPx: PERIOD, r: 30, phasePx: 7 }) },
      baselines: { III: 409 + 32 },
    });
    const III = traces[2];
    expect(III.reasons).toContain('anchor_weak');
    expect(Math.abs(III.baselineY - sheet.leads[2].baselineY)).toBeLessThanOrEqual(1);
    expect(III.coverage).toBe(1);
    expect(traces[1].reasons).toEqual([]);
  });
});

describe('manual separators (hints)', () => {
  // X-crossing with wide strokes: the deep S of lead II (down to y≈380) crosses the tall R of lead III (up to
  // y≈309) twice; between the crossings the upper run is the R III peak, the lower one is the S II trough.
  const wide = { qrs: 12 };
  const spec: SyntheticSheetSpec = {
    leads: {
      II: beatShape({ periodPx: PERIOD, r: 20, s: 100, q: 0, phasePx: 7, widths: wide }),
      III: beatShape({ periodPx: PERIOD, r: 100, s: 10, q: 0, phasePx: 7 + 0.04 * PERIOD, widths: wide }),
    },
  };
  // Beats from k = 1: the first one (x ≈ 72) lies left of the curve start (x = 86).
  const beats = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => Math.round(7 + 0.54 * PERIOD + 120 * k));
  const hints: TraceHint[] = beats.map((x) => ({ x0: x - 4, x1: x + 4, y: 344.5, above: 'III', below: 'II' }));

  function tipErrors(traces: LeadTrace[], sheet: SyntheticSheet): { sErr: number; rErr: number } {
    let sErr = 0;
    let rErr = 0;
    for (const x of beats) {
      const II = sheet.leads[1];
      const III = sheet.leads[2];
      const sTrue = Math.max(...[x - 1, x, x + 1].map((c) => II.extremes(c).bottom));
      const rTrue = Math.min(...[x - 1, x, x + 1].map((c) => III.extremes(c).top));
      const sGot = Math.max(...traces[1].points.filter((p) => Math.abs(p.x - x) <= 1.5).map((p) => p.y));
      const rGot = Math.min(...traces[2].points.filter((p) => Math.abs(p.x - x) <= 1.5).map((p) => p.y));
      sErr = Math.max(sErr, Math.abs(sGot - sTrue));
      rErr = Math.max(rErr, Math.abs(rGot - rTrue));
    }
    return { sErr, rErr };
  }

  it('without a hint the traces in a hard crossing are mixed up: the tips go to the wrong leads', () => {
    const { sheet, traces } = analyze(spec);
    const { sErr, rErr } = tipErrors(traces, sheet);
    expect(Number.isFinite(sErr) && Number.isFinite(rErr)).toBe(true);
    expect(Math.max(sErr, rErr)).toBeGreaterThan(5);
  });

  it('with the hint "above — III, below — II" over the crossing interval both tips are correct (±1 px)', () => {
    const { sheet, traces } = analyze(spec, hints);
    const { sErr, rErr } = tipErrors(traces, sheet);
    expect(sErr).toBeLessThanOrEqual(1);
    expect(rErr).toBeLessThanOrEqual(1);
    expect(traces.map((t) => t.id)).toEqual(LEAD_IDS);
  });
});
