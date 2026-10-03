import { describe, expect, it } from 'vitest';
import { extractInk } from '../src/core/ink';
import { detectLayout } from '../src/core/layout';
import { POLYSPECTRUM } from '../src/core/profile';
import type { GrayImage, InkComponent, InkMask, PageLayout, Rect } from '../src/types/contracts';
import { listFixtures, loadFixture, type Fixture } from './fixtures';
import { beatShape, renderSheet } from './synthetic/sheet';

const inside = (c: InkComponent, r: Rect) =>
  c.bbox.x >= r.x && c.bbox.y >= r.y && c.bbox.x + c.bbox.width <= r.x + r.width && c.bbox.y + c.bbox.height <= r.y + r.height;

const isWide = (c: InkComponent, frame: Rect) => c.bbox.width >= 0.5 * frame.width;

function inkAt(ink: InkMask, x: number, y: number): boolean {
  return ink.mask[y * ink.width + x] !== 0;
}

describe('extractInk on a synthetic sheet', () => {
  const sheet = renderSheet({
    leads: { I: beatShape({ periodPx: 110, r: 40 }), II: beatShape({ periodPx: 110, r: 70, s: 25 }) },
    hrDigits: [150, 260, 370],
  });
  const layout = detectLayout(sheet.image, POLYSPECTRUM);
  const ink = extractInk(sheet.image, layout, POLYSPECTRUM);

  it('synthetic sheet layout is recognized: variant A, grid and "+" lattice found', () => {
    expect(layout.variant).toBe('A');
    expect(layout.issues).toEqual([]);
    expect(layout.plusLattice).toBeDefined();
    const truthColumns = new Set(sheet.plusMarks.map((m) => m.x));
    expect(layout.plusLattice!.columnsX.length).toBe(truthColumns.size);
  });

  it('six wide components — one per curve, from the first to the last curve column', () => {
    const wide = ink.components.filter((c) => isWide(c, layout.frame));
    expect(wide.length).toBe(6);
    for (const c of wide) {
      expect(c.bbox.x).toBeLessThanOrEqual(sheet.spec.xStart + 1);
      expect(c.bbox.x + c.bbox.width - 1).toBeGreaterThanOrEqual(sheet.spec.xEnd - 1);
    }
  });

  it('HR row "digit" blocks are removed per component: they are in textComponents, absent from the mask', () => {
    const hrZone = layout.zones.hrRow!;
    const digits = ink.textComponents.filter((c) => inside(c, hrZone));
    expect(digits.length).toBe(sheet.hrDigitRects.length);
    for (const rect of sheet.hrDigitRects) {
      const found = digits.find((c) => c.bbox.x === rect.x && c.bbox.y === rect.y);
      expect(found, `block ${rect.x},${rect.y}`).toBeDefined();
      expect(inkAt(ink, rect.x + 2, rect.y + 5)).toBe(false);
    }
  });

  it('free-standing "+" marks are removed and listed in plusMarks; the grid does not get into the ink', () => {
    expect(ink.plusMarks.length).toBe(sheet.plusMarks.length);
    for (const mark of sheet.plusMarks) {
      const near = ink.plusMarks.find((m) => Math.abs(m.x - mark.x) <= 1.5 && Math.abs(m.y - mark.y) <= 1.5);
      expect(near, `mark ${mark.x},${mark.y}`).toBeDefined();
    }
    // No component with area below the threshold and no cross off the curves.
    // A cross is "on the curve" if it falls within the curve's span in its own and adjacent columns (stroke width on a
    // steep segment covers the adjacent column).
    const onCurve = (m: { x: number; y: number }) =>
      sheet.leads.some((lead) => {
        const es = [m.x - 1, m.x, m.x + 1].map((x) => lead.extremes(x));
        return m.y >= Math.min(...es.map((e) => e.top)) - 3 && m.y <= Math.max(...es.map((e) => e.bottom)) + 3;
      });
    for (const mark of sheet.plusMarks.filter((m) => !onCurve(m))) {
      expect(inkAt(ink, mark.x, mark.y), `mark pixel ${mark.x},${mark.y}`).toBe(false);
      for (const end of [{ x: mark.x + 2, y: mark.y }, { x: mark.x - 2, y: mark.y }, { x: mark.x, y: mark.y + 2 }, { x: mark.x, y: mark.y - 2 }]) {
        if (!onCurve(end)) expect(inkAt(ink, end.x, end.y), `crossbar end ${end.x},${end.y}`).toBe(false);
      }
    }
    expect(ink.components.every((c) => c.area >= POLYSPECTRUM.thresholds.minComponentArea)).toBe(true);
    const total = ink.components.reduce((s, c) => s + c.area, 0);
    const wideArea = ink.components.filter((c) => isWide(c, layout.frame)).reduce((s, c) => s + c.area, 0);
    expect(wideArea / total).toBeGreaterThan(0.995);
  });
});

