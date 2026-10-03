import { describe, expect, it } from 'vitest';
import { createGrayImage } from '../src/core/image';
import { detectLayout } from '../src/core/layout';
import { binarizeRect, jaccardDistance, POLYSPECTRUM } from '../src/core/profile';
import { LEAD_IDS, type GrayImage, type LeadId, type PageLayout, type PageVariant, type Rect } from '../src/types/contracts';
import { listFixtures, loadFixture, type Fixture } from './fixtures';

const fixtures = listFixtures();
const INK = POLYSPECTRUM.thresholds.inkCore;

/** Mode of y of dark pixels (< 130) in a `±half` band around `yc`, over columns `x0..x1` inclusive. */
function inkModeY(image: GrayImage, x0: number, x1: number, yc: number, half: number): number {
  let bestCount = -1;
  let bestY = -1;
  for (let y = Math.round(yc - half); y <= Math.round(yc + half); y++) {
    let count = 0;
    const row = y * image.width;
    for (let x = x0; x <= x1; x++) if (image.data[row + x] < INK) count++;
    if (count > bestCount) {
      bestCount = count;
      bestY = y;
    }
  }
  return bestY;
}

/** Copy of the sheet with content shifted down by `dy` rows (white on top, bottom cut off). */
function shiftedDown(image: GrayImage, dy: number): GrayImage {
  const out = createGrayImage(image.width, image.height);
  out.data.set(image.data.subarray(0, image.width * (image.height - dy)), image.width * dy);
  return out;
}

/** Sheet padded with white rows at the bottom up to height `height`. */
function paddedTo(image: GrayImage, height: number): GrayImage {
  const out = createGrayImage(image.width, height);
  out.data.set(image.data.subarray(0, image.width * Math.min(image.height, height)));
  return out;
}

interface SyntheticSheet {
  width: number;
  height: number;
  /** Grid period, px/mm; 0 — no grid. */
  pxPerMm: number;
  /** Frame lines (x0, y0 — left/top, x1, y1 — right/bottom), gray 140; absent — no frame. */
  frameLines?: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Synthetic sheet: white background, dotted grid of luminance 200 (1-mm nodes, 5-mm lines dotted every other pixel)
 * inside the frame (or over the whole sheet), gray 1 px frame. No curves or text.
 */
function drawSheet(sheet: SyntheticSheet): GrayImage {
  const image = createGrayImage(sheet.width, sheet.height);
  const { data, width } = image;
  const put = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < sheet.width && y < sheet.height) data[y * width + x] = v;
  };
  const area = sheet.frameLines
    ? { x0: sheet.frameLines.x0 + 2, y0: sheet.frameLines.y0 + 2, x1: sheet.frameLines.x1 - 2, y1: sheet.frameLines.y1 - 2 }
    : { x0: 0, y0: 0, x1: sheet.width - 1, y1: sheet.height - 1 };
  if (sheet.pxPerMm > 0) {
    const P = sheet.pxPerMm;
    const nx = Math.floor((area.x1 - area.x0) / P);
    const ny = Math.floor((area.y1 - area.y0) / P);
    for (let j = 0; j <= ny; j++) {
      const y = Math.round(area.y0 + 2 + j * P);
      for (let i = 0; i <= nx; i++) put(Math.round(area.x0 + 2 + i * P), y, 200);
      if (j % 5 === 0) for (let x = area.x0; x <= area.x1; x += 2) put(x, y, 200);
    }
    for (let i = 0; i <= nx; i += 5) {
      const x = Math.round(area.x0 + 2 + i * P);
      for (let y = area.y0; y <= area.y1; y += 2) put(x, y, 200);
    }
  }
  if (sheet.frameLines) {
    const { x0, y0, x1, y1 } = sheet.frameLines;
    for (let x = x0; x <= x1; x++) {
      put(x, y0, 140);
      put(x, y1, 140);
    }
    for (let y = y0; y <= y1; y++) {
      put(x0, y, 140);
      put(x1, y, 140);
    }
  }
  return image;
}

/** Variant A frame lines: x=43 and 1235, y=43 and 860 → inner area x45–1233, y45–858. */
const FRAME_LINES_A = { x0: 43, y0: 43, x1: 1235, y1: 860 };

/**
 * Leads whose ink mode is more than 2.5 px from the device's expected baseline: large complexes
 * and drift shift the mode off the zero line (a-01, a-05, b-02 — see the task 02 report). Tolerance for them is 4.5 px.
 */
const BASELINE_MODE_EXCEPTIONS: Record<string, LeadId[]> = {
  'a-01': ['II', 'aVR', 'aVF'],
  'a-05': ['III'],
  'b-02': ['I', 'aVR', 'aVL'],
};

