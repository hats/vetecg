/**
 * Merging beats of several sheets into one array and reliability gates — the shared foundation of `measure` and `rhythm`.
 *
 * Merged array: sheets in `pages` order, within a sheet — by time; an element's `index` is the global index that goes
 * into `MeasuredValue.beats`, `Ectopic.beat`, `Episode.beats`; `page`/`beatIndex` — the reverse mapping for the
 * overlay. Time is on the case time scale (`offsetMs + tMs`). RR is computed only within a sheet: the detector does
 * not count edge complexes, and an interval across a sheet junction almost always spans a missed beat (a false "pause").
 *
 * Two gates (task 06 review condition): wave measurements take only reliable beats (confidence ≥ `UNRELIABLE_BELOW`,
 * without `hr_implausible` / `printed_hr_mismatch` / `printed_hr_unverified`) with a reliable II delineation; the
 * arrhythmia count and HR use all detected beats — otherwise a 363 bpm extrasystole flagged `hr_implausible` (> 320)
 * would vanish from the count, while the device printed it.
 *
 * Prematurity (ARRHYTHM-01): RR to the previous beat < (1 − `thresholds.prematurity.fraction`) × the median of all RR
 * of the case; the threshold comes only from `getNorms`.
 */
import {
  UNRELIABLE_BELOW,
  type Beat,
  type Delineation,
  type LeadId,
  type LeadSignal,
  type PageBeats,
  type PagePrecision,
  type RhythmThresholds,
  type Species,
} from '../../types/contracts';
import { getNorms } from '../norms';
import { mean, median, std } from './stats';

export interface MergedBeat {
  /** Global index in the merged array. */
  index: number;
  /** Sheet number (`PageBeats.page`) and its position in the input array. */
  page: number;
  pageIndex: number;
  /** Beat index within the sheet (`Beat.index`). */
  beatIndex: number;
  beat: Beat;
  delineation?: Delineation;
  /** Beat time (lead consensus) on the case time scale, ms. */
  tMs: number;
  /** R peak in II on the case time scale, ms — when the sheet's II is reliable and the beat has a position in II. */
  tIIMs?: number;
  /** RR to the previous beat of the same sheet, by consensus and by II; absent for the sheet's first beat. */
  rrPrevMs?: number;
  rrPrevIIMs?: number;
  signals: LeadSignal[];
  precision?: PagePrecision;
  /** The sheet has II with confidence ≥ `UNRELIABLE_BELOW` and samples. */
  leadIIReliable: boolean;
}

/** Beat reasons that exclude it from wave measurements (printed-HR cross-check, implausible interval). */
export const MEASUREMENT_EXCLUDING_REASONS: ReadonlySet<string> = new Set(['hr_implausible', 'printed_hr_mismatch', 'printed_hr_unverified']);

/** Fewer RR than this — the RR median is undefined, prematurity is not assessed. */
export const MIN_RR_FOR_PREMATURITY = 3;

/** The lead signal, if it is present on the sheet, non-empty and reliable. */
export function reliableLead(signals: readonly LeadSignal[], id: LeadId): LeadSignal | undefined {
  const s = signals.find((x) => x.id === id);
  return s && s.mv.length > 0 && s.confidence >= UNRELIABLE_BELOW ? s : undefined;
}

export function mergeBeats(pages: readonly PageBeats[]): MergedBeat[] {
  const out: MergedBeat[] = [];
  pages.forEach((p, pageIndex) => {
    const ii = reliableLead(p.signals, 'II');
    const order = p.beats.map((_, k) => k).sort((a, b) => p.beats[a].tMs - p.beats[b].tMs);
    let prev: MergedBeat | undefined;
    for (const k of order) {
      const beat = p.beats[k];
      const iiInfo = ii && !beat.reasons.includes('lead_ii_unreliable') ? beat.perLead.II : undefined;
      const m: MergedBeat = {
        index: out.length,
        page: p.page,
        pageIndex,
        beatIndex: beat.index,
        beat,
        delineation: p.delineations[k],
        tMs: p.offsetMs + beat.tMs,
        tIIMs: iiInfo ? p.offsetMs + iiInfo.tMs : undefined,
        signals: p.signals,
        precision: p.precision,
        leadIIReliable: !!ii,
      };
      if (prev) {
        m.rrPrevMs = m.tMs - prev.tMs;
        if (m.tIIMs !== undefined && prev.tIIMs !== undefined) m.rrPrevIIMs = m.tIIMs - prev.tIIMs;
      }
      out.push(m);
      prev = m;
    }
  });
  return out;
}

/** The beat is reliable enough for wave measurements. */
export function beatReliable(m: MergedBeat): boolean {
  return m.beat.confidence >= UNRELIABLE_BELOW && !m.beat.reasons.some((r) => MEASUREMENT_EXCLUDING_REASONS.has(r));
}

export type UsableDelineation = Delineation & { qOn: number; sOff: number };

/** The beat's II delineation is usable: II reliable, QRS found, confidence ≥ threshold, waves not within clipped/gap. */
export function delineationUsable(m: MergedBeat): m is MergedBeat & { delineation: UsableDelineation } {
  const d = m.delineation;
  return (
    m.leadIIReliable &&
    m.tIIMs !== undefined &&
    !!d &&
    d.qOn !== null &&
    d.sOff !== null &&
    d.confidence >= UNRELIABLE_BELOW &&
    !(d.reasons ?? []).includes('unreliable_segment')
  );
}

