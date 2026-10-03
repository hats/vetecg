/**
 * `measure` module: clinical numbers from lead II (stories 40–49, MEAS-01…10) — median over the "best" sinus
 * complexes of all sheets; HR — mean, minimum and maximum over all RR.
 *
 * Input — sheet beats (`PageBeats[]`, see `merge.ts`); the contract `measure(beats, delineations, signals, species)` —
 * a single sheet without offset. Each value is `{value, unit, confidence, beats, reason?, source?}`: intervals in
 * seconds, amplitudes in mV relative to the baseline (Q and S negative, T and ST signed), HR in bpm.
 *
 * HR: RR by R peaks in II (`perLead.II.tMs`) when the sheet's II is reliable; otherwise by the lead consensus `tMs` with
 * `source: 'all_leads'` (task 06 review). Mean — 60000 / mean RR (this agrees with the HR in the device footer:
 * the mean of instantaneous HR is inflated by pauses and extrasystoles). All RR take part; confidence is the mean over
 * beats, so beats with `hr_implausible` / `printed_hr_*` lower it to "unreliable" without vanishing from the range.
 *
 * Waves — only from reliable beats with a usable II delineation, not ectopic and not adjacent to them (`measurementBeats`).
 * Amplitudes — from raw II without filters: the low-pass cuts R by up to 2 % and a sharp P by 6 %, and the 0.5 Hz
 * high-pass drags a ~300 ms tail from saturated spans. Drift is removed by a local baseline: the PQ segment level
 * (16…4 ms before the QRS onset, as in `delineate`) for P, Q, R, S; for T and ST — linear interpolation between the PQ
 * segments of this and the next complex (drift over one RR is linear). If the physician moved the sheet's II baseline
 * (`options.baselineShiftMv`, story 20), the reference level shifts by the line's offset from the drawn one: at its place — the automatic numbers. A wave below the sheet's 2 px threshold is "not expressed": Q, S (and R for QS) = 0 with a `reason` mark.
 *
 * Durations compensate for QRS widening on the printed curve (35 Hz printing + our low-pass): the Q onset is shifted
 * forward by `onsetMs`, the S end backward by `offsetMs` — both for QRS and for PQ/QT, which rely on the QRS onset
 * (`PRINT_WIDENING`, measured on a synthetic model of the device path; `options.printWidening` overrides, 0/0 — ideal
 * signal). ST — deviation at J + 60 ms (dog) / J + 40 ms (cat) from the baseline (MEAS-10). QTc — Van de Water
 * (QT − 0.087·(RR − 1)) for dogs only; cats have no standard — `species_not_applicable`.
 */
import type { Beat, Delineation, LeadSignal, MeasuredValue, MeasurementKey, Measurements, PageBeats, Species } from '../../types/contracts';
import { beatReliable, delineationUsable, measurementBeats, mergeBeats, prematureFlags, type MergedBeat, type UsableDelineation } from './merge';
import { argExtreme, clamp01, mean, median, medianOf } from './stats';

export {
  beatReliable,
  delineationUsable,
  measurementBeats,
  medianRr,
  mergeBeats,
  prematureFlags,
  reliableLead,
  rrVariation,
  sinusArrhythmiaByRr,
  MEASUREMENT_EXCLUDING_REASONS,
  MIN_RR_FOR_PREMATURITY,
  PQ_STABLE_FRACTION,
} from './merge';
export type { MergedBeat, UsableDelineation } from './merge';
export { median, mean, std, medianOf, argExtreme, pearson, clamp01 } from './stats';

export interface PrintWidening {
  /** The printed QRS onset is this many ms earlier than the true one. */
  onsetMs: number;
  /** The printed QRS end is this many ms later than the true one. */
  offsetMs: number;
}

/**
 * QRS widening on the printed curve per species (data, not branches): the device's 35 Hz printing plus the 40/60 Hz
 * low-pass blur the corners, and the limb tangents move outward. Task 07 measurement on a synthetic device path
 * (`renderSixLeads` with 35 Hz smoothing → `filterSignal` → `delineate`, noise 0 and 0.004 mV): median QRS onset/end
 * errors dog −9.3 / +7.7 ms, cat −12.0 / +9.8 ms (task 06 on its own set: −10 / +8.5 and −13 / +10).
 * Not calibrated by manual measurement on real sheets — calibrated on the print model.
 */
