/**
 * Generator of synthetic lead signals (500 Hz, `LeadSignal`) with known wave ground truth —
 * a shared test tool of tasks 06–07 for the filter, the beat detector and P/QRS/T delineation.
 *
 * Complex shape (ms from QRS onset `qOn`):
 * - P — a half-sine hump on `[qOn − pq, qOn − pq + pDuration]` (non-zero slope at the edges — P has
 *   sharp onset and end that the tangent method finds exactly);
 * - QRS — straight Q and S limbs with a half-sine R lobe between them: (qOn, 0) → (qOn + 0.2·qrs, −q) →
 *   half-sine to (qOn + 0.5·qrs, +r) → half-sine to (qOn + 0.8·qrs, −s) → (qOn + qrs, 0). The lobe has a smooth
 *   peak (like an R printed by the device), while the limbs are straight with a corner at the baseline: the tangent
 *   method finds Q onset and S end exactly. With q = 0 the lobe starts right at qOn, with s = 0 it ends at qOn + qrs;
 * - ST — baseline from QRS end to T onset;
 * - T — ascending limb as a half-cosine (smooth peak), descending limb is a STRAIGHT line to the baseline,
 *   because per spec the T end is found by the tangent to the descending limb, and for a straight
 *   line the tangent crosses the baseline exactly at the true end. `tOff = qOn + qt`.
 *
 * The device prints the curve with a 35 Hz filter: `smoothHz` (35 by default) smooths the polyline with the same
 * two-pass Butterworth as the device — without it a triangular R has spectrum above 40 Hz, which
 * a printed curve cannot have. The wave ground truth stays ideal (before smoothing).
 *
 * Noise is Gaussian with a deterministic seed; drift is a sinusoid of given frequency and amplitude.
 */
import type { LeadId, LeadSignal, Species, UnreliableSamples } from '../../src/types/contracts';
import { designHighpass, designLowpass, filtfilt } from '../../src/analysis/filter/biquad';

export const SIGNAL_FS = 500;
const SAMPLE_MS = 1000 / SIGNAL_FS;
/**
 * Position of the Q, R, S peaks inside QRS (fractions of duration): Q and S limbs are 0.2 of duration each (10 ms in dogs),
 * the R lobe is symmetric — its peak does not shift under smoothing.
 */
const QRS_Q_FRACTION = 0.2;
const QRS_R_FRACTION = 0.5;
const QRS_S_FRACTION = 0.8;

/** Amplitudes in mV (q and s are depths, positive numbers), durations in ms. */
export interface SyntheticBeatSpec {
  p: number;
  q: number;
  r: number;
  s: number;
  t: number;
  pDurationMs: number;
  /** From P onset to QRS onset. */
  pqMs: number;
  qrsMs: number;
  /** From QRS onset to T end. */
  qtMs: number;
  tDurationMs: number;
}

/** Moderate dog complex: HR 120, QRS 56 ms (upper normal limit for large dogs), PQ 100 ms, QT 200 ms. */
export const DOG_BEAT: SyntheticBeatSpec = {
  p: 0.25,
  q: 0.2,
  r: 1.5,
  s: 0.4,
  t: 0.35,
  pDurationMs: 40,
  pqMs: 100,
  qrsMs: 56,
  qtMs: 200,
  tDurationMs: 100,
};

/** Cat complex: small amplitudes, QRS 40 ms (upper normal limit), PQ 60 ms, QT 140 ms. */
export const CAT_BEAT: SyntheticBeatSpec = {
  p: 0.1,
  q: 0.1,
  r: 0.6,
  s: 0.25,
  t: 0.15,
  pDurationMs: 30,
  pqMs: 60,
  qrsMs: 40,
  qtMs: 140,
  tDurationMs: 70,
};

export const BEAT_PRESETS: Record<Species, SyntheticBeatSpec> = { dog: DOG_BEAT, cat: CAT_BEAT };
/** Preset HR per species, bpm. */
export const HR_PRESETS: Record<Species, number> = { dog: 120, cat: 200 };

