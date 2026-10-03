/**
 * Wave delineation of one beat in II (SIGNAL-04, SIGNAL-05, SIGNAL-06): `delineate(beat, signalII, species, options?)`.
 * Input — the II signal after `filterSignal` (no drift; on the raw signal the P and T bounds float with the baseline).
 * All times are ms from the signal start and may be fractional (tangent intersections).
 *
 * QRS: in the window ±`qrsWindowMs` around the R peak in II (`beat.perLead.II.tMs`, else `beat.tMs`) the maximum
 * |slope| is taken; the QRS region is the contiguous span around it where |slope| ≥ 0.1 of the maximum, with a bridge
 * of up to 8 ms across the zero slope of wave peaks. Q onset — intersection with the PQ segment level of the tangent at
 * the point of maximum slope of the first limb (from the region start to the first extremum); S end — the same for the
 * last limb and the ST segment level (J point). The tangent to a straight limb does not depend on corner smoothing by
 * the device filters and our low-pass: the middle of the limb keeps its slope. R — maximum within the QRS, S — minimum
 * after R within the QRS (specification §3: S amplitude is needed for acceptance); a wave below the amplitude
 * threshold — `null`.
 *
 * Amplitude threshold for R, S, P, T — max(2 px of the sheet grid in mV, 3 × noise SD); noise — SD of first differences
 * of the segment before the QRS (MAD · 1.4826 / √2), 2 px — from `options.precision.mvPerPx` (absent — 1/(4.305·10),
 * variant A, 50/10).
 *
 * P (two-stage): window `[qOn − pSearch.maxMs, qOn − pSearch.minMs]` (the QRS is not in it — this is the "QRS removal"),
 * the linear trend across the window edges is subtracted, the peak is the maximum |deviation| not at the window edge;
 * bounds — tangents at the points of maximum slope of both limbs; P is "found" if the amplitude ≥ threshold and the
 * duration is within the species range `pDuration` (norms × margin, `species.ts`). Otherwise `pFound: false`,
 * `pOn`/`pOff` — `null`: no made-up P waves.
 *
 * T: peak — maximum |deviation| in the window from `sOff + 20 ms` to `qOn + 1.25·QT_max`, cut by the onset of the next
 * complex (`options.nextTMs`, else the next steep front ≥ 0.5 of the maximum QRS slope); end — intersection with the
 * baseline of the tangent at the point of steepest return to it after the peak (tangent method). Peak at the window
 * edge — `t_window_truncated`, no end is set.
 *
 * Confidence: 1 × 0.7 with QRS wider than `qrsMaxPlausibleMs` (`qrs_too_wide`) × 0.85 without T (`t_not_found`) × 0.9
 * without P (`p_not_found` plus a detail: `p_low_amplitude` | `p_duration_out_of_range` | `p_lobe_outside_window` |
 * `p_window_too_short`) × 0.3 if any wave lies within `clipped`/`gap` (`unreliable_segment`: that is not signal).
 * No signal or the beat outside it — all `null`, confidence 0, `no_signal`; QRS region not found — `qrs_not_found`.
 */
import type { Beat, Delineation, LeadSignal, PagePrecision, Species } from '../../types/contracts';
import { beatProfileFor } from './species';

export interface DelineateOptions {
  /** Sheet precision ceiling (`PageResult.precision`) — for the "2 grid px" threshold. */
  precision?: PagePrecision;
  /** Time of the next beat, ms — bound of the T window. */
  nextTMs?: number;
  /** Time of the previous beat, ms — bound of the P window. */
  prevTMs?: number;
}

/** 2 px of the variant A grid at 10 mm/mV — default when the sheet precision is not passed. */
const DEFAULT_MV_PER_PX = 1 / (4.305 * 10);
const GRID_PX_THRESHOLD = 2;
const NOISE_SIGMAS = 3;
/**
 * Slope threshold: a fraction of the maximum in the window, but not below `NOISE_SIGMAS` × noise slope SD; bridge
 * across peaks (samples). Fractions are tried in ascending order until the QRS region is no wider than the profile's
 * `qrsRegionMaxMs`: the QRS has the steepest fronts, and raising the threshold cuts off captured T or P (tachycardia,
 * short ST).
 */