export const PRINT_WIDENING: Record<Species, PrintWidening> = {
  dog: { onsetMs: 9.3, offsetMs: 7.7 },
  cat: { onsetMs: 12, offsetMs: 9.8 },
};

/** ST evaluation point after the J point per species, ms (specification MEAS-10: J + 60 dog, J + 40 cat). */
export const ST_POINT_AFTER_J_MS: Record<Species, number> = { dog: 60, cat: 40 };

/** Van de Water correction slope: QTc = QT − 0.087·(RR − 1), seconds (norms reference, row `qtc`). */
export const QTC_VAN_DE_WATER_SLOPE = 0.087;

/** PQ segment for the baseline: this many ms before the QRS onset (as `PQ_LEVEL_MS` in `delineate`). */
const PQ_LEVEL_MS: [number, number] = [16, 4];
/** "Wave not expressed" threshold: 2 px of the sheet grid; default — variant A, 50 mm/s, 10 mm/mV. */
const GRID_PX_THRESHOLD = 2;
const DEFAULT_MV_PER_PX = 1 / (4.305 * 10);

const UNIT: Record<MeasurementKey, string> = {
  hrMean: 'уд/мин',
  hrMin: 'уд/мин',
  hrMax: 'уд/мин',
  pDuration: 'с',
  pAmplitude: 'мВ',
  pq: 'с',
  q: 'мВ',
  qrs: 'с',
  r: 'мВ',
  s: 'мВ',
  qt: 'с',
  qtc: 'с',
  t: 'мВ',
  st: 'мВ',
};

const WAVE_KEYS: readonly MeasurementKey[] = ['pDuration', 'pAmplitude', 'pq', 'q', 'qrs', 'r', 's', 'qt', 'qtc', 't', 'st'];

export interface MeasureOptions {
  /** Compensation of print QRS widening; defaults to `PRINT_WIDENING[species]`. */
  printWidening?: PrintWidening;
  /**
   * Manual II baseline shift per sheet (`PageBeats.page` → mV, `baseline` edit, story 20): how many mV the sheet's II
   * signal is higher than from the automatic (drawn) baseline — (manual y − automatic y) × mV/px. The reference
   * level for P, Q, R, S, T and ST amplitudes = the former local PQ level lowered by this shift: line at the drawn
   * one's place — the automatic numbers; line N px lower — amplitudes N px higher.
   */
  baselineShiftMv?: Readonly<Record<number, number>>;
}

type Selected = MergedBeat & { delineation: UsableDelineation };

function unavailable(key: MeasurementKey, reason: string): MeasuredValue {
  return { value: null, unit: UNIT[key], confidence: 0, beats: [], reason };
}

/** One measurement of one complex; `reason` — a mark on the value ("not expressed"). */
interface Sample {
  value: number;
  beat: number;
  confidence: number;
  reason?: string;
}

function aggregate(key: MeasurementKey, samples: Sample[], emptyReason: string): MeasuredValue {
  if (samples.length === 0) return unavailable(key, emptyReason);
  const out: MeasuredValue = {
    value: median(samples.map((s) => s.value)),
    unit: UNIT[key],
    confidence: clamp01(mean(samples.map((s) => s.confidence))),
    beats: samples.map((s) => s.beat),
  };
  // The mark is set if the majority of complexes have it (e.g. Q not expressed in any).
  const marked = samples.filter((s) => s.reason);
  if (marked.length * 2 > samples.length) out.reason = marked[0].reason;
  return out;
}

function inUnreliable(signal: LeadSignal, idx: number): boolean {
  return signal.unreliable.some((u) => u.kind !== 'ambiguous' && idx >= u.i0 && idx <= u.i1);
}

/** Complex baseline: median of the raw signal's PQ segment and the sample it refers to. */
function pqLevel(mv: Float32Array, qOnIdx: number, idx: (ms: number) => number): { level: number; at: number } {
  const a = qOnIdx - idx(PQ_LEVEL_MS[0]);
  const b = qOnIdx - idx(PQ_LEVEL_MS[1]);
  return { level: medianOf(mv, a, b) ?? mv[Math.max(0, qOnIdx)], at: (a + b) / 2 };
}

