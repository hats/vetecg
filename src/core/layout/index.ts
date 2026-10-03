/**
 * Module `layout`: frame, grid, sheet zones. Exposes `detectLayout(img, profile) -> PageLayout`;
 * hides frame search, autocorrelation and grid period fitting, search for the "+" second marks, variant choice.
 * An exception inside the step does not fail the sheet: it becomes an `issue` `exception:<message>` with zero confidence.
 *
 * Order: the grid is measured first (no period → the single code `no_grid`); then the frame is checked against
 * the profile (`no_frame`/`format_mismatch`), the period against the variant constants (`grid_out_of_profile:<px/mm>`,
 * the measurement is kept); expected baselines are computed from the measured grid phase and period.
 */
import type {
  FormatProfile,
  GrayImage,
  GridEstimate,
  PageLayout,
  PageVariant,
  ProfileVariant,
  Rect,
  Six,
  ZoneName,
} from '../../types/contracts';
import { findFrame } from './frame';
import { gridProfiles, measureAxis, type AxisMeasurement } from './grid';
import { findPlusMarks, type PlusMarks } from './plus';
import { decideVariant, type VariantDecision } from './variant';

const NO_GRID: GridEstimate = { pxPerMmX: 0, pxPerMmY: 0, phaseX: 0, phaseY: 0, confidence: 0 };

/** Raw quantities that make up the grid confidence and the variant choice (for reports and debugging). */
export interface GridDiagnostics {
  x: AxisMeasurement;
  y: AxisMeasurement;
  plus: PlusMarks;
  factors: Record<string, number>;
  variant: VariantDecision;
}

/** The variant nearest by sheet height; outside the tolerance — still the nearest (deterministic default). */
function nearestVariantByHeight(img: GrayImage, profile: FormatProfile): PageVariant {
  let best: PageVariant = 'A';
  let bestDiff = Infinity;
  for (const key of Object.keys(profile.variants) as PageVariant[]) {
    const diff = Math.abs(img.height - profile.variants[key].height);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = key;
    }
  }
  return best;
}

