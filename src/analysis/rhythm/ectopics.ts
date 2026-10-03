/**
 * Extrasystoles (ARRHYTHM-01…04): premature beats (`prematureFlags`), type by QRS width and morphology,
 * tentative focus, coupling interval.
 *
 * Type (decisions §3, research-norms §4.2): VE — QRS wider than the species' `thresholds.wideQrs.s` (width from the II
 * delineation with print compensation, as in `measure`) **or** morphology differs from the dominant one (Pearson
 * correlation of the QRS window with the sheet's median template of non-ectopic beats below `MORPHOLOGY_SAME_MIN`);
 * otherwise SVE. The template is built in II, or, if II of the sheet is unreliable, in the most confident reliable
 * lead (arrhythmias are counted without II too).
 *
 * The focus is always «ориентировочно» ("tentative"; the mark is added by `compose`): SVE — `atrial` if a P (P′) is found before the
 * complex, `junctional` without P; VE — by QRS polarity in I and aVF: positive in I — `right_ventricle` (left bundle
 * branch block pattern), negative — `left_ventricle` (right bundle branch block pattern); with near-zero area in I,
 * aVF decides (down — right ventricle, up — left). No delineation or reliable leads — `unknown`.
 * Coupling — from the last preceding non-ectopic beat to the ectopic one, ms (`couplingOf`).
 */
import type { Ectopic, EctopicKind, LeadId, LeadSignal, Species } from '../../types/contracts';
import { delineationUsable, median, pearson, reliableLead, type MergedBeat, type PrintWidening } from '../measure';
import { getNorms } from '../norms';
import { fallbackHalfMs } from './axis';
import { leadArea } from './qrs-area';

/**
 * Below this correlation with the dominant template the morphology is considered different (VE). 0.8 lies between the
 * detector's `morphology_outlier` threshold (0.7, gross outliers) and the spread of sinus complexes on fixtures
 * (ρ ≥ 0.9 on clean sheets).
 */
export const MORPHOLOGY_SAME_MIN = 0.8;
/** Minimum non-ectopic beats of a sheet for the median template. */
const MIN_TEMPLATE_BEATS = 3;
/** Area in I below this fraction of the area in aVF — polarity in I does not decide, look at aVF. */
const SMALL_AREA_FRACTION = 0.2;

interface Template {
  lead: LeadId;
  signal: LeadSignal;
  half: number;
  values: Float32Array;
}

function window(mv: Float32Array, center: number, half: number): Float32Array {
  const out = new Float32Array(2 * half + 1);
  for (let k = -half; k <= half; k++) out[k + half] = mv[Math.min(mv.length - 1, Math.max(0, center + k))];
  return out;
}

/** Reference lead of a sheet: II if reliable, otherwise the most confident reliable lead with samples. */
function referenceLead(signals: readonly LeadSignal[]): LeadSignal | undefined {
  const ii = reliableLead(signals, 'II');
  if (ii) return ii;
  return signals.filter((s) => s.mv.length > 0 && s.confidence > 0).sort((a, b) => b.confidence - a.confidence)[0];
}

/**
 * Template window half-width: half the median QRS width of sinus complexes from delineation (as printed, without
 * compensation) — the window covers only the QRS. A ±80 ms window (as in the detector) captured the PQ and ST segments,
 * and an SVE with a different PQ (`a-08`: PQ 120 vs median 74, QRS 58 ms) came out as "different morphology". Without
 * delineation — half of a confidently wide QRS for the species.
 */
function templateHalfMs(pageBeats: readonly MergedBeat[], premature: readonly boolean[], fallbackHalf: number): number {
  const widths = pageBeats.filter((m, _, arr) => !premature[m.index] && delineationUsable(m) && arr.length > 0).map((m) => (m.delineation as { sOff: number; qOn: number }).sOff - (m.delineation as { qOn: number }).qOn);
  return widths.length >= MIN_TEMPLATE_BEATS ? median(widths) / 2 : fallbackHalf / 2;
}

