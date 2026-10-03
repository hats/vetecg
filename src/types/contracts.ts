/**
 * VetECG 2 module contracts — the single place where the types modules exchange with each other are declared.
 * Source: `.autopilot/<run>/interfaces.md`, section "Boundaries decided in the specification". Modules implement
 * functions over these types; module-internal structures do not live here.
 *
 * Conventions:
 * - sheet coordinates — pixels of the source image, origin at the top-left corner;
 * - signal time — milliseconds from the start of the sheet;
 * - confidence — a number 0..1; reasons/issues — English code strings
 *   (e.g. `not_implemented`, `grid_not_found`); texts for the vet are built separately.
 */

// ---------------------------------------------------------------------------
// Base types
// ---------------------------------------------------------------------------

/** Grayscale image: brightness 0..255 row by row, `data.length === width * height`. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The six leads of a "Поли-Спектр.NET" (Poly-Spectrum.NET) sheet, top to bottom. */
export type LeadId = 'I' | 'II' | 'III' | 'aVR' | 'aVL' | 'aVF';
export const LEAD_IDS: readonly LeadId[] = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF'];

export type Species = 'dog' | 'cat';
/** Dog size for the norm tables (specification: small/large); not used for cats. */
export type DogSize = 'small' | 'large';

/**
 * Species letter after «ЭКГ» (ECG) in the sheet header. CYRILLIC: «с» (U+0441) — dog, «к» (U+043A) — cat.
 * Latin "c"/"k" do not fit here; same in `fixtures/polyspectrum/expected.json`.
 */
export type SpeciesLetter = 'с' | 'к';

/** Recording calibration: paper speed and gain. Default 50 mm/s, 10 mm/mV. */
export interface Calibration {
  mmPerS: number;
  mmPerMv: number;
}

export const DEFAULT_CALIBRATION: Readonly<Calibration> = { mmPerS: 50, mmPerMv: 10 };

/** Exactly six values — one per lead in `LEAD_IDS` order. */
export type Six<T> = [T, T, T, T, T, T];

// ---------------------------------------------------------------------------
// profile — format profile (data, not branches in algorithms)
// ---------------------------------------------------------------------------

/** Sheet layout variant: A — 1280×905, B — 1280×883 («© Нейрософт» (Neurosoft) header, RR row at the bottom). */
export type PageVariant = 'A' | 'B';

/**
 * Named sheet zones. `rrRow` exists only in variant B.
 * `headerName` — left part of the header (date, time, pet name) for comparing sheets of the same animal;
 * `headerProduct` — product string on the right of the header, used to confirm the variant.
 */
export type ZoneName =
  | 'header'
  | 'headerName'
  | 'headerProduct'
  | 'timeLabels'
  | 'hrRow'
  | 'leadLabels'
  | 'plot'
  | 'footer'
  | 'rrRow';

