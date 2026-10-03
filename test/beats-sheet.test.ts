import { describe, expect, it } from 'vitest';
import { checkPrintedHr, detectBeats } from '../src/analysis/beats';
import { analyzePage } from '../src/core/page';
import { POLYSPECTRUM } from '../src/core/profile';
import type { PageMeta } from '../src/types/contracts';
import { beatShape, renderSheet } from './synthetic/sheet';

/** Beat period on the sheet, px: 110 px ≈ 511 ms at 215.25 px/s → 117 bpm. */
const PERIOD = 110;
const PHASE = 7;
const PX_PER_MS = (POLYSPECTRUM.variants.A.pxPerMm * 50) / 1000;

/** Sheet with one rhythm in all leads (as in page.test.ts); ground truth — R at x = PHASE + PERIOD·(k + 0.5). */
function sheetWithBeats() {
  return renderSheet({
    leads: {
      I: beatShape({ periodPx: PERIOD, r: 45, s: 10, phasePx: PHASE }),
      II: beatShape({ periodPx: PERIOD, r: 100, s: 40, q: 8, phasePx: PHASE }),
      III: beatShape({ periodPx: PERIOD, r: 65, s: 20, phasePx: PHASE }),
      aVR: beatShape({ periodPx: PERIOD, r: 15, s: 60, t: -10, phasePx: PHASE }),
      aVL: beatShape({ periodPx: PERIOD, r: 30, s: 8, phasePx: PHASE }),
      aVF: beatShape({ periodPx: PERIOD, r: 70, s: 30, phasePx: PHASE }),
    },
  });
}

/** True x of R peaks inside the sheet plot area. */
function trueRxs(xStart: number, xEnd: number): number[] {
  const xs: number[] = [];
  for (let k = 0; ; k++) {
    const x = PHASE + PERIOD * (k + 0.5);
    if (x > xEnd) break;
    if (x >= xStart) xs.push(x);
  }
  return xs;
}

describe('checkPrintedHr on a synthetic sheet: digit above the interval midpoint', () => {
  const sheet = sheetWithBeats();
  const page = analyzePage(sheet.image, POLYSPECTRUM);
  const beats = detectBeats(page.signals, 'dog');
  const rxs = trueRxs(sheet.spec.xStart, sheet.spec.xEnd);
  const hr = Math.round(60000 / (PERIOD / PX_PER_MS));
  const digits = rxs.slice(0, -1).map((x) => ({ value: hr, x: x + PERIOD / 2 }));
  const metaWith = (hrRow: { value: number; x: number }[]): PageMeta => ({ ...page.meta, hrRow });

  it('detector found all complexes of the sheet (excluding edge-cut ones), each R within ±2 columns of truth', () => {
    const xs = beats.map((b) => page.layout.zones.plot!.x + b.tMs * PX_PER_MS);
    // The first and last true R may hit the edge: compare the found ones with the nearest true ones.
    expect(beats.length).toBeGreaterThanOrEqual(rxs.length - 2);
    expect(beats.length).toBeLessThanOrEqual(rxs.length);
    for (const x of xs) expect(Math.min(...rxs.map((t) => Math.abs(t - x)))).toBeLessThanOrEqual(2);
  });

  it('correct digits: all matched by x, no mismatches, beat count = matched interval count + 1', () => {
    const check = checkPrintedHr(beats, metaWith(digits), page.layout, page.calib);
    expect(check.mismatches).toEqual([]);
    expect(check.matched + (check.unmatched?.length ?? 0)).toBe(digits.length);
    expect(beats.length).toBe(check.matched + 1);
  });

  it('one substituted digit (+10 bpm) gives exactly one mismatch with its index and measured HR within ±3 of truth', () => {
    const tampered = digits.map((d, k) => (k === 3 ? { ...d, value: d.value + 10 } : d));
    const check = checkPrintedHr(beats, metaWith(tampered), page.layout, page.calib);
    expect(check.mismatches).toHaveLength(1);
    expect(check.mismatches[0].k).toBe(3);
    expect(check.mismatches[0].printed).toBe(hr + 10);
    expect(Math.abs(check.mismatches[0].measured - hr)).toBeLessThanOrEqual(3);
    expect(check.matched).toBe(digits.length - 1 - (check.unmatched?.length ?? 0));
    // Beats on both sides of the mismatch are flagged, the others are not.
    const marked = (check.beats ?? []).filter((b) => b.reasons.includes('printed_hr_mismatch'));
    expect(marked.map((b) => b.index)).toEqual([3, 4]);
  });

  it('digit with no interval below it (left of the first beat) goes to unmatched, not to mismatches', () => {
    const shifted = [{ value: hr, x: rxs[0] - PERIOD / 2 }, ...digits];
    const check = checkPrintedHr(beats, metaWith(shifted), page.layout, page.calib);
    expect(check.unmatched).toContain(0);
    expect(check.mismatches).toEqual([]);
  });
});