export interface SyntheticSignalSpec {
  species: Species;
  /** Signal duration, ms (5000 by default). */
  durationMs?: number;
  /** Constant HR, bpm; ignored if `rrMs` is set. */
  hrBpm?: number;
  /** Explicit RR intervals, ms (arrhythmias); beats start at `firstBeatMs`. */
  rrMs?: number[];
  /** QRS onset of the first beat, ms. */
  firstBeatMs?: number;
  /** Override of the species preset complex shape. */
  beat?: Partial<SyntheticBeatSpec>;
  /** Gaussian noise SD, mV. */
  noiseMv?: number;
  noiseSeed?: number;
  /** Sinusoidal baseline drift. */
  drift?: { hz: number; mv: number };
  /** "Device-like" smoothing cutoff, Hz; 0 — no smoothing (ideal polyline). */
  smoothHz?: number;
  id?: LeadId;
  baselineY?: number;
  confidence?: number;
  unreliable?: UnreliableSamples[];
}

/** True wave moments of a beat, ms; P absent (`p = 0`) — `null`. */
export interface SyntheticBeatTruth {
  /** The whole complex (P…T) is inside the signal; `false` — only QRS is inside (edge beat: the detector counts it, P/T delineation is incomplete). */
  complete: boolean;
  pOn: number | null;
  pPeak: number | null;
  pOff: number | null;
  qOn: number;
  rPeak: number;
  sPeak: number | null;
  sOff: number;
  tOn: number;
  tPeak: number;
  tOff: number;
}

export interface SyntheticSignal {
  signal: LeadSignal;
  beats: SyntheticBeatTruth[];
  beat: SyntheticBeatSpec;
  /** Clean signal without noise and drift (but smoothed) — for comparing amplitudes after the filter. */
  clean: Float32Array;
}

/** Deterministic Gaussian noise (LCG + Box–Muller). */
export function gaussianNoise(n: number, sigma: number, seed = 1): Float32Array {
  const out = new Float32Array(n);
  if (sigma <= 0) return out;
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  for (let i = 0; i < n; i += 2) {
    const u1 = next();
    const u2 = next();
    const mag = sigma * Math.sqrt(-2 * Math.log(u1));
    out[i] = mag * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = mag * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

/** Value of a single complex at moment `t` (ms) with QRS onset at `qOn`. */
function beatValue(t: number, qOn: number, b: SyntheticBeatSpec): number {
  const u = t - qOn;
  // P: half-sine.
  if (b.p > 0) {
    const pOn = -b.pqMs;
    if (u >= pOn && u <= pOn + b.pDurationMs) return b.p * Math.sin((Math.PI * (u - pOn)) / b.pDurationMs);
  }
  // QRS: straight Q and S limbs, half-sine R lobe.
  if (u >= 0 && u <= b.qrsMs) {
    const t1 = b.q > 0 ? QRS_Q_FRACTION * b.qrsMs : 0;
    const t2 = QRS_R_FRACTION * b.qrsMs;
    const t3 = b.s > 0 ? QRS_S_FRACTION * b.qrsMs : b.qrsMs;
    if (u < t1) return -b.q * (u / t1);
    if (u <= t2) return -b.q + (b.r + b.q) * Math.sin((Math.PI / 2) * ((u - t1) / (t2 - t1)));
    if (u <= t3) return -b.s + (b.r + b.s) * Math.sin((Math.PI / 2) * (1 - (u - t2) / (t3 - t2)));
    return -b.s * (1 - (u - t3) / (b.qrsMs - t3));
  }
  // T: half-cosine rise, straight descent.
  const tOff = b.qtMs;
  const tOn = tOff - b.tDurationMs;
  const tPeak = tOn + 0.6 * b.tDurationMs;
  if (u >= tOn && u <= tPeak) return b.t * 0.5 * (1 - Math.cos((Math.PI * (u - tOn)) / (tPeak - tOn)));
  if (u > tPeak && u <= tOff) return b.t * (1 - (u - tPeak) / (tOff - tPeak));
  return 0;
}

function truthOf(qOn: number, b: SyntheticBeatSpec, durationMs: number): SyntheticBeatTruth {
  const tOff = qOn + b.qtMs;
  const tOn = tOff - b.tDurationMs;
  return {
    complete: (b.p > 0 ? qOn - b.pqMs : qOn) >= 0 && tOff <= durationMs,
    pOn: b.p > 0 ? qOn - b.pqMs : null,
    pPeak: b.p > 0 ? qOn - b.pqMs + b.pDurationMs / 2 : null,
    pOff: b.p > 0 ? qOn - b.pqMs + b.pDurationMs : null,
    qOn,
    rPeak: qOn + QRS_R_FRACTION * b.qrsMs,
    sPeak: b.s > 0 ? qOn + QRS_S_FRACTION * b.qrsMs : null,
    sOff: qOn + b.qrsMs,
    tOn,
    tPeak: tOn + 0.6 * b.tDurationMs,
    tOff,
  };
}

/** "Device-like" smoothing: two-pass 2nd-order Butterworth, zero phase. */
function smooth(x: Float32Array, hz: number): Float32Array {
  if (hz <= 0) return x;
  return filtfilt(x, designLowpass(hz, SIGNAL_FS));
}

export function renderSignal(spec: SyntheticSignalSpec): SyntheticSignal {
  const beat: SyntheticBeatSpec = { ...BEAT_PRESETS[spec.species], ...(spec.beat ?? {}) };
  const durationMs = spec.durationMs ?? 5000;
  const n = Math.round(durationMs / SAMPLE_MS);
  const hr = spec.hrBpm ?? HR_PRESETS[spec.species];
  const firstBeat = spec.firstBeatMs ?? 400;
  const smoothHz = spec.smoothHz ?? 35;

  // QRS onset moments: from the RR list or with a constant period up to the signal end.
  const onsets: number[] = [];
  if (spec.rrMs) {
    let t = firstBeat;
    onsets.push(t);
    for (const rr of spec.rrMs) {
      t += rr;
      onsets.push(t);
    }
  } else {
    const rr = 60000 / hr;
    for (let t = firstBeat; t < durationMs + beat.pqMs; t += rr) onsets.push(t);
  }

  const clean = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i * SAMPLE_MS;
    let v = 0;
    for (const qOn of onsets) v += beatValue(t, qOn, beat);
    clean[i] = v;
  }
  const smoothed = smooth(clean, smoothHz);

  const noise = gaussianNoise(n, spec.noiseMv ?? 0, spec.noiseSeed ?? 1);
  const mv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i * SAMPLE_MS;
    const drift = spec.drift ? spec.drift.mv * Math.sin(2 * Math.PI * spec.drift.hz * (t / 1000)) : 0;
    mv[i] = smoothed[i] + noise[i] + drift;
  }

  // Ground truth — complexes whose QRS is entirely inside the signal (as the detector counts); `complete` — P and T inside too.
  const beats = onsets.map((qOn) => truthOf(qOn, beat, durationMs)).filter((b) => b.qOn >= 0 && b.sOff <= durationMs);

  const signal: LeadSignal = {
    id: spec.id ?? 'II',
    fs: 500,
    t0: 0,
    mv,
    baselineY: spec.baselineY ?? 200,
    confidence: spec.confidence ?? 1,
    unreliable: spec.unreliable ?? [],
  };
  return { signal, beats, beat, clean: smoothed };
}

