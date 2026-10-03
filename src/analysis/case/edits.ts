/**
 * Applying manual edits (`Edit[]`) to the case sheets — deterministically: edits are folded into a single sheet state
 * (effective calibration, per-lead baselines, relabeling map), and only then are the signals digitized again — one
 * `digitize` per lead, so that successive edits do not overwrite each other. Order within a kind is list order: the
 * last edit of the same object wins.
 *
 * - `separator` — the sheet is re-traced entirely via `analyzePage(img, profile, { hints, calib })` (needs the source
 *   image, `CaseOptions.images[page]`); without the image the edit is not applied — `edit_skipped:separator:<sheet>`.
 * - `calibration` — a sheet or all-sheets edit beats `CaseSettings.calib`, which beats the footer; the sheet gets
 *   `calibSource: 'manual'`, a new `precision` and, on mismatch with the read footer, the code `calib_manual_overrides_footer`.
 *   `pxPerMm` (story 17) replaces `layout.grid.pxPerMmX/Y` (phase unchanged) before digitizing and in the precision
 *   ceiling, code `grid_manual`; mm/s, mm/mV and `calibSource` do not change if the edit's `calib` equals the sheet
 *   calibration. Invalid `pxPerMm` (≤ 0, not a number) — the whole edit is not applied, `edit_skipped:calibration:<sheet>`.
 * - `baseline` — the trace gets a manual baseline, the signal is digitized from it (`digitize({...trace, baselineY}, …)`);
 *   the line's shift from the automatic one goes into the sheet's `baselineShiftsMv`, and `measure` shifts the reference
 *   level for amplitudes and ST by it (local PQ + shift).
 * - `leadLabel` — simultaneous slot permutation (I↔II do not overwrite each other); "no lead" — the slot stays
 *   (six positions in `LEAD_IDS` order), a trace without points and an empty signal; two traces into one lead —
 *   `lead_label_conflict:<lead>`, the last one in the list is used.
 * - `marker` — applied to the beat delineation after `delineate` (`applyMarkers`): the bound is moved, complex
 *   confidence 1 (physician's delineation), "not found" reasons for the corrected wave are cleared; `unreliable_segment`
 *   stays — a clipped span does not become signal (task 05 commitment). Other complexes are not touched.
 *
 * An edit on a nonexistent sheet, lead or beat — `edit_skipped:<kind>:<sheet>`, not an exception.
 */
import {
  LEAD_IDS,
  type Calibration,
  type CaseSettings,
  type Edit,
  type LeadId,
  type LeadSignal,
  type LeadTrace,
  type MarkerField,
  type PageBeats,
  type PagePrecision,
  type PageLayout,
  type PageResult,
} from '../../types/contracts';
import { digitize } from '../../core/digitize';
import { analyzePage } from '../../core/page';
import { POLYSPECTRUM } from '../../core/profile';
import type { CaseOptions } from './index';

type EditOf<K extends Edit['kind']> = Extract<Edit, { kind: K }>;

export interface EditedPages {
  pages: PageResult[];
  /**
   * Per sheet: leads (final slots after `leadLabel`) with a manual baseline (`baseline`) → signal shift in mV
   * relative to the automatic (drawn) line, (manual y − automatic y) × mV/px. `measure` shifts the reference
   * level for amplitudes and ST by this amount (story 20): line in its original place — the automatic numbers.
   */
  baselineShiftsMv: Partial<Record<LeadId, number>>[];
  /** How many edits were actually applied (the `manual_correction` flag only when > 0). */
  applied: number;
  issues: string[];
}

/** Counter of applied edits, shared by sheets and markers. */
export interface EditCounter {
  applied: number;
}

const validCalibration = (c: Calibration | undefined): c is Calibration => c !== undefined && c.mmPerS > 0 && c.mmPerMv > 0;
const sameCalibration = (a: Calibration, b: Calibration): boolean => a.mmPerS === b.mmPerS && a.mmPerMv === b.mmPerMv;

/** Sheet precision ceiling — the same formula as in `page` (mV and ms per pixel; 0 without a grid). */
function precisionOf(layout: PageLayout, calib: Calibration): PagePrecision {
  const { pxPerMmX, pxPerMmY } = layout.grid;
  if (!(pxPerMmX > 0) || !(pxPerMmY > 0)) return { mvPerPx: 0, msPerPx: 0 };
  return { mvPerPx: 1 / (pxPerMmY * calib.mmPerMv), msPerPx: 1000 / (pxPerMmX * calib.mmPerS) };
}