/** Dominant QRS template of a sheet: median of windows around the peaks of non-ectopic beats in the reference lead. */
function templateOf(pageBeats: readonly MergedBeat[], premature: readonly boolean[], fallbackHalfMs: number): Template | undefined {
  const signals = pageBeats[0]?.signals ?? [];
  const signal = referenceLead(signals);
  if (!signal) return undefined;
  const sampleMs = 1000 / signal.fs;
  const half = Math.max(1, Math.round(templateHalfMs(pageBeats, premature, fallbackHalfMs) / sampleMs));
  const windows = pageBeats
    .filter((m) => !premature[m.index] && m.beat.perLead[signal.id])
    .map((m) => window(signal.mv, Math.round(m.beat.perLead[signal.id]!.tMs / sampleMs), half));
  if (windows.length < MIN_TEMPLATE_BEATS) return undefined;
  const values = new Float32Array(2 * half + 1);
  for (let k = 0; k < values.length; k++) values[k] = median(windows.map((w) => w[k]));
  return { lead: signal.id, signal, half, values };
}

function ventricularFocus(m: MergedBeat, halfMs: number): string {
  const areaI = leadArea(m, reliableLead(m.signals, 'I'), halfMs);
  const areaF = leadArea(m, reliableLead(m.signals, 'aVF'), halfMs);
  if (areaI === undefined && areaF === undefined) return 'unknown';
  if (areaI !== undefined && (areaF === undefined || Math.abs(areaI) > SMALL_AREA_FRACTION * Math.abs(areaF))) {
    return areaI > 0 ? 'right_ventricle' : 'left_ventricle';
  }
  if (areaF === undefined || areaF === 0) return 'unknown';
  return areaF > 0 ? 'right_ventricle' : 'left_ventricle';
}

/**
 * Coupling interval (story 56): from the last preceding **non-ectopic** QRS of the same sheet to the ectopic one.
 * For the 2nd and later beats of a run this is not the RR to the previous extrasystole but the distance to the sinus
 * beat before the run. No sinus beat before the run on the sheet — RR to the previous beat (the best visible on the sheet).
 */
function couplingOf(merged: readonly MergedBeat[], premature: readonly boolean[], i: number): number {
  const m = merged[i];
  for (let k = i - 1; k >= 0 && merged[k].pageIndex === m.pageIndex; k--) {
    if (!premature[k]) return m.tMs - merged[k].tMs;
  }
  return m.rrPrevMs ?? 0;
}

export function classifyEctopics(merged: readonly MergedBeat[], premature: readonly boolean[], species: Species, widening: PrintWidening): Ectopic[] {
  // `getNorms` always fills `thresholds` (interfaces.md, task 08).
  const thresholds = getNorms(species).thresholds!;
  const halfMs = fallbackHalfMs(species);
  const templates = new Map<number, Template | undefined>();
  const out: Ectopic[] = [];
  merged.forEach((m, i) => {
    if (!premature[i] || m.rrPrevMs === undefined) return;
    if (!templates.has(m.pageIndex)) {
      templates.set(
        m.pageIndex,
        templateOf(
          merged.filter((x) => x.pageIndex === m.pageIndex),
          premature,
          halfMs,
        ),
      );
    }
    const template = templates.get(m.pageIndex);
    const usable = delineationUsable(m);
    const widthS = usable ? Math.max(0, m.delineation.sOff - m.delineation.qOn - widening.onsetMs - widening.offsetMs) / 1000 : undefined;
    const info = template ? m.beat.perLead[template.lead] : undefined;
    const rho = template && info ? pearson(window(template.signal.mv, Math.round(info.tMs / (1000 / template.signal.fs)), template.half), template.values) : undefined;
    const wide = widthS !== undefined && widthS > thresholds.wideQrs.s;
    const different = rho !== undefined && rho < MORPHOLOGY_SAME_MIN;
    const kind: EctopicKind = wide || different ? 'VE' : 'SVE';
    let focus: string;
    if (kind === 'VE') focus = ventricularFocus(m, halfMs);
    else if (usable) focus = m.delineation.pFound ? 'atrial' : 'junctional';
    else focus = 'unknown';
    out.push({ beat: m.index, kind, focus, couplingMs: Math.round(couplingOf(merged, premature, i)) });
  });
  return out;
}