/** Drift removal by HPF — a helper for tests that need a clean reference. */
export function removeDrift(x: Float32Array, hz: number): Float32Array {
  return filtfilt(x, designHighpass(hz, SIGNAL_FS));
}

/** Per-lead complex scale and sign — for six synchronous signals of one "heart". */
export const SIX_LEAD_SCALES: Record<LeadId, number> = { I: 0.6, II: 1, III: 0.7, aVR: -0.8, aVL: 0.3, aVF: 0.85 };

/**
 * Six synchronous leads of one rhythm: amplitudes scaled by `scales`, shared time.
 * Each lead has its own noise seed.
 */
export function renderSixLeads(spec: Omit<SyntheticSignalSpec, 'id'>, scales: Partial<Record<LeadId, number>> = {}): {
  signals: LeadSignal[];
  beats: SyntheticBeatTruth[];
} {
  const ids: LeadId[] = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF'];
  const base = BEAT_PRESETS[spec.species];
  const common = { ...base, ...(spec.beat ?? {}) };
  let beats: SyntheticBeatTruth[] = [];
  const signals = ids.map((id, k) => {
    const scale = scales[id] ?? SIX_LEAD_SCALES[id];
    const sign = Math.sign(scale) || 1;
    const mag = Math.abs(scale);
    // A negative scale flips the complex: R becomes a deep S and vice versa.
    const beat: SyntheticBeatSpec =
      sign > 0
        ? { ...common, p: common.p * mag, q: common.q * mag, r: common.r * mag, s: common.s * mag, t: common.t * mag }
        : { ...common, p: common.p * mag, q: 0, r: common.s * mag, s: common.r * mag, t: -common.t * mag };
    const rendered = renderSignal({ ...spec, id, beat, noiseSeed: (spec.noiseSeed ?? 1) + k });
    if (id === 'II') beats = rendered.beats;
    return rendered.signal;
  });
  return { signals, beats };
}