const SLOPE_FRACTIONS = [0.06, 0.12, 0.2, 0.3];
const SLOPE_GAP_SAMPLES = 4;
const QRS_MIN_SAMPLES = 4;
/** Half-windows of slope regression at the tangent point: steep short QRS limbs and gentle long P/T limbs. */
const QRS_TANGENT_HALF = 2;
const WAVE_TANGENT_HALF = 4;
/** PQ segment for the baseline: this many ms before the QRS region start; ST segment for the J level: ms after its end. */
const PQ_LEVEL_MS: [number, number] = [16, 4];
const ST_LEVEL_MS: [number, number] = [10, 30];
/** Next complex without `nextTMs`: a steep front not below this fraction of the maximum QRS slope. */
const NEXT_QRS_SLOPE_FRACTION = 0.5;
const NEXT_QRS_MARGIN_MS = 16;
const QRS_WIDE_FACTOR = 0.7;
const NO_T_FACTOR = 0.85;
const NO_P_FACTOR = 0.9;
const UNRELIABLE_FACTOR = 0.3;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianOf(mv: ArrayLike<number>, from: number, to: number): number | undefined {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(mv.length - 1, Math.max(from, to));
  if (b < a) return undefined;
  const values: number[] = [];
  for (let i = a; i <= b; i++) values.push(mv[i]);
  return median(values);
}

/** Central difference smoothed over three samples. */
function slopes(mv: Float32Array): Float32Array {
  const n = mv.length;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = (mv[Math.min(n - 1, i + 1)] - mv[Math.max(0, i - 1)]) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (raw[Math.max(0, i - 1)] + raw[i] + raw[Math.min(n - 1, i + 1)]) / 3;
  return out;
}

/**
 * Noise SD from second differences: MAD · 1.4826 / √6. The curvature of smooth waves (P, T, even QRS at 500 Hz) is
 * small, that of noise is large, so the estimate does not inflate where waves occupy most of the signal (tachycardia).
 */
function noiseSigma(mv: ArrayLike<number>, from: number, to: number): number {
  const diffs: number[] = [];
  for (let i = Math.max(1, from); i <= Math.min(mv.length - 2, to); i++) diffs.push(Math.abs(mv[i + 1] - 2 * mv[i] + mv[i - 1]));
  if (diffs.length < 4) return 0;
  const med = median(diffs);
  const mad = median(diffs.map((d) => Math.abs(d - med)));
  return (1.4826 * mad) / Math.sqrt(6);
}

