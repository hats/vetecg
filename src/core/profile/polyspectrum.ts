/**
 * Data of the "Poly-Spectrum.NET" profile: two layout variants, zones, thresholds, header templates.
 * All numbers were measured on 10 real sheets (`spike-results.md` and task 02 measurements); coordinates are px of
 * the original-size sheet (1280 wide). Constants are expectations and tolerances; each sheet's grid is measured anew.
 *
 * Product-line templates are cropped from fixtures `a-01.jpg` and `b-01.jpg` at brightness threshold 170 (text bbox
 * of the right half of the header + 1 px margin); within a variant the crops match byte-for-byte on all sheets
 * (Jaccard distance 0), across variants they do not overlap (distance 1).
 */
import type { FormatProfile, ProfileThresholds, ProfileVariant, Rect, ZoneName } from '../../types/contracts';
// Glyph sets are profile data; `sets.ts` pulls in only the template JSON and types (no import cycle).
import { BUILTIN_GLYPH_SETS } from '../pagemeta/sets';
import { patchFromRows } from './header';

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

/** Brightness thresholds and tolerances (brightness 0..255; "darker than T" = value < T). */
export const THRESHOLDS: ProfileThresholds = {
  gridLo: 180,
  gridHi: 235,
  inkCore: 130,
  inkEdge: 170,
  frameDark: 200,
  frameFill: 0.7,
  gridTolerance: 0.02,
  frameTolerance: 0.02,
  headerThreshold: 170,
  headerMaxDistance: 0.3,
  minComponentArea: 6,
  plusLineTolerance: 0.15,
  // Measured: B — ink 596/1111, glyphs 24/49, above the strip 0; A with aVF S waves at the frame bottom (a-06) — 162/17/69.
  rrRowMinInk: 150,
  rrRowMinGlyphs: 15,
  rrRowMaxAboveRatio: 0.15,
};

interface VariantSpec {
  width: number;
  height: number;
  frame: Rect;
  pxPerMm: number;
  pxPerSecond: number;
  gridRowY: number;
  plusRowY0: number;
  baselineOffsetMm: number;
  leadStepMm: number;
  headerProduct: { x: number; y: number; rows: readonly string[] };
  zones: Partial<Record<ZoneName, Rect>>;
}

function variant(spec: VariantSpec): ProfileVariant {
  const { headerProduct, ...rest } = spec;
  return {
    ...rest,
    plusRowStepMm: 10,
    leadStepPx: spec.leadStepMm * spec.pxPerMm,
    firstBaselineY: spec.gridRowY + spec.baselineOffsetMm * spec.pxPerMm,
    headerProduct: patchFromRows(headerProduct.x, headerProduct.y, headerProduct.rows),
  };
}

/** «Поли-Спектр.NET (v.6.0.10.0) www.neurosoft.com» — right part of the variant A header, x1070–1229, y31–39. */
const HEADER_PRODUCT_A = [
  '................................................................................................................................................................',
  '............................................................................................................................................#...................',
  '.####.................##......................##....##.###....#......##...###...##..##...###................................................#.#.................',
  '.#..#.##...##...#....#...####.##...#.######...##.....................#....#.#....#.#.......#.#.....#.#..#.#......###..##.....##.##..##..##..###...##..##.#####..',
  '....#...#..##.#.#.##.#...#...##.#.#...#.#..#..#.#...##..#....#......##.#..#........#..#....#.#...#.#.##.#.##.#...#..####.#.#.#....#.#..#..#...#......#...#....#.',
  '.#..#...#...#.#.#....#...#....#..##...#.#.....#..##..........#..##..#..#..#.#......#.......#.#...##.#.##.#.####..#..###..#.#.#.#..#..#.#..#.#.#......#...#......',
  '....#.##..#.#.#.......##.#....##...#..#.###......#..##..........#..#.##.#.##..#.....##.#.##..#....#.#.##.#.#..#.......##.###.#..##..##.###....###.##.###.#....#.',
  '........................................#.....................#.................................................................................................',
  '................................................................................................................................................................',
];