function emptySignal(id: LeadId, baselineY: number): LeadSignal {
  return { id, fs: 500, t0: 0, mv: new Float32Array(0), baselineY, confidence: 0, unreliable: [] };
}

const pageOfEdit = (edit: Edit): number | undefined => edit.page;

type ScaleMm = NonNullable<EditOf<'calibration'>['pxPerMm']>;

const validScale = (s: ScaleMm | undefined): boolean =>
  s === undefined || (typeof s.x === 'number' && typeof s.y === 'number' && Number.isFinite(s.x) && Number.isFinite(s.y) && s.x > 0 && s.y > 0);

/**
 * Applicable `calibration` edits of a sheet: valid mm/s and mm/mV and, if set, a valid `pxPerMm` (both > 0, numbers).
 * An edit with an invalid `pxPerMm` is not applied at all — `edit_skipped:calibration:<sheet>`.
 */
function calibrationEdits(own: readonly Edit[], index: number, issues: string[]): EditOf<'calibration'>[] {
  const out: EditOf<'calibration'>[] = [];
  for (const e of own) {
    if (e.kind !== 'calibration' || !validCalibration(e.calib)) continue;
    if (!validScale(e.pxPerMm)) {
      issues.push(`edit_skipped:calibration:${index}`);
      continue;
    }
    out.push(e);
  }
  return out;
}

/**
 * Effective manual calibration of a sheet: the last `calibration` edit that changes mm/s or mm/mV, else the case
 * calibration. A scale edit (`pxPerMm`) with a calibration equal to the sheet's does not change the calibration (story 17:
 * the physician sets px/mm, not mm/s and mm/mV) — the sheet's calibration source stays the same.
 */
function manualCalibration(edits: readonly EditOf<'calibration'>[], page: PageResult, settings: CaseSettings): Calibration | undefined {
  const last = edits.filter((e) => !(e.pxPerMm && sameCalibration(e.calib, page.calib))).at(-1)?.calib;
  if (last) return last;
  return validCalibration(settings.calib) ? settings.calib : undefined;
}

/** Sheet scale set by the physician: the last applicable edit with `pxPerMm`. */
const manualScale = (edits: readonly EditOf<'calibration'>[]): ScaleMm | undefined => edits.filter((e) => e.pxPerMm).at(-1)?.pxPerMm;

/** Sheet grid with the physician's scale: px/mm per axis replaced, phase and the rest unchanged. */
function withScale(layout: PageLayout, scale: ScaleMm): PageLayout {
  return { ...layout, grid: { ...layout.grid, pxPerMmX: scale.x, pxPerMmY: scale.y } };
}

/** Code for a mismatch between manual calibration and the read footer — as set by `analyzePage`. */
function withOverrideIssue(page: PageResult, calib: Calibration): string[] {
  const footer = page.meta.footerCalib;
  const issues = page.issues.filter((c) => !c.startsWith('calib_manual_overrides_footer:'));
  if (validCalibration(footer) && !sameCalibration(footer, calib)) issues.push(`calib_manual_overrides_footer:${footer.mmPerS}/${footer.mmPerMv}`);
  return issues;
}

function emptyTrace(id: LeadId, baselineY: number): LeadTrace {
  return { id, points: [], baselineY, coverage: 0, explainedInk: 0, unreliable: [], confidence: 0, reasons: ['lead_removed'] };
}

/**
 * Label reassignment — simultaneous slot permutation: for each lead in `LEAD_IDS` order the trace whose (reassigned)
 * label matches is looked up; an empty slot — a trace without points and an empty signal; several candidates —
 * `lead_label_conflict:<lead>`, the trace with the later edit wins (a trace without an edit loses to any edit).
 */
