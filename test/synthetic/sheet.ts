/**
 * Generator of a synthetic sheet "in the style of the Poli-Spektr.NET profile" (variant A) with known ground truth.
 * A shared test tool of tasks 04–07: frame, dotted grid 4.305 px/mm, 5-mm dashed lines, "+" lattice,
 * six anti-aliased 1.5 px wide curves of given shapes. No font; instead of HR digits — optionally
 * solid block "glyphs" in the HR row zone (`hrDigits`), to test text removal component by component.
 *
 * Curve coordinates are in pixels: integer y is the center of a pixel row, so a flat line at y = 150.0
 * inks exactly row 150, and the column's darkness center of mass returns 150.0.
 */
import { createGrayImage } from '../../src/core/image';
import { POLYSPECTRUM } from '../../src/core/profile';
import { LEAD_IDS, type GrayImage, type LeadId, type Point, type Rect } from '../../src/types/contracts';

/** Curve shape: deviation from the baseline in px for coordinate x (positive — up the sheet). */
export type Shape = (x: number) => number;

export interface SyntheticLead {
  id: LeadId;
  shape: Shape;
  /** Baseline, sheet px; defaults to the profile anchor for this lead. */
  baselineY?: number;
}

export interface SyntheticSheetSpec {
  leads?: Partial<Record<LeadId, Shape>>;
  /** Lead baselines; default to the profile anchors (variant A). */
  baselines?: Partial<Record<LeadId, number>>;
  grid?: boolean;
  plus?: boolean;
  frame?: boolean;
  /** Curve stroke width, px. */
  lineWidth?: number;
  /** First and last curve column (inclusive). */
  xStart?: number;
  xEnd?: number;
  /** Curve samples per column (the device draws a polyline through samples; real sheets have ≈ 2–5). */
  samplesPerColumn?: number;
  /** x centers of HR row "digits": each is a solid 5×10 px block in the `hrRow` zone. */
  hrDigits?: number[];
  /** White cutouts over the curves (imitating a recording gap). */
  cutouts?: Rect[];
}

export interface SyntheticLeadTruth {
  id: LeadId;
  baselineY: number;
  /**
   * True curve y (px) at an arbitrary x — from the drawn polyline (linear interpolation
   * between samples), not from the formula: the device also draws a polyline, and a sharp peak between samples
   * is absent from the sheet.
   */
  y: (x: number) => number;
  /** y extremum over the column x span (x−0.5..x+0.5): minimum (top) and maximum (bottom). */
  extremes: (x: number) => { top: number; bottom: number };
}

export interface SyntheticSheet {
  image: GrayImage;
  spec: Required<Omit<SyntheticSheetSpec, 'leads' | 'baselines' | 'hrDigits' | 'cutouts'>> & { hrDigits: number[]; cutouts: Rect[] };
  leads: SyntheticLeadTruth[];
  /** Inner area of the frame (profile convention). */
  frame: Rect;
  plusMarks: Point[];
  /** HR row "digit" blocks as sheet rectangles. */
  hrDigitRects: Rect[];
}

const VARIANT = POLYSPECTRUM.variants.A;
/** Variant A frame lines: x=43 and 1235–1236, y=43 and 860–861 (inner area x45–1233, y45–858). */
const FRAME_LINES = { left: 43, right: 1235, top: 43, bottom: 860 };
const GRID_GRAY = 200;
const FRAME_GRAY = 140;
const PLUS_ROW_STEP_PX = VARIANT.plusRowStepMm * VARIANT.pxPerMm;

/** Classic complex shape: P, Q, R, S, T as smooth humps (amplitudes in px, widths in px). */
export interface BeatShapeSpec {
  /** Beat period, px. */
  periodPx: number;
  /** Offset of the first beat, px. */
  phasePx?: number;
  p?: number;
  q?: number;
  r?: number;
  s?: number;
  t?: number;
  /** Hump widths (σ), px. */
  widths?: { p?: number; qrs?: number; t?: number };
  /** Linear baseline drift: px per column (positive — up). */
  driftPerPx?: number;
}

function bump(x: number, center: number, sigma: number): number {
  const d = (x - center) / sigma;
  return Math.exp(-0.5 * d * d);
}