/** «Поли-Спектр.NET © Нейрософт www.neurosoft.com» — right part of the variant B header, x1052–1228, y23–31. */
const HEADER_PRODUCT_B = [
  '.................................................................................................................................................................................',
  '..................................................................................#..........................................................................#...................',
  '.####..................##.......................#..#.###..##.....###........#......#....................#....................................................#.#.................',
  '.....#.##...##...#....#...####..##.#.#.######...##........#......##.........#.##.#..#.###..##..##..##..####.##.....#.#..#.#..#....###.##.....##..##..##..##.#####..##..##.#####..',
  '.#....#..#.#.#.#.#..#.#......#.#.#.##..#..#.#.....#..###..#.....#.......##########.##.#...#..#.#..#..#..#.#.#....#.#.#..#.####...##.######...#..#..#.#..#......#......#..###.#.#.',
  '.#....#..#.#.#.#.#....#...#..#.#...##..#..#.#...#.##......#......#..........###..##...#...#..#.#..#..#..#.#.#....#..#.##.#.#..#.....###.....##..#..#..#.#..#...#......#..#...#.#.',
  '.#.....##..#.#.#.......##......###.#.#....###.#....#.###........####........#.##.##.#.###..##..##.###..###..#....#..#.#..#.#..#.#.....##..##.....##..##.###..#.###.##..##....#.#.',
  '..................................................................#...................#.................#........................................................................',
  '.................................................................................................................................................................................',
];

/**
 * Variant A: sheet 1280×905, header «Поли-Спектр.NET (v.6.0.10.0)», no RR row.
 * Frame: lines y=43 / y=860–861 / x=43 / x=1235–1236 → inner area x45–1233, y45–858.
 * Grid 4.305 px/mm, first 5-mm row y=64.75; baselines on 5-mm rows: 20 mm from the first, step 30 mm.
 * Text (measured): time labels y50–56, HR digits y69–78, lead labels x55–73, footer y866–876.
 */
const VARIANT_A = variant({
  width: 1280,
  height: 905,
  frame: rect(45, 45, 1189, 814),
  pxPerMm: 4.305,
  pxPerSecond: 215.3,
  gridRowY: 64.75,
  plusRowY0: 86.3,
  baselineOffsetMm: 20,
  leadStepMm: 30,
  headerProduct: { x: 1070, y: 31, rows: HEADER_PRODUCT_A },
  zones: {
    header: rect(0, 0, 1280, 43),
    headerName: rect(40, 26, 600, 17),
    headerProduct: rect(1070, 31, 160, 9),
    timeLabels: rect(80, 45, 1154, 16),
    hrRow: rect(80, 66, 1154, 17),
    leadLabels: rect(45, 83, 35, 776),
    plot: rect(80, 83, 1154, 776),
    footer: rect(0, 862, 1280, 43),
  },
});

/**
 * Variant B: sheet 1280×883, header «Поли-Спектр.NET © Нейрософт», below aVF a row of RR intervals in ms.
 * Frame: lines y=44–45 / y=837–838 / x=44–45 / x=1235 → inner area x47–1233, y47–835.
 * Grid 4.41 px/mm, first 5-mm row y=66.25; baselines NOT on 5-mm rows: 18.4 mm from the first, step 28.5 mm
 * (least squares over ink modes of 2 sheets × 6 leads: 147.2 + 125.6·k).
 * Text (measured): time labels y51–58, HR digits y71–80, labels x56–75, RR row y826–833, footer y852–863.
 */
const VARIANT_B = variant({
  width: 1280,
  height: 883,
  frame: rect(47, 47, 1187, 789),
  pxPerMm: 4.41,
  pxPerSecond: 220.6,
  gridRowY: 66.25,
  plusRowY0: 88.5,
  baselineOffsetMm: 18.4,
  leadStepMm: 28.5,
  headerProduct: { x: 1052, y: 23, rows: HEADER_PRODUCT_B },
  zones: {
    header: rect(0, 0, 1280, 44),
    headerName: rect(40, 20, 600, 18),
    headerProduct: rect(1052, 23, 177, 9),
    timeLabels: rect(80, 47, 1154, 16),
    hrRow: rect(80, 68, 1154, 17),
    leadLabels: rect(47, 85, 33, 738),
    plot: rect(80, 85, 1154, 738),
    rrRow: rect(80, 823, 1154, 13),
    footer: rect(0, 839, 1280, 44),
  },
});

export const POLYSPECTRUM: FormatProfile = {
  id: 'polyspectrum',
  name: 'Поли-Спектр.NET',
  variants: { A: VARIANT_A, B: VARIANT_B },
  // Glyph templates (digits, lead labels, species letters, footer fragments) — from `fixtures/polyspectrum/glyphs/`.
  glyphs: BUILTIN_GLYPH_SETS,
  thresholds: THRESHOLDS,
};