function relabelLeads(
  page: PageResult,
  edits: readonly EditOf<'leadLabel'>[],
  index: number,
  issues: string[],
  counter: EditCounter,
  sourceOf: Map<LeadId, LeadId>,
): PageResult {
  const target = new Map<LeadId, LeadId | null>();
  const rank = new Map<LeadId, number>();
  edits.forEach((edit, k) => {
    if (!page.leads.some((t) => t.id === edit.lead)) {
      issues.push(`edit_skipped:leadLabel:${index}`);
      return;
    }
    target.set(edit.lead, edit.as);
    rank.set(edit.lead, k);
    counter.applied++;
  });
  if (target.size === 0) return page;
  const labelOf = (id: LeadId): LeadId | null => (target.has(id) ? (target.get(id) as LeadId | null) : id);
  const leads: LeadTrace[] = [];
  const signals: LeadSignal[] = [];
  LEAD_IDS.forEach((slot, k) => {
    const sources = page.leads.map((trace, idx) => ({ trace, idx })).filter(({ trace }) => labelOf(trace.id) === slot);
    if (sources.length > 1) {
      issues.push(`lead_label_conflict:${slot}`);
      sources.sort((a, b) => (rank.get(a.trace.id) ?? -1) - (rank.get(b.trace.id) ?? -1));
    }
    const chosen = sources.at(-1);
    if (chosen) {
      leads.push({ ...chosen.trace, id: slot });
      sourceOf.set(slot, chosen.trace.id);
      const signal = page.signals[chosen.idx];
      signals.push(signal ? { ...signal, id: slot } : emptySignal(slot, chosen.trace.baselineY));
    } else {
      const baselineY = page.layout.expectedBaselines[k] ?? 0;
      leads.push(emptyTrace(slot, baselineY));
      signals.push(emptySignal(slot, baselineY));
    }
  });
  return { ...page, leads, signals };
}

function editPage(
  page: PageResult,
  index: number,
  own: readonly Edit[],
  settings: CaseSettings,
  options: CaseOptions,
  issues: string[],
  counter: EditCounter,
): { page: PageResult; baselineShiftsMv: Partial<Record<LeadId, number>> } {
  let result = page;
  const calibEdits = calibrationEdits(own, index, issues);
  const manual = manualCalibration(calibEdits, page, settings);
  const scale = manualScale(calibEdits);
  counter.applied += calibEdits.length;
  const calib = manual ?? result.calib;

  // 0. Separators — the only edit that changes traces: the sheet is rebuilt by the sheet seam with hints
  //    (and the manual calibration, to avoid digitizing twice); without an image the edit is skipped.
  const separators = own.filter((e): e is EditOf<'separator'> => e.kind === 'separator');
  if (separators.length) {
    const image = options.images?.[index];
    if (!image) issues.push(`edit_skipped:separator:${index}`);
    else {
      result = analyzePage(image, options.profile ?? POLYSPECTRUM, { hints: separators.map((s) => s.hint), ...(manual ? { calib: manual } : {}) });
      counter.applied += separators.length;
    }
  }

  // 0a. The physician's scale (story 17) replaces the measured grid — after re-tracing, which rebuilds the layout.
  if (scale) {
    const issuesWithScale = result.issues.includes('grid_manual') ? result.issues : [...result.issues, 'grid_manual'];
    result = { ...result, layout: withScale(result.layout, scale), issues: issuesWithScale };
  }

  // 1. Manual baselines: the last edit per lead; leads without a trace — the edit is skipped.
  const baselines = new Map<LeadId, number>();
  for (const edit of own) {
    if (edit.kind !== 'baseline') continue;
    if (!result.leads.some((t) => t.id === edit.lead) || !Number.isFinite(edit.y)) {
      issues.push(`edit_skipped:baseline:${index}`);
      continue;
    }
    baselines.set(edit.lead, edit.y);
    counter.applied++;
  }
  const leads = result.leads.map((trace) => (baselines.has(trace.id) ? { ...trace, baselineY: baselines.get(trace.id)! } : trace));

  // 2. Re-digitizing in a single pass: on a calibration change — all traces, otherwise — only those with a manual baseline.
  //    The physician's scale also requires digitizing all traces and a new precision ceiling, but leaves the calibration and its source.
  const recalibrate = manual !== undefined && (!sameCalibration(calib, result.calib) || result.calibSource !== 'manual');
  const all = recalibrate || scale !== undefined;
  /**
   * Leads (automatic labels) whose signal was actually digitized from a manual baseline → how many mV higher the signal
   * is than from the automatic (drawn) line: (manual y − automatic y) × mV/px of the same digitization.
   */
  const fromManual = new Map<LeadId, number>();
  const mvPerPx = precisionOf(result.layout, calib).mvPerPx;
  if (all || baselines.size > 0) {
    const signals = leads.map((trace, k) => {
      if (!all && !baselines.has(trace.id)) return result.signals[k] ?? emptySignal(trace.id, trace.baselineY);
      try {
        const signal = digitize(trace, result.layout, calib);
        const autoY = result.leads[k]?.baselineY;
        if (baselines.has(trace.id) && autoY !== undefined) fromManual.set(trace.id, (trace.baselineY - autoY) * mvPerPx);
        return signal;
      } catch (error) {
        issues.push(`exception:digitize:${index}:${trace.id}:${error instanceof Error ? error.message : String(error)}`);
        return result.signals[k] ?? emptySignal(trace.id, trace.baselineY);
      }
    });
    result = recalibrate
      ? {
          ...result,
          leads,
          signals,
          calib: { ...calib },
          calibSource: 'manual',
          precision: precisionOf(result.layout, calib),
          issues: withOverrideIssue(result, calib),
        }
      : scale
        ? { ...result, leads, signals, precision: precisionOf(result.layout, result.calib) }
        : { ...result, leads, signals };
  }

  // 3. Lead labels — simultaneous slot permutation.
  const relabels = own.filter((e): e is EditOf<'leadLabel'> => e.kind === 'leadLabel');
  const sourceOf = new Map<LeadId, LeadId>();
  const beforeRelabel = result;
  if (relabels.length) result = relabelLeads(result, relabels, index, issues, counter, sourceOf);
  const relabeled = result !== beforeRelabel;
  // The manual baseline follows the trace: a slot after permutation is manual if a trace with a manual baseline landed in it.
  const baselineShiftsMv: Partial<Record<LeadId, number>> = {};
  for (const slot of result.leads.map((t) => t.id)) {
    const source = relabeled ? sourceOf.get(slot) : slot;
    if (source !== undefined && fromManual.has(source)) baselineShiftsMv[slot] = fromManual.get(source)!;
  }
  return { page: result, baselineShiftsMv };
}

