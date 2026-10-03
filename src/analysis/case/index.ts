/**
 * `case` module — seam 2: a case of several sheets (decisions §2 step 11, §3; stories 3, 6–9, 14–15, 62–63).
 *
 * `analyzeCase(pages, settings, edits, options?)`: sheet order and groups (`orderPages`), selection of counted sheets
 * (duplicates and repeated intervals — once; with several animals and no `analyzeTogether` — only the main group,
 * the rest `pages_excluded:<i>`; with `analyzeTogether` — all, with the flag `analyze_together_forced`), beats of each
 * sheet with an offset on the case time scale (by time labels; without labels — sheets one after another), measurements
 * over the best II complexes of all sheets (`measurePages`), rhythm/axis/arrhythmias over the whole recording
 * (`analyzeRhythmPages`), conclusion (`compose`).
 *
 * Offsets: within a group with read labels `offsetMs` = difference of the sheets' recording starts (gaps between sheets
 * are preserved, RR across a junction is not computed — `mergeBeats`); otherwise — accumulated durations in group
 * order. Different groups in a joint analysis follow one another. `span.durationMs` — sum of counted sheets;
 * `coveredMs`/`minutes` — coverage from the start of the first to the end of the last counted sheet (prefill of the
 * monitoring minutes, A04 — filled in by the UI, `compose` receives only minutes entered by the user).
 *
 * Case confidence — mean confidence of counted sheets, ×0.9 when the order is unread; no sheets — 0.
 * An exception in a sheet's beats does not crash the case: `exception:beats:<sheet>:<message>`, the sheet has no beats.
 */
import type {
  CaseResult,
  CaseSettings,
  Conclusion,
  Edit,
  FormatProfile,
  GrayImage,
  Measurements,
  MeasurementKey,
  PageBeats,
  PagePrecision,
  PageResult,
} from '../../types/contracts';
import { UNRELIABLE_BELOW } from '../../types/contracts';
import { compose } from '../conclusion';
import { mean, measurePages } from '../measure';
import { analyzeRhythmPages } from '../rhythm';
import { applyMarkers, applyPageEdits, type EditCounter } from './edits';
import { pageFingerprint } from './fingerprint';
import { orderPages, pageDurationS } from './order';
import { pageBeats } from './pipeline';

export { orderPages, recordSpan, sameAnimal, headerDistance, headerComparable, pageDurationS, SAME_ANIMAL_MAX_DISTANCE, OVERLAP_MIN_S } from './order';
export { pageFingerprint } from './fingerprint';
export { pageBeats } from './pipeline';
export { applyPageEdits, applyMarkers, resetEdits } from './edits';
export type { EditedPages, EditCounter } from './edits';

export interface CaseOptions {
  /** Byte hashes of the sheets' source files (byte-identical duplicates); absent — `PageResult` content fingerprint. */
  hashes?: string[];
  /** Source images of the sheets — needed by the `separator` edit (re-tracing via `analyzePage`). */
  images?: (GrayImage | undefined)[];
  /** Format profile for re-tracing; defaults to `POLYSPECTRUM`. */
  profile?: FormatProfile;
}

const EMPTY_CONCLUSION: Conclusion = { table: [], text: '' };
/** Case confidence factor when the sheet order is unread (sheets in upload order). */
const ORDER_UNKNOWN_FACTOR = 0.9;
/** Precision ceiling: a value no larger than this many sheet pixels is "within the ceiling". */
const CEILING_PX = 2;
/** Amplitudes whose smallness matters for the `precision_ceiling` flag (ST near zero is normal, not the ceiling). */
const CEILING_AMPLITUDES: readonly MeasurementKey[] = ['pAmplitude', 'q', 'r', 's', 't'];

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Some available values lie within the sheet precision ceiling, or a wave is "not expressed" (≤ 2 px). */
function precisionCeiling(ms: Measurements, precisions: readonly PagePrecision[]): boolean {
  const mvPerPx = Math.max(0, ...precisions.map((p) => p.mvPerPx));
  if (!(mvPerPx > 0)) return false;
  return CEILING_AMPLITUDES.some((key) => {
    const m = ms[key];
    if (m.reason && /_absent$/.test(m.reason)) return true;
    return m.value !== null && m.confidence >= UNRELIABLE_BELOW && Math.abs(m.value) <= CEILING_PX * mvPerPx;
  });
}

function safePageBeats(page: PageResult, pageNo: number, offsetMs: number, species: CaseSettings['species'], issues: string[]): PageBeats {
  try {
    return pageBeats(page, pageNo, offsetMs, species);
  } catch (error) {
    issues.push(`exception:beats:${pageNo}:${messageOf(error)}`);
    return { page: pageNo, offsetMs, beats: [], delineations: [], signals: page.signals, precision: page.precision };
  }
}