/** One `detectLayout` call per fixture — the result is reused by all checks. */
const cache = new Map<string, { image: GrayImage; layout: PageLayout }>();
function analyzed(fixture: Fixture): { image: GrayImage; layout: PageLayout } {
  let entry = cache.get(fixture.name);
  if (!entry) {
    const image = loadFixture(fixture);
    entry = { image, layout: detectLayout(image, POLYSPECTRUM) };
    cache.set(fixture.name, entry);
  }
  return entry;
}

/** Frame inner area per spike-results.md: A x45–1233, y45–858; B x47–1233, y47–835. */
const EXPECTED_FRAME: Record<PageVariant, Rect> = {
  A: { x: 45, y: 45, width: 1189, height: 814 },
  B: { x: 47, y: 47, width: 1187, height: 789 },
};

const edges = (r: Rect) => [r.x, r.y, r.x + r.width - 1, r.y + r.height - 1];

describe('detectLayout on real sheets', () => {
  describe.each(fixtures)('$name', (fixture) => {
    const expectedVariant = fixture.expected.variant;

    it('frame is gray, inner area matches the spike (ticket allows ±1 px; exact on fixtures)', () => {
      const { layout } = analyzed(fixture);
      expect(edges(layout.frame)).toEqual(edges(EXPECTED_FRAME[expectedVariant]));
      expect(layout.issues).not.toContain('no_frame');
      expect(layout.issues).not.toContain('format_mismatch');
    });

    it('grid: X and Y period, Y phase and second from "+" marks match the spike, confidence ≥ 0.95', () => {
      const { layout } = analyzed(fixture);
      const { grid } = layout;
      // spike-results.md: A 4.305 px/mm, first 5-mm row y=64.75, second 215.3 px; B 4.41, 66.25, 220.6.
      const want = expectedVariant === 'A'
        ? { pxPerMm: 4.305, phaseY: 64.75, pxPerSecond: 215.3 }
        : { pxPerMm: 4.41, phaseY: 66.25, pxPerSecond: 220.6 };

      expect(Math.abs(grid.pxPerMmX - want.pxPerMm), `pxPerMmX=${grid.pxPerMmX}`).toBeLessThanOrEqual(0.02);
      expect(Math.abs(grid.pxPerMmY - want.pxPerMm), `pxPerMmY=${grid.pxPerMmY}`).toBeLessThanOrEqual(0.02);
      expect(Math.abs(grid.phaseY - want.phaseY), `phaseY=${grid.phaseY}`).toBeLessThanOrEqual(0.5);
      expect(grid.pxPerSecond, 'second marks found').toBeDefined();
      expect(Math.abs(grid.pxPerSecond! - want.pxPerSecond), `pxPerSecond=${grid.pxPerSecond}`).toBeLessThanOrEqual(1);
      expect(grid.confidence).toBeGreaterThanOrEqual(0.95);
      expect(layout.issues).not.toContain('no_grid');
      expect(layout.issues.some((i) => i.startsWith('grid_out_of_profile'))).toBe(false);
    });

    it('variant detected correctly and confirmed by the header product line (Jaccard ≈ 0 to own, ≈ 1 to the other)', () => {
      const { image, layout } = analyzed(fixture);
      expect(layout.variant).toBe(expectedVariant);
      expect(layout.issues).not.toContain('variant_ambiguous');
      expect(layout.confidence).toBeGreaterThanOrEqual(0.95);

      const other: PageVariant = expectedVariant === 'A' ? 'B' : 'A';
      const own = POLYSPECTRUM.variants[expectedVariant];
      const foreign = POLYSPECTRUM.variants[other];
      const threshold = POLYSPECTRUM.thresholds.headerThreshold;
      const ownDistance = jaccardDistance(binarizeRect(image, own.zones.headerProduct!, threshold), own.headerProduct, 2);
      const foreignDistance = jaccardDistance(binarizeRect(image, foreign.zones.headerProduct!, threshold), foreign.headerProduct, 2);
      expect(ownDistance).toBeLessThanOrEqual(0.1);
      expect(foreignDistance).toBeGreaterThanOrEqual(0.9);
    });

    it('expected baselines differ from the lead ink mode by at most 2.5 px (known exceptions — 4.5)', () => {
      const { image, layout } = analyzed(fixture);
      const x0 = layout.zones.plot!.x;
      const x1 = layout.frame.x + layout.frame.width - 1;
      const exceptions = BASELINE_MODE_EXCEPTIONS[fixture.name] ?? [];
      LEAD_IDS.forEach((lead, k) => {
        const expected = layout.expectedBaselines[k];
        const mode = inkModeY(image, x0, x1, expected, 20);
        const limit = exceptions.includes(lead) ? 4.5 : 2.5;
        expect(Math.abs(mode - expected), `${lead}: mode ${mode}, expected ${expected.toFixed(1)}`).toBeLessThanOrEqual(limit);
      });
    });
  });

  it('b-01 padded with white to the variant A sheet height: variant B by frame, RR row and header, flagged as a discrepancy', () => {
    const image = paddedTo(loadFixture('b-01'), 905);
    const layout = detectLayout(image, POLYSPECTRUM);
    expect(layout.variant).toBe('B');
    expect(layout.issues).toContain('variant_ambiguous');
    expect(layout.confidence).toBeLessThan(0.95);
  });

  it('sheet shifted down by 3 px: frame, zones and baselines follow the measured grid', () => {
    const original = analyzed(fixtures[0]).layout;
    const layout = detectLayout(shiftedDown(loadFixture(fixtures[0]), 3), POLYSPECTRUM);
    expect(layout.frame.y).toBe(original.frame.y + 3);
    expect(layout.grid.phaseY).toBeCloseTo(original.grid.phaseY + 3, 1);
    expect(layout.zones.hrRow!.y).toBe(original.zones.hrRow!.y + 3);
    layout.expectedBaselines.forEach((y, k) => expect(y).toBeCloseTo(original.expectedBaselines[k] + 3, 1));
    expect(layout.issues).toEqual([]);
  });

  it('detectLayout fits the budget: ≤ 600 ms per sheet (target 300) after warm-up', () => {
    const images = fixtures.map((f) => analyzed(f).image);
    detectLayout(images[0], POLYSPECTRUM);
    const times = images.map((image) => {
      const t0 = performance.now();
      detectLayout(image, POLYSPECTRUM);
      return performance.now() - t0;
    });
    expect(Math.max(...times)).toBeLessThanOrEqual(600);
  });
});