/** Beat train shape: Gaussian P/T humps and triangular Q/R/S; defaults to a moderate dog complex. */
export function beatShape(spec: BeatShapeSpec): Shape {
  const period = spec.periodPx;
  const phase = spec.phasePx ?? 0;
  const p = spec.p ?? 8;
  const q = spec.q ?? 6;
  const r = spec.r ?? 60;
  const s = spec.s ?? 15;
  const t = spec.t ?? 12;
  const wp = spec.widths?.p ?? 6;
  const wqrs = spec.widths?.qrs ?? 2.5;
  const wt = spec.widths?.t ?? 10;
  const drift = spec.driftPerPx ?? 0;
  const tri = (x: number, center: number, half: number) => Math.max(0, 1 - Math.abs(x - center) / half);
  return (x) => {
    const u = ((x - phase) % period + period) % period;
    let v = 0;
    v += p * bump(u, period * 0.3, wp);
    v -= q * tri(u, period * 0.46, wqrs);
    v += r * tri(u, period * 0.5, wqrs);
    v -= s * tri(u, period * 0.54, wqrs);
    v += t * bump(u, period * 0.72, wt);
    return v + drift * x;
  };
}

/** Straight baseline without complexes. */
export const flatShape: Shape = () => 0;

/** Six expected variant A baselines (profile anchors). */
export function profileBaselines(): Record<LeadId, number> {
  const out = {} as Record<LeadId, number>;
  LEAD_IDS.forEach((id, k) => {
    out[id] = VARIANT.firstBaselineY + k * VARIANT.leadStepPx;
  });
  return out;
}

/** Pixel coverage by a stroke of width `width` whose center is at distance `d`. */
function coverage(d: number, width: number): number {
  return Math.max(0, Math.min(1, width / 2 + 0.5 - d));
}

/** Draws a stroke segment; pixels outside `clip` are not drawn — like the device, which does not draw beyond the frame. */
function drawSegment(image: GrayImage, x0: number, y0: number, x1: number, y1: number, width: number, clip: Rect): void {
  const { width: w, data } = image;
  const reach = width / 2 + 1;
  const xa = Math.max(clip.x, Math.floor(Math.min(x0, x1) - reach));
  const xb = Math.min(clip.x + clip.width - 1, Math.ceil(Math.max(x0, x1) + reach));
  const ya = Math.max(clip.y, Math.floor(Math.min(y0, y1) - reach));
  const yb = Math.min(clip.y + clip.height - 1, Math.ceil(Math.max(y0, y1) + reach));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      let t = len2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = x0 + t * dx;
      const py = y0 + t * dy;
      const d = Math.hypot(x - px, y - py);
      const c = coverage(d, width);
      if (c <= 0) continue;
      const gray = Math.round(255 * (1 - c));
      const i = y * w + x;
      if (gray < data[i]) data[i] = gray;
    }
  }
}

function drawCurve(image: GrayImage, truth: SyntheticLeadTruth, xStart: number, xEnd: number, spc: number, width: number, clip: Rect): void {
  const n = Math.round((xEnd - xStart) * spc);
  let px = xStart;
  let py = truth.y(xStart);
  for (let i = 1; i <= n; i++) {
    const x = xStart + i / spc;
    const y = truth.y(x);
    drawSegment(image, px, py, x, y, width, clip);
    px = x;
    py = y;
  }
}

/** Polyline through curve samples: vertices at `xStart + i / spc`, linear interpolation between them. */
function sampledCurve(shape: Shape, baselineY: number, xStart: number, xEnd: number, spc: number): (x: number) => number {
  const n = Math.round((xEnd - xStart) * spc);
  const ys = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) ys[i] = baselineY - shape(xStart + i / spc);
  return (x) => {
    const t = (x - xStart) * spc;
    if (t <= 0) return ys[0];
    if (t >= n) return ys[n];
    const i = Math.floor(t);
    const f = t - i;
    return ys[i] * (1 - f) + ys[i + 1] * f;
  };
}

/** Per-second "+" columns and rows every 10 mm, as on a variant A sheet (X phase at the first 5-mm line). */
function plusLattice(frame: Rect): { columnsX: number[]; rowsY: number[] } {
  const step5 = 5 * VARIANT.pxPerMm;
  const phaseX = frame.x + 2 + step5; // first 5-mm X line, offset from the frame
  const columnsX: number[] = [];
  for (let x = phaseX; x <= frame.x + frame.width - 4; x += 10 * step5) columnsX.push(x);
  const rowsY: number[] = [];
  for (let y = VARIANT.plusRowY0; y <= frame.y + frame.height - 3; y += PLUS_ROW_STEP_PX) rowsY.push(y);
  return { columnsX, rowsY };
}

/**
 * Draws the sheet. Grid: 1-mm dots of luminance 200 and 5-mm lines dashed every other pixel; Y phase as in
 * the profile (`gridRowY` = 64.75), X phase — the first 5-mm line 5 mm from the left edge of the area.
 */