function shiftZones(zones: Partial<Record<ZoneName, Rect>>, dx: number, dy: number): Partial<Record<ZoneName, Rect>> {
  const out: Partial<Record<ZoneName, Rect>> = {};
  for (const [name, rect] of Object.entries(zones) as [ZoneName, Rect][]) {
    out[name] = { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
  }
  return out;
}

/** Baselines from profile constants, shifted together with the frame (when the grid is not measured). */
function profileBaselines(v: ProfileVariant, dy: number): Six<number> {
  return [0, 1, 2, 3, 4, 5].map((k) => v.firstBaselineY + dy + k * v.leadStepPx) as Six<number>;
}

/**
 * Baselines from the measured grid: from the 5-mm row nearest to the profile `gridRowY` (accounting for the frame
 * shift), down by `baselineOffsetMm + k · leadStepMm` millimetres of the measured Y period.
 */
function gridBaselines(v: ProfileVariant, dy: number, phaseY: number, pxPerMmY: number): Six<number> {
  const step5 = 5 * pxPerMmY;
  const n = Math.round((v.gridRowY + dy - phaseY) / step5);
  const row0 = phaseY + n * step5;
  return [0, 1, 2, 3, 4, 5].map((k) => row0 + (v.baselineOffsetMm + k * v.leadStepMm) * pxPerMmY) as Six<number>;
}

/** Linear saturation: 0 at `value ≤ zero`, 1 at `value ≥ one` (or the other way round if `one < zero`). */
function saturate(value: number, zero: number, one: number): number {
  const t = (value - zero) / (one - zero);
  return Math.max(0, Math.min(1, t));
}

function gridConfidence(x: AxisMeasurement, y: AxisMeasurement, plus: PlusMarks): Record<string, number> {
  const period = (x.period + y.period) / 2;
  // Saturation points leave margin over what was measured on 10 sheets: contrast 2.19–2.35, rms ≤ 0.073,
  // anisotropy ≤ 0.0008, second ±0.12 px (task 02 report).
  const factors: Record<string, number> = {
    contrast: saturate(Math.min(x.contrast1, y.contrast1), 1.2, 1.8),
    rms: saturate(Math.max(x.rms, y.rms), 0.5, 0.2),
    isotropy: saturate(Math.abs(x.period - y.period) / period, 0.03, 0.01),
    peaks: saturate(Math.min(x.peaks, y.peaks), 3, 8),
    seconds: plus.pxPerSecond === null ? 0.85 : saturate(Math.abs(plus.pxPerSecond - 50 * x.period), 3, 1),
  };
  factors.confidence = Math.min(...Object.values(factors));
  return factors;
}

function relativeError(measured: number, expected: number): number {
  return Math.abs(measured - expected) / expected;
}

function detect(img: GrayImage, profile: FormatProfile, diagnostics?: GridDiagnostics[]): PageLayout {
  const t = profile.thresholds;
  const issues: string[] = [];
  const frame = findFrame(img, t);
  const region: Rect = frame ? frame.inner : { x: 0, y: 0, width: img.width, height: img.height };

  // 1. Grid first: without a period the sheet cannot be calibrated and the other checks are pointless.
  const profiles = gridProfiles(img, region, t.gridLo, t.gridHi);
  const gx = measureAxis(profiles.x, region.x);
  const gy = measureAxis(profiles.y, region.y);
  if (!gx || !gy) {
    const variant = nearestVariantByHeight(img, profile);
    const v = profile.variants[variant];
    const dy = frame ? frame.inner.y - v.frame.y : 0;
    return {
      variant,
      frame: region,
      grid: NO_GRID,
      zones: shiftZones(v.zones, frame ? frame.inner.x - v.frame.x : 0, dy),
      expectedBaselines: profileBaselines(v, dy),
      confidence: 0,
      issues: ['no_grid'],
    };
  }

  // 2. Layout variant — by voting of features (RR row, header, frame, sheet height).
  const decision = decideVariant(img, profile, frame ? frame.inner : null);
  const { variant } = decision;
  const v = profile.variants[variant];
  const dx = frame ? frame.inner.x - v.frame.x : 0;
  const dy = frame ? frame.inner.y - v.frame.y : 0;
  const zones = shiftZones(v.zones, dx, dy);
  if (decision.ambiguous) issues.push('variant_ambiguous');

  // 3. The "+" second marks confirm the period: one second = 50 mm.
  const plus = findPlusMarks(
    img,
    region,
    { pxPerMmX: gx.period, pxPerMmY: gy.period, phaseX: gx.phase5, phaseY: gy.phase5 },
    t.inkCore,
    t.plusLineTolerance,
  );
  const factors = gridConfidence(gx, gy, plus);
  diagnostics?.push({ x: gx, y: gy, plus, factors, variant: decision });
  const grid: GridEstimate = {
    pxPerMmX: gx.period,
    pxPerMmY: gy.period,
    phaseX: gx.phase5,
    phaseY: gy.phase5,
    confidence: factors.confidence,
    ...(plus.pxPerSecond !== null ? { pxPerSecond: plus.pxPerSecond } : {}),
  };

  // 4. Frame and period against the profile constants.
  let confidence = Math.min(factors.confidence, decision.confidence);
  if (!frame) {
    issues.push('no_frame', 'format_mismatch');
    confidence = Math.min(confidence, 0.3);
  } else if (
    relativeError(frame.inner.width, v.frame.width) > t.frameTolerance ||
    relativeError(frame.inner.height, v.frame.height) > t.frameTolerance
  ) {
    issues.push('format_mismatch');
    confidence = Math.min(confidence, 0.3);
  }
  if (relativeError(gx.period, v.pxPerMm) > t.gridTolerance || relativeError(gy.period, v.pxPerMm) > t.gridTolerance) {
    issues.push(`grid_out_of_profile:${((gx.period + gy.period) / 2).toFixed(3)}`);
    confidence = Math.min(confidence, 0.7);
  }

  return {
    variant,
    frame: region,
    grid,
    zones,
    expectedBaselines: gridBaselines(v, dy, gy.phase5, gy.period),
    ...(plus.columnsX.length ? { plusLattice: { columnsX: plus.columnsX, rowsY: plus.rowsY } } : {}),
    confidence,
    issues,
  };
}

export function detectLayout(img: GrayImage, profile: FormatProfile): PageLayout {
  try {
    return detect(img, profile);
  } catch (error) {
    const variant = nearestVariantByHeight(img, profile);
    const v = profile.variants[variant];
    return {
      variant,
      frame: { x: 0, y: 0, width: img.width, height: img.height },
      grid: NO_GRID,
      zones: { ...v.zones },
      expectedBaselines: profileBaselines(v, 0),
      confidence: 0,
      issues: [`exception:${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/** Same as `detectLayout`, but with raw grid quantities — for reports and threshold calibration. */
export function detectLayoutWithDiagnostics(img: GrayImage, profile: FormatProfile): { layout: PageLayout; grid?: GridDiagnostics } {
  const diagnostics: GridDiagnostics[] = [];
  const layout = detect(img, profile, diagnostics);
  return { layout, grid: diagnostics[0] };
}