export function analyzeCase(pages: PageResult[], settings: CaseSettings, edits: Edit[], options: CaseOptions = {}): CaseResult {
  const species = settings.species;
  const issues: string[] = [];
  const flags: string[] = [];

  // 0. Sheet edits (separators, calibration, baselines, labels) — folded into the state of each sheet.
  const counter: EditCounter = { applied: 0 };
  const edited = applyPageEdits(pages, edits, settings, options, counter);
  const perPage = edited.pages;
  issues.push(...edited.issues);

  // 1. Order, groups, duplicates and repeats — hashes from the source sheets (files), labels and headers from the edited ones.
  const hashes = options.hashes ?? pages.map(pageFingerprint);
  const order = orderPages(perPage, hashes);
  issues.push(...order.issues);

  // 2. Counted sheets: duplicates and repeats — once; other animals — per the user's decision.
  const excluded = new Set<number>([...order.duplicates.flatMap((g) => g.slice(1)), ...order.overlaps.map((o) => o.b)]);
  let groups = order.groups;
  if (groups.length > 1) {
    if (settings.analyzeTogether) flags.push('analyze_together_forced');
    else {
      const primary = groups.reduce((best, g) => (g.length > best.length ? g : best), groups[0]);
      for (const group of groups) {
        if (group === primary) continue;
        for (const i of group) {
          excluded.add(i);
          issues.push(`pages_excluded:${i}`);
        }
      }
      groups = [primary];
    }
  }

  // 3. Offsets on the case time scale and sheet beats.
  const analyzed: number[] = [];
  const beats: PageBeats[] = [];
  let baseMs = 0;
  let durationMs = 0;
  let coveredMs = 0;
  for (const group of groups) {
    const used = group.filter((i) => !excluded.has(i));
    if (used.length === 0) continue;
    const spans = order.spans ?? [];
    const spansKnown = used.every((i) => spans[i] !== undefined);
    const startS0 = spansKnown ? spans[used[0]]!.startS : 0;
    let cursorMs = baseMs;
    let groupEndMs = baseMs;
    for (const i of used) {
      const page = perPage[i];
      const lengthMs = pageDurationS(page) * 1000;
      const offsetMs = spansKnown ? baseMs + (spans[i]!.startS - startS0) * 1000 : cursorMs;
      beats.push(applyMarkers(safePageBeats(page, i, offsetMs, species, issues), edits, issues, counter));
      analyzed.push(i);
      durationMs += lengthMs;
      cursorMs = offsetMs + lengthMs;
      groupEndMs = Math.max(groupEndMs, offsetMs + lengthMs);
    }
    coveredMs += groupEndMs - baseMs;
    baseMs = groupEndMs;
  }

  // 4. Measurements over the best II complexes of all sheets; rhythm, axis and arrhythmias over the whole recording
  //    (end — on the case time scale). A sheet with a manual II baseline — the reference level for amplitudes and ST is
  //    shifted by the line's offset from the drawn one (story 20).
  const baselineShiftMv: Record<number, number> = {};
  for (const i of analyzed) {
    const shift = edited.baselineShiftsMv[i]?.II;
    if (shift !== undefined) baselineShiftMv[i] = shift;
  }
  const measurements = measurePages(beats, species, { baselineShiftMv });
  const rhythm = analyzeRhythmPages(beats, species, baseMs);

  // 5. Flags for the conclusion and case confidence.
  if (counter.applied > 0) flags.push('manual_correction');
  if (precisionCeiling(measurements, analyzed.map((i) => perPage[i].precision))) flags.push('precision_ceiling');
  const orderFactor = order.issues.includes('order_unknown') ? ORDER_UNKNOWN_FACTOR : 1;
  const confidence = analyzed.length ? Math.max(0, Math.min(1, mean(analyzed.map((i) => perPage[i].confidence)) * orderFactor)) : 0;

  const draft: CaseResult = {
    measurements,
    rhythm,
    conclusion: EMPTY_CONCLUSION,
    confidence,
    perPage,
    span: { durationMs, pages: analyzed.length, coveredMs, minutes: coveredMs / 60000 },
    order,
    analyzed,
    beats,
    flags,
    issues: [...new Set(issues)],
  };
  const conclusion = compose(draft, {
    species,
    dogSize: settings.dogSize,
    drugs: settings.drugs,
    monitoringMinutes: settings.monitoringMinutes,
    flags,
  });
  return { ...draft, conclusion };
}