export function renderSheet(spec: SyntheticSheetSpec = {}): SyntheticSheet {
  const width = VARIANT.width;
  const height = VARIANT.height;
  const image = createGrayImage(width, height);
  const { data } = image;
  const put = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) {
      const i = y * width + x;
      if (v < data[i]) data[i] = v;
    }
  };
  const frame: Rect = { ...VARIANT.frame };
  const full = {
    grid: spec.grid ?? true,
    plus: spec.plus ?? true,
    frame: spec.frame ?? true,
    lineWidth: spec.lineWidth ?? 1.5,
    xStart: spec.xStart ?? 86,
    xEnd: spec.xEnd ?? 1233,
    samplesPerColumn: spec.samplesPerColumn ?? 4,
    hrDigits: spec.hrDigits ?? [],
    cutouts: spec.cutouts ?? [],
  };

  if (full.grid) {
    const P = VARIANT.pxPerMm;
    const step5 = 5 * P;
    const phaseX = frame.x + 2 + step5;
    const phaseY = VARIANT.gridRowY;
    const x0 = frame.x;
    const x1 = frame.x + frame.width - 1;
    const y0 = frame.y;
    const y1 = frame.y + frame.height - 1;
    // 1-mm nodes
    for (let j = -5; ; j++) {
      const y = Math.round(phaseY + j * P);
      if (y > y1) break;
      if (y < y0) continue;
      for (let i = -5; ; i++) {
        const x = Math.round(phaseX + i * P);
        if (x > x1) break;
        if (x < x0) continue;
        put(x, y, GRID_GRAY);
      }
    }
    // 5-mm dashed lines
    for (let j = -1; ; j++) {
      const y = Math.round(phaseY + j * step5);
      if (y > y1) break;
      if (y < y0) continue;
      for (let x = x0; x <= x1; x += 2) put(x, y, GRID_GRAY);
    }
    for (let i = -1; ; i++) {
      const x = Math.round(phaseX + i * step5);
      if (x > x1) break;
      if (x < x0) continue;
      for (let y = y0; y <= y1; y += 2) put(x, y, GRID_GRAY);
    }
  }

  const plusMarks: Point[] = [];
  if (full.plus) {
    const lattice = plusLattice(frame);
    for (const cx of lattice.columnsX) {
      for (const cy of lattice.rowsY) {
        const x = Math.round(cx);
        const y = Math.round(cy);
        for (let d = -2; d <= 2; d++) {
          put(x + d, y, 0);
          put(x, y + d, 0);
        }
        plusMarks.push({ x, y });
      }
    }
  }

  if (full.frame) {
    const { left, right, top, bottom } = FRAME_LINES;
    for (let x = left; x <= right + 1; x++) {
      put(x, top, FRAME_GRAY);
      put(x, bottom, FRAME_GRAY);
      put(x, bottom + 1, FRAME_GRAY);
    }
    for (let y = top; y <= bottom + 1; y++) {
      put(left, y, FRAME_GRAY);
      put(right, y, FRAME_GRAY);
      put(right + 1, y, FRAME_GRAY);
    }
  }

  const hrDigitRects: Rect[] = [];
  const hrZone = VARIANT.zones.hrRow!;
  for (const cx of full.hrDigits) {
    const rect: Rect = { x: Math.round(cx) - 2, y: hrZone.y + 3, width: 5, height: 10 };
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) put(x, y, 0);
    hrDigitRects.push(rect);
  }

  const baselines = { ...profileBaselines(), ...(spec.baselines ?? {}) };
  const leads: SyntheticLeadTruth[] = [];
  for (const id of LEAD_IDS) {
    const shape = spec.leads?.[id] ?? flatShape;
    const baselineY = baselines[id];
    const y = sampledCurve(shape, baselineY, full.xStart, full.xEnd, full.samplesPerColumn);
    const extremes = (x: number) => {
      let top = Infinity;
      let bottom = -Infinity;
      for (let k = 0; k <= 20; k++) {
        const v = y(x - 0.5 + k / 20);
        if (v < top) top = v;
        if (v > bottom) bottom = v;
      }
      return { top, bottom };
    };
    const truth: SyntheticLeadTruth = { id, baselineY, y, extremes };
    leads.push(truth);
    drawCurve(image, truth, full.xStart, full.xEnd, full.samplesPerColumn, full.lineWidth, frame);
  }
  for (const cut of full.cutouts) {
    for (let y = cut.y; y < cut.y + cut.height; y++) for (let x = cut.x; x < cut.x + cut.width; x++) {
      if (x >= 0 && y >= 0 && x < width && y < height) data[y * width + x] = 255;
    }
  }

  return { image, spec: full, leads, frame, plusMarks, hrDigitRects };
}
