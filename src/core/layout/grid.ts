/**
 * Dot-grid measurement along one axis: profile of grid-brightness pixel counts per row/column →
 * autocorrelation (coarse period) → refinement by least-squares fitting of subpixel peaks →
 * phase by folding the profile over the period (1 mm) and over five periods (5-mm dotted lines).
 */
import type { GrayImage, Rect } from '../../types/contracts';

export interface AxisMeasurement {
  /** Grid period, px/mm. */
  period: number;
  /** Coordinate of the first 5-mm line inside the region (sheet px). */
  phase5: number;
  /** Coordinate of the first 1-mm node inside the region (sheet px). */
  phase1: number;
  /** Fold peak / mean: over the 1 mm and the 5 mm period. */
  contrast1: number;
  contrast5: number;
  /** Residual of the autocorrelation peak fit, px. */
  rms: number;
  /** Number of autocorrelation peaks in the fit. */
  peaks: number;
}

export interface GridProfiles {
  x: Float64Array;
  y: Float64Array;
}

/** Column and row profiles of the region: count of pixels with brightness `lo..hi` inclusive. */
export function gridProfiles(img: GrayImage, rect: Rect, lo: number, hi: number): GridProfiles {
  const x = new Float64Array(rect.width);
  const y = new Float64Array(rect.height);
  const { width, data } = img;
  for (let j = 0; j < rect.height; j++) {
    const row = (rect.y + j) * width + rect.x;
    let count = 0;
    for (let i = 0; i < rect.width; i++) {
      const v = data[row + i];
      if (v >= lo && v <= hi) {
        count++;
        x[i]++;
      }
    }
    y[j] = count;
  }
  return { x, y };
}

function autocorrelation(profile: Float64Array, maxLag: number): Float64Array | null {
  const n = profile.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += profile[i];
  mean /= n;
  const centered = Float64Array.from(profile, (v) => v - mean);
  let s0 = 0;
  for (let i = 0; i < n; i++) s0 += centered[i] * centered[i];
  if (s0 === 0) return null;
  const ac = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += centered[i] * centered[i + lag];
    ac[lag] = s / s0;
  }
  return ac;
}

/** Vertex of the parabola through three points (−1, y0), (0, y1), (1, y2): offset from the centre, in [-0.5, 0.5]. */
function parabolicOffset(y0: number, y1: number, y2: number): number {
  const denominator = y0 - 2 * y1 + y2;
  if (denominator === 0) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denominator));
}

interface PeriodFit {
  period: number;
  rms: number;
  peaks: number;
}

/** Coarse period is the first local autocorrelation maximum from lag 3; refinement is least squares over multiple peaks. */
function fitPeriod(ac: Float64Array, maxPeaks: number): PeriodFit | null {
  let coarse = -1;
  for (let lag = 3; lag < ac.length - 1; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > 0.05) {
      coarse = lag;
      break;
    }
  }
  if (coarse < 0) return null;

  let period = coarse;
  const lags: { k: number; lag: number }[] = [];
  let sumK2 = 0;
  let sumKLag = 0;
  for (let k = 1; k <= maxPeaks; k++) {
    const center = Math.round(k * period);
    if (center + 2 >= ac.length) break;
    let best = center;
    for (let d = -2; d <= 2; d++) if (ac[center + d] > ac[best]) best = center + d;
    const lag = best + parabolicOffset(ac[best - 1], ac[best], ac[best + 1]);
    lags.push({ k, lag });
    sumK2 += k * k;
    sumKLag += k * lag;
    period = sumKLag / sumK2;
  }
  if (lags.length === 0) return null;
  let residual = 0;
  for (const { k, lag } of lags) residual += (lag - k * period) ** 2;
  return { period, rms: Math.sqrt(residual / lags.length), peaks: lags.length };
}

interface Fold {
  /** Phase of the fold maximum from the region start, px (subpixel). */
  phase: number;
  contrast: number;
}

/** Folds the profile over `period` with bin `binWidth`; the maximum is refined by a parabola over neighbouring bins. */
function fold(profile: Float64Array, period: number, binWidth: number): Fold {
  const bins = Math.max(1, Math.round(period / binWidth));
  const step = period / bins;
  const sum = new Float64Array(bins);
  const count = new Float64Array(bins);
  for (let i = 0; i < profile.length; i++) {
    const bin = Math.min(bins - 1, Math.floor((i % period) / step));
    sum[bin] += profile[i];
    count[bin]++;
  }
  const means = Float64Array.from(sum, (s, b) => (count[b] ? s / count[b] : 0));
  let best = 0;
  let total = 0;
  for (let b = 0; b < bins; b++) {
    total += means[b];
    if (means[b] > means[best]) best = b;
  }
  const mean = total / bins;
  const left = means[(best + bins - 1) % bins];
  const right = means[(best + 1) % bins];
  const offset = parabolicOffset(left, means[best], right);
  let phase = (best + 0.5 + offset) * step;
  if (phase < 0) phase += period;
  if (phase >= period) phase -= period;
  return { phase, contrast: mean > 0 ? means[best] / mean : 0 };
}

/**
 * Measures one axis. `origin` is the sheet coordinate of the profile start. Returns `null` if
 * the profile is empty or has no periodicity (blank sheet, sheet without a grid).
 */
export function measureAxis(profile: Float64Array, origin: number): AxisMeasurement | null {
  const n = profile.length;
  if (n < 32) return null;
  const maxLag = Math.min(140, Math.floor(n / 3));
  const ac = autocorrelation(profile, maxLag);
  if (!ac) return null;
  const fit = fitPeriod(ac, 25);
  if (!fit || fit.period < 2) return null;
  const f1 = fold(profile, fit.period, 0.25);
  const f5 = fold(profile, fit.period * 5, 0.5);
  return {
    period: fit.period,
    phase1: origin + f1.phase,
    phase5: origin + f5.phase,
    contrast1: f1.contrast,
    contrast5: f5.contrast,
    rms: fit.rms,
    peaks: fit.peaks,
  };
}