export function applyPageEdits(pages: PageResult[], edits: readonly Edit[], settings: CaseSettings, options: CaseOptions, counter: EditCounter): EditedPages {
  const issues: string[] = [];
  const out = pages.map((page, i) => {
    const own = edits.filter((e) => (e.kind === 'calibration' ? e.page === undefined || e.page === i : e.page === i));
    return editPage(page, i, own, settings, options, issues, counter);
  });
  for (const edit of edits) {
    const page = pageOfEdit(edit);
    if (page !== undefined && !(Number.isInteger(page) && page >= 0 && page < pages.length)) issues.push(`edit_skipped:${edit.kind}:${page}`);
  }
  return { pages: out.map((o) => o.page), baselineShiftsMv: out.map((o) => o.baselineShiftsMv), applied: counter.applied, issues };
}

/** Delineation reason prefixes cleared by a manual bound of the corresponding wave. */
const REASONS_DROPPED_BY: Record<MarkerField, string> = { pOn: 'p_', pOff: 'p_', qOn: 'qrs_', sOff: 'qrs_', tOff: 't_' };

/** Wave bound markers — applied to the sheet's beat delineation (after `delineate`): only the marked complex changes. */
export function applyMarkers(pb: PageBeats, edits: readonly Edit[], issues: string[], counter: EditCounter): PageBeats {
  const markers = edits.filter((e): e is EditOf<'marker'> => e.kind === 'marker' && e.page === pb.page);
  if (markers.length === 0) return pb;
  const delineations = pb.delineations.map((d) => ({ ...d }));
  for (const marker of markers) {
    const d = Number.isInteger(marker.beat) ? delineations[marker.beat] : undefined;
    if (!d || !Number.isFinite(marker.tMs)) {
      issues.push(`edit_skipped:marker:${pb.page}`);
      continue;
    }
    d[marker.field] = marker.tMs;
    if (marker.field === 'pOn' || marker.field === 'pOff') d.pFound = true;
    // Physician's delineation: full complex confidence; "not found" for the corrected wave is cleared, `unreliable_segment` stays.
    d.confidence = 1;
    const dropped = REASONS_DROPPED_BY[marker.field];
    d.reasons = (d.reasons ?? []).filter((r) => !r.startsWith(dropped));
    counter.applied++;
  }
  return { ...pb, delineations };
}

/** Reset edits — return to automatic delineation: an empty edit list gives the same result as the automatic one. */
export function resetEdits(_edits: readonly Edit[]): Edit[] {
  return [];
}