/** Median RR of the case (all RR within sheets), ms; fewer than `MIN_RR_FOR_PREMATURITY` intervals — `undefined`. */
export function medianRr(merged: readonly MergedBeat[]): number | undefined {
  const rr = merged.map((m) => m.rrPrevMs).filter((v): v is number => v !== undefined);
  return rr.length >= MIN_RR_FOR_PREMATURITY ? median(rr) : undefined;
}

/** RR spread: coefficient of variation and the largest difference of adjacent RR (ms) over intervals not marked by `exclude`. */
export function rrVariation(merged: readonly MergedBeat[], exclude: readonly boolean[]): { cv: number; maxDeltaMs: number; count: number } {
  const rr: number[] = [];
  let maxDeltaMs = 0;
  let prevRr: number | undefined;
  merged.forEach((m, i) => {
    const prev = merged[i - 1];
    // Interval (i−1, i) is counted if neither of its ends is excluded; adjacent RR difference — for two consecutive counted ones.
    if (m.rrPrevMs === undefined || exclude[i] || (prev && exclude[i - 1])) {
      prevRr = undefined;
      return;
    }
    rr.push(m.rrPrevMs);
    if (prevRr !== undefined) maxDeltaMs = Math.max(maxDeltaMs, Math.abs(m.rrPrevMs - prevRr));
    prevRr = m.rrPrevMs;
  });
  const avg = mean(rr);
  return { cv: avg > 0 ? std(rr) / avg : 0, maxDeltaMs, count: rr.length };
}

/** Sinus arrhythmia by RR spread (decisions §4): variation above the fraction or adjacent RR differ by at least `rrDeltaS`. */
export function sinusArrhythmiaByRr(variation: { cv: number; maxDeltaMs: number }, thresholds: RhythmThresholds['sinusArrhythmia']): boolean {
  return variation.cv > thresholds.rrVariation || variation.maxDeltaMs >= thresholds.rrDeltaS * 1000;
}

/** PQ constancy tolerance: fraction of the median (AXIS-02 — "constant PQ, spread ≤ 20 %"). */
export const PQ_STABLE_FRACTION = 0.2;

/**
 * Prematurity flag of each beat (ARRHYTHM-01): RR to the previous one shorter than (1 − threshold) × the case median RR.
 *
 * Sinus arrhythmia correction: when the remaining RR (not adjacent to candidates) themselves show sinus arrhythmia
 * by the reference thresholds, a premature beat with a found P and PQ within ±20 % of the median PQ of sinus complexes
 * is part of respiratory arrhythmia, not an extrasystole (reference: sinus arrhythmia — "P before every QRS with a stable
 * PR"). Otherwise on `b-01` (17-56-13, dog, HR 58–110) RR 654 and 544 ms with a median of 834 would become two SVEs,
 * although they have P and PQ 86/77 ms with a median of 80. The correction does not touch the real extrasystoles of
 * the fixtures: on `a-02` no P is found before them, on `a-08` PQ is 120 ms with a median of 74 (P′) and there is no
 * arrhythmia in the remaining RR (CV 0.05).
 */
export function prematureFlags(merged: readonly MergedBeat[], species: Species): boolean[] {
  const med = medianRr(merged);
  if (med === undefined) return merged.map(() => false);
  // `getNorms` always fills `thresholds` (interfaces.md, task 08).
  const thresholds = getNorms(species).thresholds!;
  const limit = 1 - thresholds.prematurity.fraction;
  const candidates = merged.map((m) => m.rrPrevMs !== undefined && m.rrPrevMs < limit * med);
  if (!candidates.some(Boolean) || !sinusArrhythmiaByRr(rrVariation(merged, candidates), thresholds.sinusArrhythmia)) return candidates;
  const pqOf = (m: MergedBeat): number | undefined =>
    delineationUsable(m) && m.delineation.pFound && m.delineation.pOn !== null ? m.delineation.qOn - m.delineation.pOn : undefined;
  const pqRef = merged.map((m, i) => (candidates[i] ? undefined : pqOf(m))).filter((v): v is number => v !== undefined);
  if (pqRef.length === 0) return candidates;
  const pqMed = median(pqRef);
  return candidates.map((c, i) => {
    if (!c) return false;
    const pq = pqOf(merged[i]);
    return pq === undefined || Math.abs(pq - pqMed) > PQ_STABLE_FRACTION * pqMed;
  });
}

/** Time neighbor within the same sheet. */
function sameSheetNeighbour(merged: readonly MergedBeat[], i: number, step: -1 | 1): MergedBeat | undefined {
  const n = merged[i + step];
  return n && n.pageIndex === merged[i].pageIndex ? n : undefined;
}

/**
 * "Best" complexes for measurement medians (specification 40–49): reliable beats with a usable II delineation,
 * not ectopic and not adjacent to ectopic ones (their T is covered by the extrasystole, and a pause follows it).
 */
export function measurementBeats(merged: readonly MergedBeat[], premature: readonly boolean[]): (MergedBeat & { delineation: UsableDelineation })[] {
  const out: (MergedBeat & { delineation: UsableDelineation })[] = [];
  merged.forEach((m, i) => {
    if (!beatReliable(m) || !delineationUsable(m) || premature[i]) return;
    const before = sameSheetNeighbour(merged, i, -1);
    const after = sameSheetNeighbour(merged, i, 1);
    if ((before && premature[before.index]) || (after && premature[after.index])) return;
    out.push(m);
  });
  return out;
}