/** Values of one complex from raw II; `next` — the sheet's next complex with a usable delineation (for the T/ST baseline). */
function sampleBeat(
  m: Selected,
  raw: LeadSignal,
  next: Selected | undefined,
  species: Species,
  widening: PrintWidening,
  shiftMv: number,
): Partial<Record<MeasurementKey, Sample>> {
  const d = m.delineation;
  const mv = raw.mv;
  const n = mv.length;
  const sampleMs = 1000 / raw.fs;
  const idx = (ms: number): number => Math.round(ms / sampleMs);
  const qOnIdx = Math.max(0, idx(d.qOn));
  const sOffIdx = Math.min(n - 1, idx(d.sOff));
  if (sOffIdx <= qOnIdx) return {};
  const confidence = clamp01(m.beat.confidence * d.confidence);
  const sample = (value: number, reason?: string): Sample => (reason ? { value, beat: m.index, confidence, reason } : { value, beat: m.index, confidence });
  const out: Partial<Record<MeasurementKey, Sample>> = {};

  // The physician's manual baseline shifts the reference level: the signal is digitized from it and raised by `shiftMv`
  // relative to the automatic one, the PQ level too; subtracting the shift restores the former level, and amplitudes change by exactly the shift.
  const shifted = (b: { level: number; at: number }): { level: number; at: number } => ({ level: b.level - shiftMv, at: b.at });
  const base = shifted(pqLevel(mv, qOnIdx, idx));
  const nextBase = next ? shifted(pqLevel(mv, Math.max(0, idx(next.delineation.qOn)), idx)) : undefined;
  /** Baseline at an arbitrary sample: linear drift between the PQ segments of this and the next complex. */
  const baseAt = (i: number): number => {
    if (!nextBase || nextBase.at <= base.at) return base.level;
    const w = Math.max(0, Math.min(1, (i - base.at) / (nextBase.at - base.at)));
    return base.level + w * (nextBase.level - base.level);
  };
  const mvPerPx = m.precision && m.precision.mvPerPx > 0 ? m.precision.mvPerPx : DEFAULT_MV_PER_PX;
  const threshold = GRID_PX_THRESHOLD * mvPerPx;

  // QRS amplitudes: R — maximum within the QRS, Q — minimum before R, S — minimum after R; below 2 px — "not expressed".
  const rIdx = argExtreme(mv, qOnIdx, sOffIdx, (v) => v);
  const rAmp = mv[rIdx] - base.level;
  out.r = rAmp >= threshold ? sample(rAmp) : sample(0, 'r_absent');
  const qDepth = base.level - mv[argExtreme(mv, qOnIdx, rIdx, (v) => -v)];
  out.q = qDepth >= threshold ? sample(-qDepth) : sample(0, 'q_absent');
  const sDepth = base.level - mv[argExtreme(mv, rIdx, sOffIdx, (v) => -v)];
  out.s = sDepth >= threshold ? sample(-sDepth) : sample(0, 's_absent');

  // Durations with print compensation: QRS onset forward, end backward.
  const qOnTrue = d.qOn + widening.onsetMs;
  const sOffTrue = d.sOff - widening.offsetMs;
  out.qrs = sample(Math.max(0, sOffTrue - qOnTrue) / 1000);
  if (d.pFound && d.pOn !== null && d.pOff !== null) {
    out.pDuration = sample((d.pOff - d.pOn) / 1000);
    out.pq = sample(Math.max(0, qOnTrue - d.pOn) / 1000);
    const pA = Math.max(0, idx(d.pOn));
    const pB = Math.min(n - 1, idx(d.pOff));
    if (pB > pA) {
      const pIdx = argExtreme(mv, pA, pB, (v) => Math.abs(v - base.level));
      out.pAmplitude = sample(mv[pIdx] - base.level);
    }
  }
  if (d.tOff !== null) {
    const qt = (d.tOff - qOnTrue) / 1000;
    out.qt = sample(qt);
    const rr = m.rrPrevIIMs ?? m.rrPrevMs;
    if (species === 'dog' && rr !== undefined) out.qtc = sample(qt - QTC_VAN_DE_WATER_SLOPE * (rr / 1000 - 1));
  }
  if (d.tPeak !== null) {
    const tIdx = Math.min(n - 1, Math.max(0, idx(d.tPeak)));
    out.t = sample(mv[tIdx] - baseAt(tIdx));
  }
  const jIdx = idx(sOffTrue + ST_POINT_AFTER_J_MS[species]);
  if (jIdx > sOffIdx && jIdx < n && !inUnreliable(raw, jIdx)) out.st = sample(mv[jIdx] - baseAt(jIdx));
  return out;
}

