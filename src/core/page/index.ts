/**
 * Module `page`, seam 1: one whole sheet. Exposes `analyzePage(img, profile, options?) -> PageResult` and
 * `analyzePageWith(steps, img, profile, options?)`, the same pipeline with substituted steps (failing-step tests,
 * tools); hides the module call order: layout → ink → trace → pagemeta → calibration → digitize.
 *
 * An exception in any step does not bring the sheet down: it becomes `exception:<step>:<message>` in `issues`
 * (`layout | ink | trace | pagemeta | digitize:<lead>`), sheet confidence is 0, results of the steps already
 * completed are kept; dependent steps are skipped (no layout: nothing; no ink: no traces
 * or signals; sheet reading does not depend on traces and always runs).
 *
 * Calibration (INPUT-03): manual `options.calib` beats everything (`calibSource: 'manual'`), otherwise the sheet footer
 * (`'footer'`), otherwise 50 mm/s and 10 mm/mV (`'default'`). A manual calibration with a read footer that has different
 * values yields `calib_manual_overrides_footer:<mm/s>/<mm/mV>` (footer values), so the UI can warn.
 * `precision` is the precision ceiling from the actual px/mm: mV and ms per pixel.
 *
 * Sheet `issues` (snake_case, no duplicates): root causes first, the `exception:*` of steps and modules; then layout
 * codes (`no_grid`, …), ink codes, trace codes as `<reason>:<lead>` (`clipped:aVF`, `ambiguous:III`,
 * `gap:II`, `unexplained_ink:I`, `anchor_weak:III`; `coverage` fully explained by marked gap/clipped spans of the
 * same trace is derived and not repeated), sheet reading codes (`hr_row_empty`, …) and codes of the
 * sheet itself: `lead_order_mismatch` (a pagemeta label is closer to another trace's baseline), `header_name_unanchored`
 * (the header crop is not trimmed at «ЭКГ» (ECG), so sheets cannot be compared by it).
 *
 * Sheet confidence: min(layout confidence, mean confidence of the six traces); ×0.5 on label mismatch;
 * 0 on a step exception. Text reading is not part of it: `meta` has its own `confidence`.
 */
import {
  DEFAULT_CALIBRATION,
  type Calibration,
  type CalibSource,
  type FormatProfile,
  type GrayImage,
  type InkMask,
  type LeadSignal,
  type LeadTrace,
  type PageLayout,
  type PageMeta,
  type PageOptions,
  type PagePrecision,
  type PageResult,
  type TraceHint,
} from '../../types/contracts';
import { digitize } from '../digitize';
import { extractInk } from '../ink';
import { detectLayout } from '../layout';
import { readPageMeta } from '../pagemeta';
import { traceLeads } from '../trace';

/** Sheet pipeline steps: substituted wholly or partially in `analyzePageWith`. */
export interface PageSteps {
  detectLayout: (img: GrayImage, profile: FormatProfile) => PageLayout;
  extractInk: (img: GrayImage, layout: PageLayout, profile: FormatProfile) => InkMask;
  traceLeads: (ink: InkMask, layout: PageLayout, profile: FormatProfile, hints?: TraceHint[]) => LeadTrace[];
  readPageMeta: (img: GrayImage, layout: PageLayout, profile: FormatProfile) => PageMeta;
  digitize: (trace: LeadTrace, layout: PageLayout, calib: Calibration) => LeadSignal;
}

export const DEFAULT_STEPS: Readonly<PageSteps> = { detectLayout, extractInk, traceLeads, readPageMeta, digitize };

/** Sheet confidence multiplier when lead labels do not confirm the trace order. */
const ORDER_MISMATCH_FACTOR = 0.5;
/** Column-fraction tolerance: coverage counts as explained by marked spans if it differs by no more than this. */
const COVERAGE_SLACK = 0.002;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function fallbackLayout(img: GrayImage): PageLayout {
  return {
    variant: 'A',
    frame: { x: 0, y: 0, width: img.width, height: img.height },
    grid: { pxPerMmX: 0, pxPerMmY: 0, phaseX: 0, phaseY: 0, confidence: 0 },
    zones: {},
    expectedBaselines: [0, 0, 0, 0, 0, 0],
    confidence: 0,
    issues: [],
  };
}

