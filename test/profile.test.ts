import { describe, expect, it } from 'vitest';
import { POLYSPECTRUM, jaccardDistance } from '../src/core/profile';
import type { Rect } from '../src/types/contracts';

const { A, B } = POLYSPECTRUM.variants;

const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('format profile «Поли-Спектр.NET»', () => {
  it('two variants with layout constants measured by the spike (spike-results.md)', () => {
    expect([A.width, A.height]).toEqual([1280, 905]);
    expect([B.width, B.height]).toEqual([1280, 883]);
    // Frame inner area: A x45–1233, y45–858; B x47–1233, y47–835.
    expect(A.frame).toEqual({ x: 45, y: 45, width: 1189, height: 814 });
    expect(B.frame).toEqual({ x: 47, y: 47, width: 1187, height: 789 });
    expect(A.pxPerMm).toBeCloseTo(4.305, 3);
    expect(B.pxPerMm).toBeCloseTo(4.41, 2);
    expect(A.pxPerSecond).toBeCloseTo(215.3, 1);
    expect(B.pxPerSecond).toBeCloseTo(220.6, 1);
    expect(A.gridRowY).toBeCloseTo(64.75, 2);
    expect(B.gridRowY).toBeCloseTo(66.25, 2);
    expect(A.plusRowY0).toBeCloseTo(86.3, 0);
    expect(B.plusRowY0).toBeCloseTo(88.5, 0);
    expect(A.plusRowStepMm).toBe(10);
    expect(B.plusRowStepMm).toBe(10);
  });

  it('constants are mutually consistent: one second = 50 mm, baselines and step are converted from mm', () => {
    for (const v of [A, B]) {
      expect(Math.abs(v.pxPerSecond - 50 * v.pxPerMm)).toBeLessThanOrEqual(0.2);
      expect(v.leadStepPx).toBeCloseTo(v.leadStepMm * v.pxPerMm, 6);
      expect(v.firstBaselineY).toBeCloseTo(v.gridRowY + v.baselineOffsetMm * v.pxPerMm, 6);
      // The «+» lattice starts 5 mm after the first 5-mm row.
      expect(v.plusRowY0 - v.gridRowY).toBeCloseTo(5 * v.pxPerMm, 0);
    }
    // A: baselines on 5-mm rows — 20 mm to the first, step 30 mm (129.1 px); B: step 28.5 mm (125.6 px).
    expect(A.baselineOffsetMm).toBe(20);
    expect(A.leadStepMm).toBe(30);
    expect(A.leadStepPx).toBeCloseTo(129.1, 0);
    expect(B.leadStepPx).toBeCloseTo(125.6, 0);
    expect(B.firstBaselineY).toBeCloseTo(147.3, 0);
  });

  it('zones lie on the sheet, text zones do not overlap the plot area; RR row only in B', () => {
    for (const v of [A, B]) {
      const page: Rect = { x: 0, y: 0, width: v.width, height: v.height };
      const plot = v.zones.plot;
      expect(plot).toBeDefined();
      for (const [name, rect] of Object.entries(v.zones)) {
        expect(inside(rect, page), `${name} inside the sheet`).toBe(true);
        if (name !== 'plot') expect(overlaps(rect, plot!), `${name} does not overlap plot`).toBe(false);
      }
      for (const name of ['header', 'headerName', 'headerProduct', 'timeLabels', 'hrRow', 'leadLabels', 'footer'] as const) {
        expect(v.zones[name], name).toBeDefined();
      }
      // Header above the frame, footer below it, labels and curves inside the frame.
      expect(v.zones.header!.y + v.zones.header!.height).toBeLessThanOrEqual(v.frame.y);
      expect(v.zones.footer!.y).toBeGreaterThanOrEqual(v.frame.y + v.frame.height);
      expect(inside(v.zones.leadLabels!, v.frame)).toBe(true);
      expect(inside(plot!, v.frame)).toBe(true);
    }
    expect(A.zones.rrRow).toBeUndefined();
    expect(B.zones.rrRow).toBeDefined();
    expect(inside(B.zones.rrRow!, B.frame)).toBe(true);
  });

  it('product line templates of the two variants differ: Jaccard distance ≈ 1', () => {
    expect(A.headerProduct.data.length).toBe(A.headerProduct.width * A.headerProduct.height);
    expect(B.headerProduct.data.length).toBe(B.headerProduct.width * B.headerProduct.height);
    // Text takes a noticeable part of the crop, the crop lies in its own zone.
    const ink = (d: Uint8Array) => d.reduce((s, v) => s + v, 0);
    expect(ink(A.headerProduct.data)).toBeGreaterThan(200);
    expect(ink(B.headerProduct.data)).toBeGreaterThan(200);
    expect(inside(A.headerProduct, A.zones.headerProduct!)).toBe(true);
    expect(inside(B.headerProduct, B.zones.headerProduct!)).toBe(true);

    expect(jaccardDistance(A.headerProduct, A.headerProduct)).toBe(0);
    expect(jaccardDistance(A.headerProduct, B.headerProduct)).toBeGreaterThan(0.95);
  });

  it('thresholds and tolerances: grid 180–235, hysteresis 130/170, tolerances ±2 %', () => {
    const t = POLYSPECTRUM.thresholds;
    expect(t.gridLo).toBeLessThanOrEqual(180);
    expect(t.gridHi).toBe(235);
    expect([t.inkCore, t.inkEdge]).toEqual([130, 170]);
    expect(t.gridTolerance).toBe(0.02);
    expect(t.frameTolerance).toBe(0.02);
    expect(t.headerMaxDistance).toBe(0.3);
    expect(t.minComponentArea).toBe(6);
  });
});