/** One `detectLayout` + `extractInk` call per fixture — the result is reused by all checks. */
const cache = new Map<string, { image: GrayImage; layout: PageLayout; ink: InkMask }>();
function analyzed(fixture: Fixture) {
  let entry = cache.get(fixture.name);
  if (!entry) {
    const image = loadFixture(fixture);
    const layout = detectLayout(image, POLYSPECTRUM);
    entry = { image, layout, ink: extractInk(image, layout, POLYSPECTRUM) };
    cache.set(fixture.name, entry);
  }
  return entry;
}

const isGlyphLike = (c: InkComponent) => c.bbox.width >= 2 && c.bbox.width <= 16 && c.bbox.height >= 5 && c.bbox.height <= 12;

/** Clusters by component y-centers (gap > 6 px starts a new cluster); returns cluster centers. */
function clustersY(components: InkComponent[]): number[] {
  const centers = components.map((c) => c.bbox.y + (c.bbox.height - 1) / 2).sort((a, b) => a - b);
  const out: number[][] = [];
  for (const y of centers) {
    const last = out[out.length - 1];
    if (last && y - last[last.length - 1] <= 6) last.push(y);
    else out.push([y]);
  }
  return out.map((group) => group.reduce((s, v) => s + v, 0) / group.length);
}

describe('extractInk on real sheets', () => {
  describe.each(listFixtures())('$name', (fixture) => {
    it('wide components are curves: one per lead (a-06: III and aVR merged, aVF cut into fragments by the frame)', () => {
      const { layout, ink } = analyzed(fixture);
      expect(ink.issues ?? []).toEqual([]);
      const wide = ink.components.filter((c) => isWide(c, layout.frame));
      if (fixture.name === 'a-06') {
        expect(wide.length).toBe(4);
        const bottom = layout.frame.y + layout.frame.height - 1;
        const clippedFragments = ink.components.filter((c) => !isWide(c, layout.frame) && c.bbox.y + c.bbox.height - 1 >= bottom && c.bbox.width >= 20);
        expect(clippedFragments.length).toBeGreaterThanOrEqual(8);
      } else {
        expect(wide.length).toBe(6);
      }
    });

    it('text is removed per component: HR digits and lead labels are in textComponents, no compact glyphs left in the zones of the mask', () => {
      const { layout, ink } = analyzed(fixture);
      const hrZone = layout.zones.hrRow!;
      const labelZone = layout.zones.leadLabels!;
      const digitChars = fixture.expected.hrRow.reduce((s, v) => s + String(v).length, 0);
      const hrGlyphs = ink.textComponents.filter((c) => inside(c, hrZone));
      // A glyph wider than 9 px is a merged pair (spec §2): components + pairs = number of printed digits.
      const pairs = hrGlyphs.filter((c) => c.bbox.width > 9).length;
      expect(hrGlyphs.length + pairs, `components ${hrGlyphs.length}, pairs ${pairs}`).toBe(digitChars);
      const labelGlyphs = ink.textComponents.filter((c) => inside(c, labelZone));
      expect(labelGlyphs.length).toBeGreaterThanOrEqual(12);
      expect(labelGlyphs.length).toBeLessThanOrEqual(16);
      // Six label groups, each at its own expected baseline (±6 px).
      const groups = clustersY(labelGlyphs);
      expect(groups.length).toBe(6);
      groups.forEach((y, k) => expect(Math.abs(y - layout.expectedBaselines[k]), `label ${k}`).toBeLessThanOrEqual(6));
      // No compact glyphs remain in the mask within text zones.
      const zones = [hrZone, labelZone, layout.zones.timeLabels!, layout.zones.rrRow].filter((z): z is Rect => z !== undefined);
      const leftovers = ink.components.filter((c) => isGlyphLike(c) && zones.some((z) => inside(c, z)));
      expect(leftovers).toEqual([]);
    });

    it('the "+" lattice is removed at layout positions: at least 90 % of predicted marks found', () => {
      const { layout, ink } = analyzed(fixture);
      const lattice = layout.plusLattice!;
      const predicted = lattice.columnsX.length * lattice.rowsY.length;
      expect(ink.plusMarks.length).toBeGreaterThanOrEqual(0.9 * predicted);
      expect(ink.plusMarks.length).toBeLessThanOrEqual(predicted);
    });
  });

  it('b-02: curve I enters the HR digit band and stays whole, digits do not get into the ink', () => {
    const { layout, ink } = analyzed(listFixtures().find((f) => f.name === 'b-02')!);
    const hrZone = layout.zones.hrRow!;
    const wide = ink.components.filter((c) => isWide(c, layout.frame)).sort((a, b) => a.bbox.y - b.bbox.y);
    const leadI = wide[0];
    expect(leadI.bbox.y).toBeLessThan(hrZone.y + hrZone.height);
    expect(leadI.bbox.y).toBeLessThanOrEqual(hrZone.y + 1);
    const digits = ink.textComponents.filter((c) => inside(c, hrZone));
    expect(digits.length).toBeGreaterThanOrEqual(40);
    for (const d of digits) expect(d.bbox.width).toBeLessThanOrEqual(16);
  });
});