function emptyMeta(): PageMeta {
  return {
    hrRow: [],
    timeLabels: [],
    leadLabels: [],
    headerNameCrop: { width: 0, height: 0, data: new Uint8Array(0) },
    confidence: 0,
    issues: [],
  };
}

function emptySignal(trace: LeadTrace): LeadSignal {
  return { id: trace.id, fs: 500, t0: 0, mv: new Float32Array(0), baselineY: trace.baselineY, confidence: 0, unreliable: [] };
}

interface CalibrationChoice {
  calib: Calibration;
  calibSource: CalibSource;
  /** The read footer that was overridden by a manual calibration with different values. */
  overriddenFooter?: Calibration;
}

const validCalibration = (c: Calibration | undefined): c is Calibration => c !== undefined && c.mmPerS > 0 && c.mmPerMv > 0;

function chooseCalibration(meta: PageMeta, options: PageOptions): CalibrationChoice {
  const footer = validCalibration(meta.footerCalib) ? meta.footerCalib : undefined;
  const manual = validCalibration(options.calib) ? options.calib : undefined;
  if (manual) {
    const differs = footer !== undefined && (footer.mmPerS !== manual.mmPerS || footer.mmPerMv !== manual.mmPerMv);
    return { calib: { ...manual }, calibSource: 'manual', ...(differs ? { overriddenFooter: { ...footer } } : {}) };
  }
  if (footer) return { calib: { ...footer }, calibSource: 'footer' };
  return { calib: { ...DEFAULT_CALIBRATION }, calibSource: 'default' };
}

function precisionOf(layout: PageLayout, calib: Calibration): PagePrecision {
  const { pxPerMmX, pxPerMmY } = layout.grid;
  if (!(pxPerMmX > 0) || !(pxPerMmY > 0)) return { mvPerPx: 0, msPerPx: 0 };
  return { mvPerPx: 1 / (pxPerMmY * calib.mmPerMv), msPerPx: 1000 / (pxPerMmX * calib.mmPerS) };
}

/** Plotter columns as `trace` defines them: from the first to the last ink column of wide components. */
function plotterColumns(ink: InkMask | undefined, layout: PageLayout): number {
  if (!ink) return 0;
  const wide = ink.components.filter((c) => c.bbox.width >= 0.5 * layout.frame.width);
  const pool = wide.length ? wide : ink.components;
  if (pool.length === 0) return 0;
  const xs = Math.min(...pool.map((c) => c.bbox.x));
  const xe = Math.max(...pool.map((c) => c.bbox.x + c.bbox.width - 1));
  return Math.max(1, xe - xs + 1);
}

/** The trace's coverage shortfall is fully explained by its gap/clipped spans: `coverage` is derived, not a root cause. */
function coverageExplained(trace: LeadTrace, plotColumns: number): boolean {
  const columns = plotColumns > 0 ? plotColumns : Math.max(1, (trace.points.at(-1)?.x ?? 0) - (trace.points[0]?.x ?? 0) + 1);
  const marked = trace.unreliable.filter((u) => u.kind !== 'ambiguous').reduce((s, u) => s + (u.x1 - u.x0 + 1), 0);
  return 1 - trace.coverage <= marked / columns + COVERAGE_SLACK;
}

/** A lead label sits at another trace's baseline: the trace order is not confirmed. */
function leadOrderMismatch(meta: PageMeta, leads: LeadTrace[]): boolean {
  if (leads.length === 0 || meta.leadLabels.length === 0) return false;
  return meta.leadLabels.some((label) => {
    const cy = label.rect.y + (label.rect.height - 1) / 2;
    let nearest = leads[0];
    for (const lead of leads) if (Math.abs(lead.baselineY - cy) < Math.abs(nearest.baselineY - cy)) nearest = lead;
    return nearest.id !== label.id;
  });
}