/** Binary sheet crop: 0 — background, 1 — ink; `x`, `y` — position on the sheet, `data.length === width * height`. */
export interface BinaryPatch {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/** Template-reading glyph bitmap: 0 — background, 255 — ink (intermediate values — antialiasing). */
export interface Glyph {
  text: string;
  width: number;
  height: number;
  data: Uint8Array;
  /** Offset of the glyph top from the font line top, px ("." and ":" sit lower than digits); absent — 0. */
  dy?: number;
}

export interface GlyphSet {
  name: string;
  glyphs: Glyph[];
  /**
   * A glyph wider than this many px is a merged pair: read by trying pairs of the set's templates (HR digits: 9).
   * No field — pairs are not split (lead labels, footer fragments).
   */
  pairAbove?: number;
  /** Brightness threshold the templates were cut at: pixels not darker than it are background (default 170). */
  inkThreshold?: number;
}

/**
 * Constants of one layout variant (owner — the `profile` module). All coordinates are px of the sheet at its
 * original size; constants are expectations and tolerances for checking what is measured, not a substitute for it.
 * Source of the numbers — the probe on 10 sheets (`spike-results.md`) and task 02 measurements.
 */
export interface ProfileVariant {
  width: number;
  height: number;
  /** Inner frame area: from the inner side of the line + 2 px halo (probe convention). */
  frame: Rect;
  pxPerMm: number;
  /** One second of paper (50 mm) in px, measured from the "+" second marks. */
  pxPerSecond: number;
  /** First 5-mm grid row by Y, sheet px (the grid's Y phase is fixed by the layout). */
  gridRowY: number;
  /** "+" lattice: first row (px) and row step (mm); columns are at the second marks. */
  plusRowY0: number;
  plusRowStepMm: number;
  /** Distance from the first 5-mm row to the lead I baseline, mm. */
  baselineOffsetMm: number;
  /** Vertical step between lead baselines, mm. */
  leadStepMm: number;
  /** Vertical step between lead baselines, px (= `leadStepMm · pxPerMm`). */
  leadStepPx: number;
  /** Baseline of the first lead (I), px (= `gridRowY + baselineOffsetMm · pxPerMm`). */
  firstBaselineY: number;
  /** Binary template of the product string in the right part of the header (threshold `thresholds.headerThreshold`). */
  headerProduct: BinaryPatch;
  zones: Partial<Record<ZoneName, Rect>>;
}

/** Profile thresholds and tolerances; known fields are listed, the rest are by name. */
export interface ProfileThresholds {
  /** Grid dot brightness: lower and upper bounds (inclusive). */
  gridLo: number;
  gridHi: number;
  /** Ink hysteresis: core darker than `inkCore`, grown up to `inkEdge` by connectivity. */
  inkCore: number;
  inkEdge: number;
  /** Frame line: pixel darker than `frameDark`; a frame row/column — share of such pixels ≥ `frameFill`. */
  frameDark: number;
  frameFill: number;
  /** Relative tolerances on the grid period and frame size against the variant constants. */
  gridTolerance: number;
  frameTolerance: number;
  /** Header binarization and the maximum Jaccard distance for "same variant / same recording". */
  headerThreshold: number;
  headerMaxDistance: number;
  /** Components with a smaller area are grid remnants. */
  minComponentArea: number;
  /** A column of "+" second marks lies on a 5-mm X line within this tolerance (fraction of the line step). */
  plusLineTolerance: number;
  /** RR row at the bottom of the frame: min ink in the band, min glyphs (background→ink transitions over columns), max ink share above the band. */
  rrRowMinInk: number;
  rrRowMinGlyphs: number;
  rrRowMaxAboveRatio: number;
  [key: string]: number;
}

/** Format profile. The `variants`/`glyphs`/`thresholds` fields are refined by the `profile` module task. */
export interface FormatProfile {
  id: string;
  name: string;
  variants: Record<PageVariant, ProfileVariant>;
  glyphs: Record<string, GlyphSet>;
  thresholds: ProfileThresholds;
}

export interface GlyphMatch {
  text: string;
  score: number;
  /** Margin of the best candidate over the second one. */
  margin: number;
}

// ---------------------------------------------------------------------------
// layout — frame, grid, zones
// ---------------------------------------------------------------------------

/**
 * Measured sheet grid. `phaseX`/`phaseY` — coordinate of the first 5-mm grid line along the axis, sheet px;
 * other 5-mm lines are `phase + 5k · pxPerMm`, 1-mm nodes are `phase + k · pxPerMm`.
 * Grid not found → periods and phases 0, `confidence` 0.
 */
export interface GridEstimate {
  pxPerMmX: number;
  pxPerMmY: number;
  phaseX: number;
  phaseY: number;
  confidence: number;
  /** One second of paper in px from the "+" second marks; no marks — field absent. */
  pxPerSecond?: number;
}

/** Predicted "+" lattice: columns at the second marks, rows every 10 mm. */
export interface PlusLattice {
  columnsX: number[];
  rowsY: number[];
}

export interface PageLayout {
  /** Layout variant; if the sheet is not recognized — the nearest by sheet height (default `'A'`). */
  variant: PageVariant;
  /** Inner frame area (`ProfileVariant.frame` convention); frame not found — the whole sheet. */
  frame: Rect;
  grid: GridEstimate;
  /** Profile zones shifted by the offset of the found frame relative to the profile one. */
  zones: Partial<Record<ZoneName, Rect>>;
  /** Expected baselines of the six leads (y, px) from the profile and the grid phase. */
  expectedBaselines: Six<number>;
  /** "+" lattice from the measured grid; no second marks — field absent. */
  plusLattice?: PlusLattice;
  confidence: number;
  /**
   * Codes (snake_case): `no_grid` (grid not found, the only code), `no_frame`, `format_mismatch`,
   * `grid_out_of_profile:<px/mm>` (the measurement stays, the profile is a warning), `variant_ambiguous`,
   * `exception:<message>`.
   */
  issues: string[];
}

// ---------------------------------------------------------------------------
// ink — ink and components
// ---------------------------------------------------------------------------

export interface InkComponent {
  id: number;
  bbox: Rect;
  area: number;
}

export interface InkMask {
  /** 0 — background, 255 — ink; size matches the source image. */
  mask: Uint8Array;
  width: number;
  height: number;
  components: InkComponent[];
  textComponents: InkComponent[];
  /** Centers of the "+" second marks. */
  plusMarks: Point[];
  /**
   * Ink pixel darkness (255 − brightness) where `mask` is non-zero, otherwise 0 (task 04) — for
   * subpixel estimates in `trace` without access to the grayscale image.
   */
  darkness?: Uint8Array;
  /** Step issue codes (task 04): `exception:<message>` — exception inside the step, mask is empty. */
  issues?: string[];
}

// ---------------------------------------------------------------------------
// trace — lead traces
// ---------------------------------------------------------------------------

export type UnreliableKind = 'gap' | 'ambiguous' | 'clipped';

/** Unreliable trace segment over sheet columns `[x0, x1]`. */
export interface UnreliableSpan {
  x0: number;
  x1: number;
  kind: UnreliableKind;
}

export interface LeadTrace {
  id: LeadId;
  /** Polyline over runs: any number of points per column, x non-decreasing. */
  points: Point[];
  baselineY: number;
  /** Share of plotter columns covered by the trace, 0..1. */
  coverage: number;
  /** Share of the lead's ink explained by the trace, 0..1. */
  explainedInk: number;
  unreliable: UnreliableSpan[];
  confidence: number;
  reasons: string[];
}

/** Manual separator between adjacent leads over `[x0, x1]` at level `y`. */
export interface TraceHint {
  x0: number;
  x1: number;
  y: number;
  above: LeadId;
  below: LeadId;
}

// ---------------------------------------------------------------------------
// digitize — signal in physical units
// ---------------------------------------------------------------------------

/**
 * Unreliable signal segment in samples `[i0, i1]` (carried over from the trace `UnreliableSpan`): `gap` — samples along
 * the polyline between the gap edges; `ambiguous` — position interpolated; `clipped` — samples equal the level of the
 * frame border the curve ran into (device saturation: amplitude is "at least this"), not `NaN`.
 */
export interface UnreliableSamples {
  i0: number;
  i1: number;
  kind: UnreliableKind;
}

/**
 * Lead signal (task 05). The time axis is shared by the six leads of a sheet: t = 0 at the left edge of the plot
 * area (`PageLayout.zones.plot.x`), x = plot.x + t · px/mm X · mm/s / 1000; all six `mv` have the same length —
 * up to the right edge of the area. Samples before the first and after the last trace point hold its edge values.
 * `mv` = −(y − `baselineY`) / (px/mm Y · mm/mV), baseline — `LeadTrace.baselineY`; drift is not subtracted.
 * A polyline peak between samples is written to the nearest sample (time ±1 ms), peaks are not lost.
 */
export interface LeadSignal {
  id: LeadId;
  /** Sampling rate, Hz — always 500. */
  fs: 500;
  /** Time of the first sample, ms — always 0. */
  t0: 0;
  mv: Float32Array;
  baselineY: number;
  confidence: number;
  unreliable: UnreliableSamples[];
  /**
   * Signal processing issue codes (task 06, snake_case): `filter_skipped:highpass` / `filter_skipped:lowpass` —
   * the filter is unstable at this sampling rate and was not applied. Filled by `filterSignal`; a raw `digitize`
   * signal has no such field.
   */
  issues?: string[];
}

// ---------------------------------------------------------------------------
// pagemeta — digits and header read from the sheet
// ---------------------------------------------------------------------------

export interface PrintedHr {
  value: number;
  /** Digit center by x, px. */
  x: number;
}

export interface TimeLabel {
  text: string;
  seconds: number;
  x: number;
}

export interface LeadLabel {
  id: LeadId;
  rect: Rect;
}

export interface PageMeta {
  /** Row of printed instantaneous HRs above lead I, left to right. */
  hrRow: PrintedHr[];
  /** Bottom RR row in ms (variant B only). */
  rrRowMs?: number[];
  footerHr?: number;
  footerCalib?: Calibration;
  timeLabels: TimeLabel[];
  leadLabels: LeadLabel[];
  /**
   * Crop of the left part of the header without the date/time prefix (from «ЭКГ …» (ECG …) to the end of the
   * `headerName` zone), binarized: 0 — ink, 255 — background. For comparing sheets of the same animal (Jaccard distance).
   */
  headerNameCrop: GrayImage;
  headerDate?: string;
  speciesLetter?: SpeciesLetter;
  /**
   * Reading confidence 0..1: mean over the sheet fields (HR row, time labels, lead labels, footer, date, species,
   * RR row for variant B), an unread field counts as 0. Always filled (`readPageMeta`, `placeholderPageResult`).
   */
  confidence: number;
  /** Reading issue codes (snake_case), e.g. `hr_row_empty`, `hr_number_unread:<x>`, `footer_calib_unread`. */
  issues: string[];
}

// ---------------------------------------------------------------------------
// page — a whole single sheet (seam 1)
// ---------------------------------------------------------------------------

/** Where the sheet calibration comes from: read from the footer, set by the user (`PageOptions.calib`) or default 50/10. */
export type CalibSource = 'footer' | 'manual' | 'default';

export interface PageOptions {
  /**
   * Manual calibration (INPUT-03): wins over the read footer and the 50/10 default; a mismatch with the read
   * footer is flagged in `PageResult.issues` with `calib_manual_overrides_footer:<mm/s>/<mm/mV>` (footer values).
   */
  calib?: Calibration;
  /** Manual lead separators from the user. */
  hints?: TraceHint[];
}

/** Sheet precision ceiling: one pixel in mV and in ms at the actual px/mm and calibration (0 if there is no grid). */
export interface PagePrecision {
  mvPerPx: number;
  msPerPx: number;
}

/**
 * Sheet result (task 05). `leads` and `signals` — six each in `LEAD_IDS` order (empty if a step failed).
 * `issues` (snake_case, no duplicates, root causes first): `exception:<step>:<message>` for
 * `layout | ink | trace | pagemeta | digitize:<lead>`; layout (`no_grid`, …) and ink codes as is;
 * trace reasons as `<reason>:<lead>` (`clipped:aVF`, `ambiguous:III`, `gap:II`, `unexplained_ink:I`,
 * `anchor_weak:III`; `coverage` explained by gap/clipped segments of the same trace is not repeated); sheet
 * reading codes as is (`hr_row_empty`, …); `lead_order_mismatch` — a pagemeta label sits at another trace's baseline;
 * `header_name_unanchored` — the header crop is not cut at «ЭКГ» (ECG), sheets cannot be compared by it;
 * `calib_manual_overrides_footer:<mm/s>/<mm/mV>` — manual calibration overrode the read footer with these values.
 * `confidence` = min(layout, mean over traces), ×0.5 on `lead_order_mismatch`, 0 on a step `exception:*`.
 */
export interface PageResult {
  layout: PageLayout;
  leads: LeadTrace[];
  signals: LeadSignal[];
  meta: PageMeta;
  calib: Calibration;
  calibSource: CalibSource;
  precision: PagePrecision;
  confidence: number;
  issues: string[];
}

// ---------------------------------------------------------------------------
// beats — beats and waves
// ---------------------------------------------------------------------------

export interface BeatLeadInfo {
  /** Position of R (or the dominant wave) in this lead, ms. */
  tMs: number;
  confidence: number;
}

export interface Beat {
  index: number;
  tMs: number;
  perLead: Partial<Record<LeadId, BeatLeadInfo>>;
  confidence: number;
  reasons: string[];
}

/**
 * Wave boundaries of a beat, ms from the signal start (may be fractional — tangent-method boundaries); `null` — not found.
 * `reasons` (task 06, snake_case): `no_signal`, `qrs_not_found`, `qrs_too_wide`, `p_not_found`, `t_not_found`,
 * `unreliable_segment` (wave inside clipped/gap — amplitudes there are not signal), `t_window_truncated`.
 */
export interface Delineation {
  pOn: number | null;
  pOff: number | null;
  pFound: boolean;
  qOn: number | null;
  rPeak: number | null;
  sPeak: number | null;
  sOff: number | null;
  tPeak: number | null;
  tOff: number | null;
  confidence: number;
  reasons?: string[];
}

/**
 * Check of the detected beats against the printed HR digits (task 06). The k-th digit is matched to the interval
 * between adjacent beats by x: the digit sits above the middle of the interval. `matched` — digits that agree within
 * ±3 bpm; `mismatches` — digits that have an interval below them but the HR differs; `unmatched` — digits with no
 * interval below them (edge ones: one of the interval's beats is beyond the sheet edge or cut by the frame). `beats` —
 * a copy of the beats with reasons `printed_hr_mismatch` / `printed_hr_unverified` and adjusted confidence.
 */
export interface RhythmCheck {
  matched: number;
  mismatches: { k: number; printed: number; measured: number }[];
  unmatched?: number[];
  beats?: Beat[];
}

// ---------------------------------------------------------------------------
// measure — measurements
// ---------------------------------------------------------------------------

export type MeasurementKey =
  | 'hrMean'
  | 'hrMin'
  | 'hrMax'
  | 'pDuration'
  | 'pAmplitude'
  | 'pq'
  | 'q'
  | 'qrs'
  | 'r'
  | 's'
  | 'qt'
  | 'qtc'
  | 't'
  | 'st';

/**
 * Where the RR intervals for HR come from (task 07): `lead_ii` — R peaks in II (`Beat.perLead.II.tMs`);
 * `all_leads` — lead consensus (`Beat.tMs`), when II is missing or unreliable on at least one sheet.
 */
export type MeasurementSource = 'lead_ii' | 'all_leads';

export interface MeasuredValue {
  /** `null` — measurement unavailable (see `reason`). */
  value: number | null;
  unit: string;
  confidence: number;
  /**
   * Indices of the beats the value was taken from. For several sheets — indices in the merged array
   * (`mergeBeats` of the `measure` module: sheets in order, within a sheet — by time).
   */
  beats: number[];
  reason?: string;
  /** RR source (only for `hrMean`/`hrMin`/`hrMax`). */
  source?: MeasurementSource;
}

export type Measurements = Record<MeasurementKey, MeasuredValue>;

/**
 * Beats of one sheet as input to `measurePages` / `analyzeRhythmPages` (task 07). `beats[k]` is delineated by
 * `delineations[k]` (delineation is on the filtered II, as `delineate` requires); beat `tMs` is on the sheet scale,
 * on the case scale it is `offsetMs + tMs`. `signals` — raw sheet signals (`PageResult.signals`): amplitudes and areas
 * are taken from the raw signal relative to the local baseline, no filter is applied inside. RR across a sheet
 * boundary is not computed: the detector does not count edge complexes, and such an interval almost always spans a missed beat.
 */
export interface PageBeats {
  /** Sheet number in the case (as `case` knows it), used in the reverse index mapping. */
  page: number;
  /** Offset of the sheet start on the case scale, ms. */
  offsetMs: number;
  beats: Beat[];
  delineations: Delineation[];
  signals: LeadSignal[];
  /** Sheet precision ceiling — the "wave not expressed" threshold (2 px); absent — variant A default at 50/10. */
  precision?: PagePrecision;
}

// ---------------------------------------------------------------------------
// rhythm — rhythm, axis, arrhythmias
// ---------------------------------------------------------------------------

/**
 * Rhythm type (AXIS-02). Sinus arrhythmia is a separate flag `RhythmReport.sinusArrhythmia` (single source of
 * truth, task 01 review); tachy-/bradycardia is an HR norm verdict in the conclusion, not a rhythm type.
 */
export type RhythmType = 'sinus' | 'non_sinus' | 'undetermined';

export type EctopicKind = 'SVE' | 'VE';

export interface Ectopic {
  beat: number;
  kind: EctopicKind;
  focus: string;
  couplingMs: number;
}

export interface Episode {
  startMs: number;
  durationMs: number;
  kind: string;
  focus: string;
  couplingMs: number;
  beats: number[];
}

export interface RhythmReport {
  type: RhythmType;
  reasons: string[];
  /** Electrical axis, degrees; `null` — not determined. */
  axisDeg: number | null;
  sinusArrhythmia: boolean;
  ectopics: Ectopic[];
  episodes: Episode[];
  /**
   * Pauses (task 13): RR ≥ 2 × median RR within a sheet. A pause removes the sinus arrhythmia verdict —
   * the conclusion names the pause in a separate phrase «требует проверки специалистом» ("requires specialist review").
   */
  pauses?: Pause[];
}

/** Rhythm pause: from beat `beat − 1` to beat `beat` (global indices), start — the moment of the previous beat. */
export interface Pause {
  beat: number;
  startMs: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// norms — reference tables
// ---------------------------------------------------------------------------

export type NormClass = 'norm' | 'border' | 'abnormal' | 'n/a';

/** Reference table row key: a measurement or the electrical axis (`RhythmReport.axisDeg`). */
export type NormKey = MeasurementKey | 'axis';

/**
 * The "unreliable" threshold for lead, beat and measurement confidence (specification §6) —
 * the single place; a value with `confidence < UNRELIABLE_BELOW` does not enter the conclusion as a number.
 */
export const UNRELIABLE_BELOW = 0.6;

export interface NormRange {
  min?: number;
  max?: number;
  /**
   * Borderline zones — classified as `border`: `[borderMin, min)` and `(max, borderMax]`.
   * Not set — ±10 % outward from the norm bound.
   */
  borderMin?: number;
  borderMax?: number;
  unit: string;
  source: string;
  /**
   * Source of an explicit borderline zone (`borderMin`/`borderMax`, task 13): a literature code or «ПРОЕКТ» ("PROJECT")
   * for project conventions that the sources do not state. The implicit ±10 % zone is always a project convention.
   */
  borderSource?: string;
  /** Classify by the absolute value (Q, T in dogs — any sign). */
  abs?: boolean;
  /** Out of bounds is only `border`, never `abnormal` ("deep Q" is breed-dependent). */
  borderOnly?: boolean;
  /** Relative rule |value| ≤ fraction × R (T in dogs: 0.25); R is passed in the `classify` context. */
  maxFractionOfR?: number;
  /** A negative value is no lower than `border` (T in cats is "usually positive"). */
  negativeIsBorder?: boolean;
  /** Note on the norm for the table and the document («при нормальной ЧСС», "at normal HR"). */
  note?: string;
}

/** Rhythm and arrhythmia thresholds from the reference; owner — `norms`, consumers — `rhythm` and `conclusion`. */
export interface RhythmThresholds {
  /** Sinus arrhythmia: RR variation above the fraction or spread of adjacent RR not less than `rrDeltaS`. */
  sinusArrhythmia: { rrVariation: number; rrDeltaS: number; normalForSpecies: boolean; source: string };
  /** Prematurity: RR < (1 − fraction) × median RR. */
  prematurity: { fraction: number; source: string };
  /** "Wide" QRS of a ventricular ectopic beat, s; `confidentS` — confidently wide. */
  wideQrs: { s: number; confidentS: number; source: string };
}

export interface NormTable {
  species: Species;
  dogSize?: DogSize;
  params: Partial<Record<NormKey, NormRange>>;
  /** Always filled by `getNorms`; optional only for the sake of `NormTable` literals in other modules' tests. */
  thresholds?: RhythmThresholds;
}

// ---------------------------------------------------------------------------
// conclusion — conclusion text
// ---------------------------------------------------------------------------

export interface ConclusionRow {
  key: MeasurementKey | string;
  label: string;
  value: string;
  norm: string;
  verdict: NormClass;
  /** Row note («ненадёжно: …» "unreliable: …", «глубокий Q — породозависим» "deep Q — breed-dependent"). */
  note?: string;
}

export interface Conclusion {
  table: ConclusionRow[];
  text: string;
}

/** Known conclusion flags for `ConclusionInputs.flags`; unknown strings are ignored. */
export type ConclusionFlag = 'manual_correction' | 'precision_ceiling' | 'analyze_together_forced';

export interface ConclusionInputs {
  species: Species;
  dogSize?: DogSize;
  drugs: string;
  monitoringMinutes?: number;
  flags: string[];
}

// ---------------------------------------------------------------------------
// case — a case from sheets (seam 2)
// ---------------------------------------------------------------------------

export interface CaseSettings {
  species: Species;
  dogSize?: DogSize;
  calib?: Calibration;
  drugs: string;
  monitoringMinutes?: number;
  analyzeTogether: boolean;
}

/** Wave boundary the vet moves manually (VIS-03): P onset/offset, QRS onset, QRS end (S), T end. */
export type MarkerField = 'pOn' | 'pOff' | 'qOn' | 'sOff' | 'tOff';

/**
 * Manual user edits on top of the automatic result (final set of kinds — task 09, specification
 * "Visualization and edits"). Sheet numbers are indices in the `analyzeCase` input array; time — ms on the sheet scale.
 * - `separator` — separator between adjacent leads over a segment: the sheet is re-traced with a hint;
 * - `baseline` — manual baseline of a sheet lead (px): the signal is re-digitized from it;
 * - `leadLabel` — the trace auto-labelled as `lead` is actually lead `as` (`null` — "no lead":
 *   the slot stays, the signal is empty);
 * - `marker` — a wave boundary of complex `beat` (sheet beat index) moved to `tMs`; other complexes are untouched;
 * - `calibration` — manual calibration of sheet `page` or of all sheets (no `page`); stronger than the footer and `CaseSettings.calib`.
 *   `pxPerMm` (task 11, story 17) — sheet scale set by the vet with two clicks on the "+" second marks (50 mm) or
 *   nodes of the 5-mm dotted line, px/mm per axis; replaces the measured grid (`PageLayout.grid.pxPerMmX/Y`) in
 *   digitization and in the precision ceiling. No field — the sheet grid as is.
 */
export type Edit =
  | { kind: 'separator'; page: number; hint: TraceHint }
  | { kind: 'baseline'; page: number; lead: LeadId; y: number }
  | { kind: 'leadLabel'; page: number; lead: LeadId; as: LeadId | null }
  | { kind: 'marker'; page: number; beat: number; field: MarkerField; tMs: number }
  | { kind: 'calibration'; page?: number; calib: Calibration; pxPerMm?: { x: number; y: number } };

/** Sheet recording time interval from the time labels, recording seconds (`startS` — left edge of the plot area). */
export interface RecordSpan {
  startS: number;
  endS: number;
}

/**
 * Order of the case sheets (task 09). `order` — canonical sheets (no duplicates) by group, within a group by recording
 * time; `groups` — sheets of the same animal (indices in the input array); `duplicates` — byte-identical copies
 * (`[original, copy, …]`); `overlaps` — `b` repeats the time interval of counted sheet `a` of the same group.
 * `issues` (snake_case): `multiple_animals`, `order_unknown`, `duplicate:<i>`, `overlap:<b>`, `animal_unverified:<i>`
 * (sheet header not anchored — animal ownership not verified, the sheet is kept in the group by upload order).
 */
export interface PageOrder {
  order: number[];
  groups: number[][];
  duplicates: number[][];
  overlaps: { a: number; b: number }[];
  issues: string[];
  /** Recording time of each sheet from the labels; labels not read — `undefined`. */
  spans?: (RecordSpan | undefined)[];
}

export interface CaseResult {
  measurements: Measurements;
  rhythm: RhythmReport;
  conclusion: Conclusion;
  confidence: number;
  perPage: PageResult[];
  /**
   * Total duration of the analyzed recording: `durationMs` — sum of durations of the counted sheets (without
   * duplicates and interval repeats), `pages` — their count; `coveredMs` — recording coverage from the start of the first
   * to the end of the last counted sheet by time labels (there may be gaps between sheets), `minutes` — the same in minutes,
   * prefill for monitoring minutes (A04); without labels — by the sum of durations.
   */
  span: { durationMs: number; pages: number; coveredMs?: number; minutes?: number };
  /** Order, groups, duplicates and repeats of sheets (task 09). */
  order?: PageOrder;
  /** Indices of the counted sheets in analysis order (`perPage` indices). */
  analyzed?: number[];
  /** Beats of the counted sheets with offsets on the case scale — for the overlay and cross-checking. */
  beats?: PageBeats[];
  /** Conclusion flags (`ConclusionFlag`): `manual_correction`, `precision_ceiling`, `analyze_together_forced`. */
  flags?: string[];
  /**
   * Case codes (snake_case): `PageOrder.issues` codes; `pages_excluded:<i>` — a sheet of another animal is not counted;
   * `edit_skipped:<kind>:<sheet>` — edit not applied (no image for re-tracing, no such sheet/beat);
   * `lead_label_conflict:<lead>` — two traces reassigned to the same lead, the last one wins.
   */
  issues?: string[];
}
