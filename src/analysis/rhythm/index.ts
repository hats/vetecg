/**
 * `rhythm` module: rhythm type, species-specific interpretation of sinus arrhythmia, electrical axis, extrasystoles and
 * episodes (stories 50–58). Input — sheet beats (`PageBeats[]`), the contract `analyzeRhythm(beats, delineations, signals,
 * species, pagesSpanMs)` — a single sheet without offset. Shared foundation with `measure`: sheet merging and
 * reliability gates (`mergeBeats`, `prematureFlags`, `measurementBeats`).
 *
 * Rhythm type (AXIS-02): over non-ectopic beats with usable II delineation where P could be assessed
 * (`p-wave.ts`) — "sinus" if P precedes ≥ 90 % of complexes and PQ is constant (≥ 90 % within tolerance: 20 % of
 * the median, but not less than the sheet's precision ceiling — 4 px); otherwise "non-sinus" with reasons `p_not_found`
 * (no P in any) / `p_not_all:<with P>/<assessed>` (P in some complexes) / `pq_unstable`, and there must be at least two deviant complexes. Fewer than three usable beats —
 * "undetermined" (`lead_ii_unreliable` without a reliable II, `no_beats`, `too_few_beats`, `p_not_found` — P hidden
 * in T during tachycardia); HR and the arrhythmia count are still computed from the other leads.
 *
 * Sinus arrhythmia (AXIS-03) — only with sinus rhythm: the RR spread between sinus beats (intervals adjacent to
 * extrasystoles excluded) exceeds the reference thresholds `thresholds.sinusArrhythmia`; the species interpretation
 * is given by `compose`. Axis — `axis.ts`, extrasystoles — `ectopics.ts`, episodes — `episodes.ts`.
 */
import type { Beat, Delineation, LeadSignal, PageBeats, Pause, RhythmReport, RhythmType, Species } from '../../types/contracts';
import {
  delineationUsable,
  median,
  mergeBeats,
  prematureFlags,
  rrVariation,
  sinusArrhythmiaByRr,
  PQ_STABLE_FRACTION,
  PRINT_WIDENING,
  type MergedBeat,
  type PrintWidening,
} from '../measure';
import { getNorms } from '../norms';
import { computeAxis } from './axis';
import { classifyEctopics } from './ectopics';
import { findEpisodes } from './episodes';
import { pAssessed } from './p-wave';

export { computeAxis, fallbackHalfMs } from './axis';
export { pAssessed, pAbsent, P_NOT_ASSESSABLE_REASONS } from './p-wave';
export type { AxisResult } from './axis';
export { classifyEctopics, MORPHOLOGY_SAME_MIN } from './ectopics';
export { findEpisodes, MIN_EPISODE_BEATS } from './episodes';
export { qrsWindowOf, netArea, leadArea } from './qrs-area';

/** Minimum delineated sinus beats to judge the rhythm type. */
export const MIN_RHYTHM_BEATS = 3;
/** Share of complexes with P (and with stable PQ) from which the rhythm is sinus. */
export const SINUS_P_SHARE = 0.9;

export interface RhythmOptions {
  /** Compensation of print QRS widening for the QRS width of extrasystoles; defaults to `PRINT_WIDENING[species]`. */
  printWidening?: PrintWidening;
}

interface TypeResult {
  type: RhythmType;
  reasons: string[];
}

/**
 * Precision ceiling for PQ constancy: 2 px for each of the two bounds (P onset and QRS onset), in sheet columns
 * (specification §6: measurement precision no better than ±2 px). Tolerance = max(20 % of median PQ, 4 px · ms/px): with
 * PQ 74 ms and 4.65 ms/px (variant A, 50 mm/s) this is 18.6 ms vs 14.8 — otherwise the delineation spread of PQ in sinus
 * complexes (`a-08`: 59…90 ms) made the rhythm "non-sinus". Without `precision` — ms/px of variant A at 50 mm/s.
 */
export const PQ_STABLE_MIN_PX = 4;
const DEFAULT_MS_PER_PX = 1000 / (4.305 * 50);

/**
 * "Non-sinus" is set when there are at least this many deviant complexes (without P or with a different PQ): one noisy
 * complex out of five assessed is already 20 %, but no reason to change the rhythm type.
 */
export const MIN_DEVIANT_BEATS = 2;

/** Reason code "P found not before all complexes"; full form — `p_not_all:<with P>/<assessed>`. */
export const P_NOT_ALL = 'p_not_all';