describe('detectLayout on synthetic sheets', () => {
  it('white sheet: the only issue is no_grid, confidence 0, no exception', () => {
    const layout = detectLayout(createGrayImage(1280, 905), POLYSPECTRUM);
    expect(layout.issues).toEqual(['no_grid']);
    expect(layout.confidence).toBe(0);
    expect(layout.grid).toMatchObject({ pxPerMmX: 0, pxPerMmY: 0, confidence: 0 });
    expect(layout.variant).toBe('A');
    expect(layout.frame).toEqual({ x: 0, y: 0, width: 1280, height: 905 });
  });

  it('6 px/mm grid without a frame: format not recognized, but the period is measured', () => {
    const layout = detectLayout(drawSheet({ width: 1280, height: 905, pxPerMm: 6 }), POLYSPECTRUM);
    expect(layout.issues).toContain('format_mismatch');
    expect(layout.issues).toContain('no_frame');
    expect(layout.issues).not.toContain('no_grid');
    expect(layout.grid.pxPerMmX).toBeCloseTo(6, 1);
    expect(layout.grid.pxPerMmY).toBeCloseTo(6, 1);
    expect(layout.confidence).toBeLessThan(0.5);
  });

  it('variant A frame but a 4.6 px/mm grid (outside ±2 %): grid_out_of_profile with the measured value, measurement is kept', () => {
    const layout = detectLayout(drawSheet({ width: 1280, height: 905, pxPerMm: 4.6, frameLines: FRAME_LINES_A }), POLYSPECTRUM);
    const issue = layout.issues.find((i) => i.startsWith('grid_out_of_profile:'));
    expect(issue).toBeDefined();
    expect(Number(issue!.split(':')[1])).toBeCloseTo(4.6, 1);
    expect(layout.grid.pxPerMmX).toBeCloseTo(4.6, 1);
    expect(layout.grid.pxPerMmY).toBeCloseTo(4.6, 1);
    expect(layout.grid.confidence).toBeGreaterThan(0.5);
    expect(layout.issues).not.toContain('format_mismatch');
    expect(layout.frame).toEqual({ x: 45, y: 45, width: 1189, height: 814 });
    expect(layout.variant).toBe('A');
  });

  it('variant A frame and grid without curves: no issues, grid phase is measured', () => {
    const layout = detectLayout(drawSheet({ width: 1280, height: 905, pxPerMm: 4.305, frameLines: FRAME_LINES_A }), POLYSPECTRUM);
    expect(layout.issues).toEqual([]);
    expect(layout.grid.pxPerMmX).toBeCloseTo(4.305, 1);
    expect(layout.grid.pxPerSecond).toBeUndefined();
    expect(layout.grid.confidence).toBeGreaterThan(0.8);
  });
});