function argExtreme(values: ArrayLike<number>, from: number, to: number, score: (v: number, i: number) => number): number {
  let best = from;
  let bestScore = -Infinity;
  for (let i = from; i <= to; i++) {
    const s = score(values[i], i);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

/**
 * Middle of a wave limb: the first sample from the peak `peak` in direction `step` where |deviation| ≤ half the
 * amplitude (no farther than `limit`). The tangent is taken here — the middle of the limb keeps its slope after
 * smoothing, while near its end the regression window captures the baseline and underestimates the slope.
 */
function midLimb(values: ArrayLike<number>, peak: number, step: 1 | -1, limit: number, level: number, half: number): number {
  for (let i = peak; step > 0 ? i <= limit : i >= limit; i += step) {
    if (Math.abs(values[i] - level) <= half) return i;
  }
  return limit;
}

/** First extremum after `from` (slope sign change) no farther than `to`; none — `to`. */
function firstExtremum(slope: Float32Array, from: number, to: number): number {
  for (let i = from + 1; i < to; i++) if (slope[i] * slope[i + 1] <= 0 && slope[i] !== 0) return i;
  return to;
}

function lastExtremum(slope: Float32Array, from: number, to: number): number {
  for (let i = to - 1; i > from; i--) if (slope[i] * slope[i - 1] <= 0 && slope[i] !== 0) return i;
  return from;
}

/** Slope and value of a least-squares line fitted to `mv` on `[i − half, i + half]` (single-point noise does not shift the tangent). */
function regressionLine(mv: Float32Array, i: number, half: number): { slope: number; value: number } {
  const a = Math.max(0, i - half);
  const b = Math.min(mv.length - 1, i + half);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const m = b - a + 1;
  for (let k = a; k <= b; k++) {
    const x = k - i;
    sx += x;
    sy += mv[k];
    sxx += x * x;
    sxy += x * mv[k];
  }
  const denom = m * sxx - sx * sx;
  const slope = denom !== 0 ? (m * sxy - sx * sy) / denom : 0;
  return { slope, value: (sy - slope * sx) / m };
}

/** Intersection of the tangent at point `i` with level `level`, in samples; no slope — the point itself. */
function tangentCrossing(mv: Float32Array, i: number, level: number, half: number): number {
  const line = regressionLine(mv, i, half);
  return line.slope !== 0 ? i + (level - line.value) / line.slope : i;
}

function inUnreliable(signal: LeadSignal, ms: number | null): boolean {
  if (ms === null) return false;
  const i = Math.round((ms * signal.fs) / 1000);
  return signal.unreliable.some((u) => u.kind !== 'ambiguous' && i >= u.i0 && i <= u.i1);
}

function empty(reasons: string[]): Delineation {
  return { pOn: null, pOff: null, pFound: false, qOn: null, rPeak: null, sPeak: null, sOff: null, tPeak: null, tOff: null, confidence: 0, reasons };
}

export function delineate(beat: Beat, signalII: LeadSignal, species: Species, options: DelineateOptions = {}): Delineation {
  const profile = beatProfileFor(species);
  const mv = signalII.mv;
  const n = mv.length;
  const fs = signalII.fs;
  const sampleMs = 1000 / fs;
  const toSamples = (ms: number): number => Math.round((ms * fs) / 1000);
  const toMs = (i: number): number => i * sampleMs;
  const centerMs = beat.perLead.II?.tMs ?? beat.tMs;
  const c = Math.round(centerMs / sampleMs);
  if (n < 8 || c < 0 || c >= n) return empty(['no_signal']);

  const reasons: string[] = [];
  const W = toSamples(profile.qrsWindowMs);
  const a = Math.max(0, c - W);
  const b = Math.min(n - 1, c + W);
  const slope = slopes(mv);

  // 1. QRS region by slope threshold from the point of maximum slope.
  const peakSlope = argExtreme(slope, a, b, (v) => Math.abs(v));
  const maxSlope = Math.abs(slope[peakSlope]);
  if (!(maxSlope > 0)) return empty(['qrs_not_found']);
  // Noise — robustly over the whole lead (MAD of first differences): a single-beat window in tachycardia consists of waves.
  const slopeNoise = noiseSigma(slope, 0, n - 1);
  const expand = (thr: number): [number, number] => {
    let lo = peakSlope;
    for (let i = peakSlope - 1, gap = 0; i >= a; i--) {
      if (Math.abs(slope[i]) >= thr) {
        lo = i;
        gap = 0;
      } else if (++gap > SLOPE_GAP_SAMPLES) break;
    }
    let hi = peakSlope;
    for (let i = peakSlope + 1, gap = 0; i <= b; i++) {
      if (Math.abs(slope[i]) >= thr) {
        hi = i;
        gap = 0;
      } else if (++gap > SLOPE_GAP_SAMPLES) break;
    }
    return [lo, hi];
  };
  const regionMax = toSamples(profile.qrsRegionMaxMs);
  let [lo, hi] = expand(Math.max(SLOPE_FRACTIONS[0] * maxSlope, NOISE_SIGMAS * slopeNoise));
  for (let k = 1; k < SLOPE_FRACTIONS.length && hi - lo > regionMax; k++) {
    [lo, hi] = expand(Math.max(SLOPE_FRACTIONS[k] * maxSlope, NOISE_SIGMAS * slopeNoise));
  }
  if (hi - lo < QRS_MIN_SAMPLES) return empty(['qrs_not_found']);

  // 2. Levels: baseline from the PQ segment, J level from the ST segment.
  const base = medianOf(mv, lo - toSamples(PQ_LEVEL_MS[0]), lo - toSamples(PQ_LEVEL_MS[1])) ?? medianOf(mv, a, b) ?? 0;
  const stLevel = medianOf(mv, hi + toSamples(ST_LEVEL_MS[0]), hi + toSamples(ST_LEVEL_MS[1])) ?? base;
  const mvPerPx = options.precision && options.precision.mvPerPx > 0 ? options.precision.mvPerPx : DEFAULT_MV_PER_PX;
  const sigma = noiseSigma(mv, 0, n - 1);
  const amplitudeThreshold = Math.max(GRID_PX_THRESHOLD * mvPerPx, NOISE_SIGMAS * sigma);

  // 3. QRS bounds by the tangent method.
  const firstExt = firstExtremum(slope, lo, hi);
  const onsetTangent = argExtreme(slope, lo, Math.max(lo, firstExt), (v) => Math.abs(v));
  const qOnSamples = Math.min(firstExt, Math.max(lo - SLOPE_GAP_SAMPLES, tangentCrossing(mv, onsetTangent, base, QRS_TANGENT_HALF)));
  const lastExt = lastExtremum(slope, lo, hi);
  const offsetTangent = argExtreme(slope, Math.min(hi, lastExt), hi, (v) => Math.abs(v));
  const sOffSamples = Math.max(lastExt, Math.min(hi + SLOPE_GAP_SAMPLES, tangentCrossing(mv, offsetTangent, stLevel, QRS_TANGENT_HALF)));

  // 4. R and S peaks within the QRS.
  const qrsA = Math.max(0, Math.floor(qOnSamples));
  const qrsB = Math.min(n - 1, Math.ceil(sOffSamples));
  const rIdx = argExtreme(mv, qrsA, qrsB, (v) => v);
  const rPeak = mv[rIdx] - base >= amplitudeThreshold ? rIdx : null;
  const sIdx = argExtreme(mv, rPeak ?? qrsA, qrsB, (v) => -v);
  const sPeak = base - mv[sIdx] >= amplitudeThreshold ? sIdx : null;

  // 5. T: window after the QRS, cut by the next complex.
  const tStart = Math.min(n - 1, qrsB + toSamples(profile.tSearch.minAfterQrsMs));
  let tEnd = Math.min(n - 1, qrsA + toSamples(profile.tSearch.maxFromQOnMs));
  if (options.nextTMs !== undefined) {
    const nextOnset = toSamples(options.nextTMs) - ((rPeak ?? c) - qrsA);
    tEnd = Math.min(tEnd, nextOnset - toSamples(NEXT_QRS_MARGIN_MS));
  } else {
    for (let i = tStart; i <= tEnd; i++) {
      if (Math.abs(slope[i]) >= NEXT_QRS_SLOPE_FRACTION * maxSlope) {
        tEnd = i - toSamples(NEXT_QRS_MARGIN_MS);
        break;
      }
    }
  }
  let tPeak: number | null = null;
  let tOff: number | null = null;
  if (tEnd - tStart >= QRS_MIN_SAMPLES) {
    const tIdx = argExtreme(mv, tStart, tEnd, (v) => Math.abs(v - base));
    const tAmp = mv[tIdx] - base;
    if (Math.abs(tAmp) >= amplitudeThreshold) {
      tPeak = tIdx;
      if (tIdx >= tEnd - 1) {
        reasons.push('t_window_truncated');
      } else {
        const sign = Math.sign(tAmp);
        // Tangent to the descending limb — at its middle (half the T amplitude), intersected with the baseline.
        const ret = midLimb(mv, tIdx, 1, tEnd, base, Math.abs(tAmp) / 2);
        if (ret > tIdx && -sign * regressionLine(mv, ret, WAVE_TANGENT_HALF).slope > 0) {
          const crossing = tangentCrossing(mv, ret, base, WAVE_TANGENT_HALF);
          if (crossing > tIdx && crossing <= tEnd + SLOPE_GAP_SAMPLES) tOff = crossing;
        }
      }
    }
  }
  if (tOff === null && !reasons.includes('t_window_truncated')) reasons.push('t_not_found');

  // 6. P in the PQ window after linear detrending.
  let pOn: number | null = null;
  let pOff: number | null = null;
  let pFound = false;
  let pDetail = 'p_window_too_short';
  let pLo = Math.max(0, qrsA - toSamples(profile.pSearch.maxMs));
  if (options.prevTMs !== undefined) pLo = Math.max(pLo, toSamples(options.prevTMs) + W);
  const pHi = Math.max(0, qrsA - toSamples(profile.pSearch.minMs));
  if (pHi - pLo >= 2 * SLOPE_GAP_SAMPLES + 2) {
    const edge = Math.max(2, Math.floor((pHi - pLo) / 10));
    const lv = medianOf(mv, pLo, pLo + edge) ?? mv[pLo];
    const rv = medianOf(mv, pHi - edge, pHi) ?? mv[pHi];
    const len = pHi - pLo;
    const d = new Float32Array(len + 1);
    for (let i = 0; i <= len; i++) d[i] = mv[pLo + i] - (lv + ((rv - lv) * i) / len);
    const pIdx = argExtreme(d, 2, len - 2, (v) => Math.abs(v));
    const pAmp = Math.abs(d[pIdx]);
    const pThreshold = Math.max(GRID_PX_THRESHOLD * mvPerPx, NOISE_SIGMAS * noiseSigma(d, 0, len));
    if (pAmp >= amplitudeThreshold && pAmp >= pThreshold) {
      // Tangents at the middles of the P limbs (half amplitude), intersected with the trend line.
      const onTangent = midLimb(d, pIdx, -1, 0, 0, pAmp / 2);
      const offTangent = midLimb(d, pIdx, 1, len, 0, pAmp / 2);
      const on = tangentCrossing(d, onTangent, 0, QRS_TANGENT_HALF);
      const off = tangentCrossing(d, offTangent, 0, QRS_TANGENT_HALF);
      const durationMs = toMs(off - on);
      // The lobe is entirely within the window (going past the edge — T tail or trend, not P) and duration is in the species range.
      if (!(on < pIdx && off > pIdx && on >= 0 && off <= len)) pDetail = 'p_lobe_outside_window';
      else if (durationMs < profile.pDuration.minMs || durationMs > profile.pDuration.maxMs) pDetail = 'p_duration_out_of_range';
      else {
        pFound = true;
        pOn = toMs(pLo + on);
        pOff = Math.min(toMs(pLo + off), toMs(qOnSamples));
      }
    } else {
      pDetail = 'p_low_amplitude';
    }
  }
  if (!pFound) reasons.push('p_not_found', pDetail);

  // 7. Confidence.
  let confidence = 1;
  const qOn = toMs(qOnSamples);
  const sOff = toMs(sOffSamples);
  if (sOff - qOn > profile.qrsMaxPlausibleMs) {
    reasons.push('qrs_too_wide');
    confidence *= QRS_WIDE_FACTOR;
  }
  if (tOff === null) confidence *= NO_T_FACTOR;
  if (!pFound) confidence *= NO_P_FACTOR;
  const marks = [qOn, sOff, rPeak !== null ? toMs(rPeak) : null, sPeak !== null ? toMs(sPeak) : null, tPeak !== null ? toMs(tPeak) : null, tOff !== null ? toMs(tOff) : null, pOn, pOff];
  if (marks.some((m) => inUnreliable(signalII, m))) {
    reasons.push('unreliable_segment');
    confidence *= UNRELIABLE_FACTOR;
  }

  return {
    pOn,
    pOff,
    pFound,
    qOn,
    rPeak: rPeak !== null ? toMs(rPeak) : null,
    sPeak: sPeak !== null ? toMs(sPeak) : null,
    sOff,
    tPeak: tPeak !== null ? toMs(tPeak) : null,
    tOff: tOff !== null ? toMs(tOff) : null,
    confidence: Math.max(0, Math.min(1, confidence)),
    reasons,
  };
}