function rhythmType(merged: readonly MergedBeat[], premature: readonly boolean[]): TypeResult {
  const usable = merged.filter((_, i) => !premature[i]).filter(delineationUsable);
  const undetermined = (fallback: string): TypeResult => {
    if (merged.length === 0) return { type: 'undetermined', reasons: ['no_beats'] };
    if (!merged.some((m) => m.leadIIReliable)) return { type: 'undetermined', reasons: ['lead_ii_unreliable'] };
    return { type: 'undetermined', reasons: [fallback] };
  };
  if (usable.length < MIN_RHYTHM_BEATS) return undetermined('too_few_beats');
  // P share — over complexes where P could be assessed (`p-wave.ts`); fewer than three such — rhythm undetermined.
  const assessable = usable.filter((m) => pAssessed(m.delineation));
  if (assessable.length < MIN_RHYTHM_BEATS) return undetermined('p_not_found');
  const withP = assessable.filter((m) => m.delineation.pFound && m.delineation.pOn !== null);
  const absent = assessable.length - withP.length;
  const pq = withP.map((m) => m.delineation.qOn - (m.delineation.pOn as number));
  const pqMed = median(pq);
  const msPerPx = median(withP.map((m) => (m.precision && m.precision.msPerPx > 0 ? m.precision.msPerPx : DEFAULT_MS_PER_PX)));
  const tolerance = Math.max(PQ_STABLE_FRACTION * pqMed, PQ_STABLE_MIN_PX * msPerPx);
  const pqDeviant = pq.filter((v) => Math.abs(v - pqMed) > tolerance).length;
  const reasons: string[] = [];
  // P found in some complexes — a reason with numbers (`p_not_all:<with P>/<assessed>`): «зубец P не найден» ("P wave
  // not found") reads as "no P anywhere", while the overlay draws P on the same complexes where `delineate` found it
  // (a-02: 14 of 18).
  if (absent >= MIN_DEVIANT_BEATS && withP.length / assessable.length < SINUS_P_SHARE) {
    reasons.push(withP.length > 0 ? `${P_NOT_ALL}:${withP.length}/${assessable.length}` : 'p_not_found');
  }
  if (pqDeviant >= MIN_DEVIANT_BEATS && (pq.length - pqDeviant) / pq.length < SINUS_P_SHARE) reasons.push('pq_unstable');
  return reasons.length ? { type: 'non_sinus', reasons } : { type: 'sinus', reasons: [] };
}

/** A pause — RR not shorter than this many RR medians (task 13). */
export const PAUSE_RR_FACTOR = 2;

/**
 * Pauses: RR within a sheet ≥ `PAUSE_RR_FACTOR` × the median of all RR of the case. Sinoatrial block, sinus arrest,
 * a blocked extrasystole or a beat missed by the detector cannot be told apart from the sheet, so a pause in the
 * conclusion is always «требует проверки специалистом» ("requires specialist review"). The RR right after a premature
 * beat (compensatory pause after an extrasystole or run) is not a pause — it is part of the ectopy, already named.
 */
export function findPauses(merged: readonly MergedBeat[], premature: readonly boolean[] = []): Pause[] {
  const rr = merged.map((m) => m.rrPrevMs).filter((v): v is number => v !== undefined);
  if (rr.length < 2) return [];
  const limit = PAUSE_RR_FACTOR * median(rr);
  return merged
    .filter((m, i) => m.rrPrevMs !== undefined && m.rrPrevMs >= limit && !premature[i - 1])
    .map((m) => ({ beat: m.index, startMs: Math.round(m.tMs - m.rrPrevMs!), durationMs: Math.round(m.rrPrevMs!) }));
}

/** Recording duration over sheets: end of the latest signal on the case time scale. */
function spanOf(pages: readonly PageBeats[]): number {
  let end = 0;
  for (const p of pages) {
    const n = Math.max(0, ...p.signals.map((s) => s.mv.length));
    const fs = p.signals[0]?.fs ?? 500;
    end = Math.max(end, p.offsetMs + (n * 1000) / fs);
  }
  return end;
}

export function analyzeRhythmPages(pages: readonly PageBeats[], species: Species, pagesSpanMs?: number, options: RhythmOptions = {}): RhythmReport {
  const widening = options.printWidening ?? PRINT_WIDENING[species];
  const span = pagesSpanMs ?? spanOf(pages);
  const merged = mergeBeats(pages);
  const premature = prematureFlags(merged, species);
  const ectopics = classifyEctopics(merged, premature, species, widening);
  const episodes = findEpisodes(merged, premature, ectopics, span);
  const kind = rhythmType(merged, premature);
  const axis = computeAxis(merged, premature, species);
  // `getNorms` always fills `thresholds` (interfaces.md, task 08).
  const thresholds = getNorms(species).thresholds!;
  // A pause cancels the sinus arrhythmia verdict for both species: RR spread due to a pause is not respiratory
  // arrhythmia but a finding for a specialist (b-02: a 713 ms pause with RR ≈ 240 gave «вариант нормы», "normal
  // variant"). Excluding the pause from the spread is not enough — on b-02 the remaining RR (228…460 ms) are still above the threshold.
  const pauses = findPauses(merged, premature);
  const sinusArrhythmia =
    kind.type === 'sinus' && pauses.length === 0 && sinusArrhythmiaByRr(rrVariation(merged, premature), thresholds.sinusArrhythmia);
  const reasons = [...kind.reasons];
  if (axis.reason && !reasons.includes(axis.reason)) reasons.push(axis.reason);
  return { type: kind.type, reasons, axisDeg: axis.axisDeg, sinusArrhythmia, ectopics, episodes, pauses };
}

/** Contract form: beats of a single sheet without time offset. */
export function analyzeRhythm(beats: Beat[], delineations: Delineation[], signals: LeadSignal[], species: Species, pagesSpanMs: number, options: RhythmOptions = {}): RhythmReport {
  return analyzeRhythmPages([{ page: 0, offsetMs: 0, beats, delineations, signals }], species, pagesSpanMs, options);
}