/** The header crop is not trimmed at the «ЭКГ» (ECG) anchor (empty or the whole zone): it contains the date, sheets cannot be compared. */
function headerUnanchored(meta: PageMeta, layout: PageLayout): boolean {
  const crop = meta.headerNameCrop;
  if (crop.width === 0 || crop.height === 0) return true;
  const zone = layout.zones.headerName;
  return zone !== undefined && crop.width >= zone.width;
}

function collectIssues(
  failures: string[],
  layout: PageLayout,
  ink: InkMask | undefined,
  leads: LeadTrace[],
  meta: PageMeta,
  metaRead: boolean,
  orderMismatch: boolean,
  pageCodes: string[],
): string[] {
  const all: string[] = [...failures, ...layout.issues, ...(ink?.issues ?? [])];
  const plotColumns = plotterColumns(ink, layout);
  for (const trace of leads) {
    for (const reason of trace.reasons) {
      if (reason.startsWith('exception:')) all.push(`exception:trace:${reason.slice('exception:'.length)}`);
      else if (reason === 'coverage' && coverageExplained(trace, plotColumns)) continue;
      else all.push(`${reason}:${trace.id}`);
    }
  }
  all.push(...meta.issues);
  if (orderMismatch) all.push('lead_order_mismatch');
  if (metaRead && headerUnanchored(meta, layout)) all.push('header_name_unanchored');
  all.push(...pageCodes);
  // Root causes first, no duplicates, in order of appearance.
  const exceptions = all.filter((code) => code.startsWith('exception:'));
  const rest = all.filter((code) => !code.startsWith('exception:'));
  return [...new Set([...exceptions, ...rest])];
}

export function analyzePageWith(steps: Partial<PageSteps>, img: GrayImage, profile: FormatProfile, options: PageOptions = {}): PageResult {
  const run: PageSteps = { ...DEFAULT_STEPS, ...steps };
  const failures: string[] = [];
  const attempt = <T>(step: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (error) {
      failures.push(`exception:${step}:${messageOf(error)}`);
      return undefined;
    }
  };

  // 1. Layout: without it the other steps are pointless.
  const detected = attempt('layout', () => run.detectLayout(img, profile));
  const layout = detected ?? fallbackLayout(img);

  // 2–3. Ink and traces: traces require ink.
  const ink = detected ? attempt('ink', () => run.extractInk(img, layout, profile)) : undefined;
  const leads = ink ? (attempt('trace', () => run.traceLeads(ink, layout, profile, options.hints)) ?? []) : [];

  // 4. Sheet reading: independent of traces.
  const read = detected ? attempt('pagemeta', () => run.readPageMeta(img, layout, profile)) : undefined;
  const meta = read ?? emptyMeta();

  // 5–6. Calibration (manual → footer → default) and digitization of each trace.
  const { calib, calibSource, overriddenFooter } = chooseCalibration(meta, options);
  const signals = leads.map((trace) => attempt(`digitize:${trace.id}`, () => run.digitize(trace, layout, calib)) ?? emptySignal(trace));

  // 7. Sheet summary.
  const orderMismatch = leadOrderMismatch(meta, leads);
  const pageCodes = overriddenFooter ? [`calib_manual_overrides_footer:${overriddenFooter.mmPerS}/${overriddenFooter.mmPerMv}`] : [];
  const issues = collectIssues(failures, layout, ink, leads, meta, read !== undefined, orderMismatch, pageCodes);
  let confidence = 0;
  if (failures.length === 0 && leads.length > 0) {
    const leadMean = leads.reduce((s, t) => s + t.confidence, 0) / leads.length;
    confidence = Math.min(layout.confidence, leadMean);
    if (orderMismatch) confidence *= ORDER_MISMATCH_FACTOR;
  }

  return {
    layout,
    leads,
    signals,
    meta,
    calib,
    calibSource,
    precision: precisionOf(layout, calib),
    confidence: Math.max(0, Math.min(1, confidence)),
    issues,
  };
}

export function analyzePage(img: GrayImage, profile: FormatProfile, options?: PageOptions): PageResult {
  return analyzePageWith({}, img, profile, options);
}