/** Reason why no complex was found for the waves. */
function waveEmptyReason(merged: MergedBeat[]): string {
  if (merged.length === 0) return 'no_beats';
  if (!merged.some((m) => m.leadIIReliable)) return 'lead_ii_unreliable';
  const reliable = merged.filter(beatReliable);
  if (reliable.length === 0 || !reliable.some(delineationUsable)) return 'low_confidence';
  return 'too_few_beats';
}

function heartRate(merged: MergedBeat[]): Pick<Measurements, 'hrMean' | 'hrMin' | 'hrMax'> {
  interface Rr {
    ms: number;
    beats: [number, number];
    confidence: number;
    byII: boolean;
  }
  const rr: Rr[] = [];
  merged.forEach((m, i) => {
    if (m.rrPrevMs === undefined) return;
    const prev = merged[i - 1];
    const byII = m.rrPrevIIMs !== undefined;
    rr.push({ ms: byII ? m.rrPrevIIMs! : m.rrPrevMs, beats: [prev.index, m.index], confidence: (prev.beat.confidence + m.beat.confidence) / 2, byII });
  });
  if (rr.length === 0) {
    const reason = merged.length === 0 ? 'no_beats' : 'too_few_beats';
    return { hrMean: unavailable('hrMean', reason), hrMin: unavailable('hrMin', reason), hrMax: unavailable('hrMax', reason) };
  }
  const source = rr.every((x) => x.byII) ? 'lead_ii' : 'all_leads';
  const longest = rr.reduce((a, b) => (b.ms > a.ms ? b : a));
  const shortest = rr.reduce((a, b) => (b.ms < a.ms ? b : a));
  const participants = [...new Set(rr.flatMap((x) => x.beats))].sort((a, b) => a - b);
  return {
    hrMean: {
      value: 60000 / mean(rr.map((x) => x.ms)),
      unit: UNIT.hrMean,
      confidence: clamp01(mean(rr.map((x) => x.confidence))),
      beats: participants,
      source,
    },
    hrMin: { value: 60000 / longest.ms, unit: UNIT.hrMin, confidence: clamp01(longest.confidence), beats: [...longest.beats], source },
    hrMax: { value: 60000 / shortest.ms, unit: UNIT.hrMax, confidence: clamp01(shortest.confidence), beats: [...shortest.beats], source },
  };
}

export function measurePages(pages: readonly PageBeats[], species: Species, options: MeasureOptions = {}): Measurements {
  const widening = options.printWidening ?? PRINT_WIDENING[species];
  const merged = mergeBeats(pages);
  const hr = heartRate(merged);
  if (pages.length === 0) {
    const out = { ...hr } as Measurements;
    for (const key of Object.keys(UNIT) as MeasurementKey[]) out[key] = unavailable(key, 'no_pages');
    return out;
  }

  const premature = prematureFlags(merged, species);
  const selected = measurementBeats(merged, premature);
  const shifts = options.baselineShiftMv ?? {};
  const samples = new Map<MeasurementKey, Sample[]>(WAVE_KEYS.map((k) => [k, []]));
  selected.forEach((m, k) => {
    const raw = m.signals.find((s) => s.id === 'II');
    if (!raw) return;
    // The next complex of the same sheet with a usable delineation — the anchor of linear drift for T and ST.
    const next = selected[k + 1];
    const values = sampleBeat(m, raw, next && next.pageIndex === m.pageIndex ? next : undefined, species, widening, shifts[m.page] ?? 0);
    for (const key of WAVE_KEYS) {
      const s = values[key];
      if (s) samples.get(key)!.push(s);
    }
  });

  const emptyReason = waveEmptyReason(merged);
  const noComplex = selected.length === 0;
  const reasonFor = (key: MeasurementKey): string => {
    if (noComplex) return emptyReason;
    if (key === 'pDuration' || key === 'pAmplitude' || key === 'pq') return 'p_not_found';
    if (key === 'qt' || key === 'qtc' || key === 't') return 't_not_found';
    return 'low_confidence';
  };
  const out = { ...hr } as Measurements;
  for (const key of WAVE_KEYS) out[key] = aggregate(key, samples.get(key)!, reasonFor(key));
  if (species === 'cat') out.qtc = unavailable('qtc', 'species_not_applicable');
  return out;
}

/** Contract form: beats of a single sheet without time offset. */
export function measure(beats: Beat[], delineations: Delineation[], signals: LeadSignal[], species: Species, options: MeasureOptions = {}): Measurements {
  return measurePages([{ page: 0, offsetMs: 0, beats, delineations, signals }], species, options);
}
