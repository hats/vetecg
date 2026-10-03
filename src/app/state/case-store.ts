/**
 * Application state: cases built from sheets (decisions §5, stories 1–15, 30, 66). A pure store without DOM — tested
 * in Node; sheet recognition comes via `deps.analyzeSheet` (in the app — the worker pool), the case is computed by
 * `analyzeCase` on the main thread from already finished `PageResult`s (changing species, calibration, minutes, edits
 * needs no re-recognition).
 *
 * Sheets (`Sheet`) are kept in load order; manually reordering thumbnails changes that order, and for groups without
 * a read time (`order_unknown`) it also becomes the case order (agreement from the task 09 review).
 * Only finished sheets (`status === 'done'`) go into `analyzeCase`: `caseSheets[i]` is the id of the sheet with index `i`
 * in the input array, and all `<i>` codes of the result (`duplicate`, `overlap`, `animal_unverified`, `pages_excluded`)
 * are read through this map. A byte-identical duplicate (same hash) is not recognized a second time: it gets the
 * original's result and the same hash, and `orderPages` excludes it from the analysis.
 *
 * Settings sources are stored next to the values: species — `manual | header | default` (hint from the «с»/«к» letter
 * in headers; a manual choice wins and is not reset by new sheets), calibration — `manual | footer | default` (manual
 * goes to `CaseSettings.calib`, sheets get `calibSource 'manual'`), monitoring minutes — `manual | pages`
 * (from sheets: the result's `span.minutes`; the conclusion is rebuilt by `compose` with this value).
 *
 * Multiple animals (`multiple_animals`): a dialog with sheet groups; «вместе» (together) — `analyzeTogether`,
 * «убрать» (remove) — sheets outside the primary group (largest, first on a tie — as in `analyzeCase`) are removed,
 * «разделить» (split) — each other group becomes a separate case (tab). A postponed dialog does not pop up again for
 * the same group composition.
 *
 * Edits (`Edit`) are stored bound to the sheet id and reindexed into `page` on every recompute; the public
 * `CaseState.edits` is already in indices of the current `caseSheets`.
 */
import type {
  Calibration,
  CaseResult,
  CaseSettings,
  DogSize,
  Edit,
  GrayImage,
  PageOptions,
  PageResult,
  Species,
} from '../../types/contracts';
import { DEFAULT_CALIBRATION } from '../../types/contracts';
import { analyzeCase as analyzeCaseDefault, recordSpan, type CaseOptions } from '../../analysis/case';
import { compose } from '../../analysis/conclusion';
import { fileProblemMessage, type FileProblem } from '../files/classify';
import { PageAnalysisFailed, type AnalyzeEvents } from '../worker/pool';

export type SheetStatus = 'queued' | 'analyzing' | 'done' | 'error';

/** Prepared file: bytes read and hashed, image decoded (or a file problem found). */
export interface SheetInput {
  name: string;
  /** File byte hash (`hashBytes`) — byte-identical duplicates. */
  hash: string;
  /** File problem (not an image, PDF, corrupt, too narrow) — the sheet is immediately in the «ошибка» (error) state. */
  problem?: FileProblem;
  image?: GrayImage;
  /** Object URL of the source file — color raster for the overlay (revoked on «Новый случай» / new case). */
  imageUrl?: string;
  /** Downscaled copy for the strip (data URL). */
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

export interface Sheet extends SheetInput {
  id: string;
  status: SheetStatus;
  /** Error text in Russian (`status === 'error'`). */
  error?: string;
  /** Number of the current/last recognition attempt (1…3). */
  attempt: number;
  /** Automatic sheet result (without edits); the edited one is `CaseState.result.perPage[i]`. */
  result?: PageResult;
  /** Original's id if the sheet is a byte-identical duplicate. */
  duplicateOf?: string;
  /** Time from enqueueing to result, ms (including waiting for a free worker). */
  elapsedMs?: number;
  /** Net time of the last recognition attempt in the worker, ms. */
  analysisMs?: number;
}

export type SpeciesSource = 'manual' | 'header' | 'default';
export type CalibrationSource = 'manual' | 'footer' | 'default';
export type MinutesSource = 'manual' | 'pages';

export interface CaseSettingsUi {
  species: Species;
  speciesSource: SpeciesSource;
  dogSize?: DogSize;
  calib: Calibration;
  calibSource: CalibrationSource;
  drugs: string;
  monitoringMinutes?: number;
  minutesSource: MinutesSource;
  analyzeTogether: boolean;
}

export type AnimalsDecision = 'split' | 'remove' | 'together' | 'dismiss';

export interface AnimalsDialog {
  /** Sheet groups (ids) of one animal each — like `PageOrder.groups`, the first is primary. */
  groups: string[][];
  /** Group composition key — so a postponed dialog does not pop up again. */
  key: string;
}

export interface CaseState {
  id: string;
  title: string;
  /** Sheets in load / manual reorder order. */
  sheets: Sheet[];
  settings: CaseSettingsUi;
  /** Edits in indices of the current `caseSheets`. */
  edits: Edit[];
  result?: CaseResult;
  /** Sheet id for each index of the `analyzeCase` input array (= `result.perPage`). */
  caseSheets: string[];
  activeSheetId?: string;
  /** Case warnings in Russian. */
  warnings: string[];
  dialog?: AnimalsDialog;
  /** Group composition key for which a decision was already made or postponed. */
  animalsDecisionKey?: string;
}

export interface Progress {
  total: number;
  done: number;
  running: number;
  queued: number;
  failed: number;
}

export interface AppState {
  phase: 'empty' | 'case';
  cases: CaseState[];
  activeCaseId: string;
  /** Increments on every change — subscribers may skip redundant renders. */
  version: number;
  progress: Progress;
}

export interface CaseStoreDeps {
  /** Sheet recognition (worker pool); rejects with `PageAnalysisFailed` after all attempts. */
  analyzeSheet(image: GrayImage, options: PageOptions | undefined, events: AnalyzeEvents): Promise<PageResult>;
  analyzeCase?: (pages: PageResult[], settings: CaseSettings, edits: Edit[], options?: CaseOptions) => CaseResult;
  now?: () => number;
  /** Releases a sheet's object URL when the case is reset. */
  revokeUrl?: (url: string) => void;
}

export interface CaseStore {
  getState(): AppState;
  subscribe(listener: (state: AppState) => void): () => void;
  /** Resolves when no sheet is being recognized or waiting in the queue. */
  whenIdle(): Promise<void>;

  /** Adds sheets to the active case and starts recognition; returns the sheet ids. */
  addSheets(inputs: SheetInput[]): string[];
  removeSheets(ids: string[]): void;
  /** Moves a sheet before `beforeId` (to the end when `null`). */
  reorderSheets(sheetId: string, beforeId: string | null): void;
  setActiveSheet(sheetId: string): void;

  /** `null` — automatic, from sheet headers. */
  setSpecies(species: Species | null): void;
  setDogSize(size: DogSize | undefined): void;
  /** `null` — automatic (sheet footer, otherwise 50/10). */
  setCalibration(calib: Calibration | null): void;
  setDrugs(text: string): void;
  /** `null` — from sheets. */
  setMonitoringMinutes(minutes: number | null): void;
  setAnalyzeTogether(on: boolean): void;
  resolveAnimals(decision: AnimalsDecision): void;

  /** Edit in indices of the current `caseSheets` (`Edit.page`); for a nonexistent sheet the edit is ignored. */
  addEdit(edit: Edit): void;
  setEdits(edits: Edit[]): void;
  resetEdits(): void;

  selectCase(caseId: string): void;
  /** Resets the whole state to the empty screen. */
  newCase(): void;
}

export const RECOGNITION_FAILED_MESSAGE = 'Ошибка распознавания, лист пропущен';

const SPECIES_BY_LETTER: Record<string, Species> = { с: 'dog', к: 'cat' };

const validCalibration = (c: Calibration | undefined): c is Calibration => c !== undefined && c.mmPerS > 0 && c.mmPerMv > 0;
const calibKey = (c: Calibration): string => `${c.mmPerS}/${c.mmPerMv}`;
const roundTo = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;

interface SheetEdit {
  /** `null` — an edit without a sheet (calibration of all sheets). */
  sheetId: string | null;
  edit: Edit;
}

/** Species hint from header letters of finished sheets. */
export function speciesHint(pages: readonly PageResult[]): { species?: Species; mixed: boolean } {
  const letters = pages.map((p) => p.meta.speciesLetter).filter((l): l is NonNullable<typeof l> => l !== undefined);
  const kinds = [...new Set(letters.map((l) => SPECIES_BY_LETTER[l]).filter((s): s is Species => s !== undefined))];
  return { species: kinds[0], mixed: kinds.length > 1 };
}

/** Calibration from footers of finished sheets: the first one read; `mismatch` — sheet footers differ. */
export function footerHint(pages: readonly PageResult[]): { calib?: Calibration; mismatch: boolean; variants: string[] } {
  const found = pages.map((p) => p.meta.footerCalib).filter(validCalibration);
  const variants = [...new Set(found.map(calibKey))];
  return { calib: found[0], mismatch: variants.length > 1, variants };
}

function defaultSettings(): CaseSettingsUi {
  return {
    species: 'dog',
    speciesSource: 'default',
    calib: { ...DEFAULT_CALIBRATION },
    calibSource: 'default',
    drugs: '',
    minutesSource: 'pages',
    analyzeTogether: false,
  };
}

export function activeCase(state: AppState): CaseState {
  const found = state.cases.find((c) => c.id === state.activeCaseId);
  if (!found) throw new Error('Нет активного случая');
  return found;
}

/** Strip order: canonical sheets in case order, each followed by its duplicates, then the rest (queued, errors). */
export function displayOrder(c: CaseState): Sheet[] {
  const byId = new Map(c.sheets.map((s) => [s.id, s]));
  const placed = new Set<string>();
  const out: Sheet[] = [];
  const push = (sheet: Sheet | undefined): void => {
    if (sheet && !placed.has(sheet.id)) {
      placed.add(sheet.id);
      out.push(sheet);
    }
  };
  if (c.result?.order) {
    for (const i of c.result.order.order) {
      const id = c.caseSheets[i];
      push(byId.get(id));
      for (const sheet of c.sheets) if (sheet.duplicateOf === id) push(sheet);
    }
  }
  for (const sheet of c.sheets) push(sheet);
  return out;
}

/** Sheet badges in the strip from case codes: «дубликат», «повтор интервала», «не учтён», unverified header. */
export function sheetBadges(c: CaseState, sheetId: string): string[] {
  const sheet = c.sheets.find((s) => s.id === sheetId);
  if (!sheet) return [];
  const badges: string[] = [];
  const i = c.caseSheets.indexOf(sheetId);
  const issues = c.result?.issues ?? [];
  if (sheet.duplicateOf !== undefined || issues.includes(`duplicate:${i}`)) badges.push('дубликат');
  if (i >= 0) {
    if (issues.includes(`overlap:${i}`)) badges.push('повтор интервала');
    if (issues.includes(`pages_excluded:${i}`)) badges.push('не учтён: другое животное');
    if (issues.includes(`animal_unverified:${i}`)) badges.push('шапка не прочитана — принадлежность животному не проверена');
  }
  return badges;
}

const clock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Read recording time of the sheet as «мм:сс–мм:сс» (mm:ss–mm:ss); marks not read — `undefined`. */
export function sheetTimeText(c: CaseState, sheetId: string): string | undefined {
  const sheet = c.sheets.find((s) => s.id === sheetId);
  if (!sheet?.result) return undefined;
  const span = recordSpan(sheet.result);
  return span ? `${clock(span.startS)}–${clock(span.endS)}` : undefined;
}

/** Primary group — as `analyzeCase` picks it: the largest, the first on a tie. */
function primaryGroup<T>(groups: T[][]): T[] {
  return groups.reduce((best, g) => (g.length > best.length ? g : best), groups[0] ?? []);
}

/**
 * Animal groups as sheet ids, primary first. Primary is the one whose sheets `analyzeCase` counted (`result.analyzed`);
 * a single source both for the dialog caption and for the «убрать»/«разделить» (remove/split) actions. With joint
 * analysis — as in `analyzeCase`.
 */
function animalGroups(c: CaseState): string[][] {
  const order = c.result?.order;
  if (!order) return [];
  const analyzed = new Set(c.result?.analyzed ?? []);
  const groups = order.groups.map((g) => g.map((i) => c.caseSheets[i]));
  let primary = c.settings.analyzeTogether ? -1 : order.groups.findIndex((g) => g.some((i) => analyzed.has(i)));
  if (primary < 0) primary = order.groups.indexOf(primaryGroup(order.groups));
  if (primary > 0) groups.unshift(...groups.splice(primary, 1));
  return groups;
}

const groupsKey = (groups: string[][]): string => groups.map((g) => g.join(',')).join('|');

export function createCaseStore(deps: CaseStoreDeps): CaseStore {
  const analyzeCase = deps.analyzeCase ?? analyzeCaseDefault;
  const now = deps.now ?? (() => Date.now());
  const listeners = new Set<(state: AppState) => void>();
  const sheetEdits = new Map<string, SheetEdit[]>();
  let sheetCounter = 0;
  let caseCounter = 0;
  let inFlight = 0;
  let idleWaiters: (() => void)[] = [];

  const emptyCase = (settings?: CaseSettingsUi): CaseState => {
    caseCounter++;
    const c: CaseState = {
      id: `case-${caseCounter}`,
      title: `Случай ${caseCounter}`,
      sheets: [],
      settings: settings ?? defaultSettings(),
      edits: [],
      caseSheets: [],
      warnings: [],
    };
    sheetEdits.set(c.id, []);
    return c;
  };

  const first = emptyCase();
  const state: AppState = {
    phase: 'empty',
    cases: [first],
    activeCaseId: first.id,
    version: 0,
    progress: { total: 0, done: 0, running: 0, queued: 0, failed: 0 },
  };

  const current = (): CaseState => activeCase(state);
  const caseOf = (sheet: Sheet): CaseState | undefined => state.cases.find((c) => c.sheets.includes(sheet));

  const refreshProgress = (): void => {
    const progress: Progress = { total: 0, done: 0, running: 0, queued: 0, failed: 0 };
    for (const c of state.cases) {
      for (const s of c.sheets) {
        if (s.problem || s.duplicateOf !== undefined) continue;
        progress.total++;
        if (s.status === 'done') progress.done++;
        else if (s.status === 'analyzing') progress.running++;
        else if (s.status === 'queued') progress.queued++;
        else progress.failed++;
      }
    }
    state.progress = progress;
    state.phase = state.cases.some((c) => c.sheets.length > 0) ? 'case' : 'empty';
  };

  const emit = (): void => {
    refreshProgress();
    state.version++;
    for (const listener of listeners) listener(state);
  };

  const settleIdle = (): void => {
    if (inFlight > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  /** Case edits in indices of finished sheets; edits on removed sheets are dropped. */
  const reindexEdits = (c: CaseState): Edit[] => {
    const out: Edit[] = [];
    for (const { sheetId, edit } of sheetEdits.get(c.id) ?? []) {
      if (sheetId === null) {
        out.push(edit);
        continue;
      }
      const page = c.caseSheets.indexOf(sheetId);
      if (page >= 0) out.push({ ...edit, page } as Edit);
    }
    return out;
  };

  const recompute = (c: CaseState): void => {
    const ready = c.sheets.filter((s) => s.status === 'done' && s.result !== undefined);
    c.caseSheets = ready.map((s) => s.id);
    const pages = ready.map((s) => s.result as PageResult);
    const warnings: string[] = [];

    const species = speciesHint(pages);
    if (c.settings.speciesSource !== 'manual') {
      c.settings.species = species.species ?? 'dog';
      c.settings.speciesSource = species.species ? 'header' : 'default';
    }
    if (species.mixed) warnings.push('На листах разные буквы вида («с» и «к») — проверьте, одно ли это животное, и выберите вид вручную');

    const footer = footerHint(pages);
    if (c.settings.calibSource !== 'manual') {
      c.settings.calib = footer.calib ? { ...footer.calib } : { ...DEFAULT_CALIBRATION };
      c.settings.calibSource = footer.calib ? 'footer' : 'default';
    }
    if (footer.mismatch) warnings.push(`Калибровка в футерах листов различается (${footer.variants.join('; ')} мм/с / мм/мВ) — проверьте листы или задайте калибровку вручную`);

    if (pages.length === 0) {
      c.result = undefined;
      c.edits = [];
      c.dialog = undefined;
      c.warnings = warnings;
      if (c.settings.minutesSource === 'pages') c.settings.monitoringMinutes = undefined;
      return;
    }

    const edits = reindexEdits(c);
    const settings: CaseSettings = {
      species: c.settings.species,
      dogSize: c.settings.species === 'dog' ? c.settings.dogSize : undefined,
      calib: c.settings.calibSource === 'manual' ? c.settings.calib : undefined,
      drugs: c.settings.drugs,
      monitoringMinutes: c.settings.minutesSource === 'manual' ? c.settings.monitoringMinutes : undefined,
      analyzeTogether: c.settings.analyzeTogether,
    };
    let result = analyzeCase(pages, settings, edits, { hashes: ready.map((s) => s.hash), images: ready.map((s) => s.image) });
    if (c.settings.minutesSource === 'pages') {
      const minutes = roundTo(result.span.minutes ?? result.span.durationMs / 60000, 1);
      c.settings.monitoringMinutes = minutes;
      const conclusion = compose(result, { ...settings, monitoringMinutes: minutes, flags: result.flags ?? [] });
      result = { ...result, conclusion };
    }
    c.result = result;
    c.edits = edits;

    const issues = result.issues ?? [];
    if (issues.includes('order_unknown')) warnings.push('Порядок листов не прочитан — листы идут в порядке загрузки; переставьте миниатюры вручную');
    c.dialog = undefined;
    if (issues.includes('multiple_animals')) {
      const groups = animalGroups(c);
      const key = groupsKey(groups);
      // Dialog only once all sheets are recognized: while the queue runs, group composition changes with every sheet.
      const busy = c.sheets.some((s) => s.status === 'queued' || s.status === 'analyzing');
      if (c.settings.analyzeTogether) warnings.push('Листы разных животных анализируются вместе — заключение несёт пометку');
      else {
        warnings.push('Среди листов — другое животное: учтена главная группа, остальные листы не учтены');
        if (!busy && key !== c.animalsDecisionKey) c.dialog = { groups, key };
      }
    }
    if (c.activeSheetId === undefined || !c.sheets.some((s) => s.id === c.activeSheetId)) c.activeSheetId = c.sheets[0]?.id;
    c.warnings = warnings;
  };

  /** Duplicates inherit the original's state (same file — same result). */
  const propagate = (c: CaseState, original: Sheet): void => {
    for (const dup of c.sheets) {
      if (dup.duplicateOf !== original.id) continue;
      dup.status = original.status;
      dup.result = original.result;
      dup.error = original.error;
      dup.attempt = original.attempt;
      dup.elapsedMs = original.elapsedMs;
      dup.analysisMs = original.analysisMs;
    }
  };

  const alive = (sheet: Sheet): boolean => caseOf(sheet) !== undefined;

  async function runSheet(sheet: Sheet): Promise<void> {
    const image = sheet.image;
    if (!image) return;
    const started = now();
    let attemptStarted = started;
    inFlight++;
    try {
      const result = await deps.analyzeSheet(image, undefined, {
        onAttempt: (attempt) => {
          if (!alive(sheet)) return;
          attemptStarted = now();
          sheet.attempt = attempt;
          sheet.status = 'analyzing';
          emit();
        },
      });
      if (alive(sheet)) {
        sheet.result = result;
        sheet.status = 'done';
        sheet.error = undefined;
        sheet.analysisMs = now() - attemptStarted;
      }
    } catch (error: unknown) {
      if (alive(sheet)) {
        sheet.status = 'error';
        sheet.error = RECOGNITION_FAILED_MESSAGE;
        if (error instanceof PageAnalysisFailed && error.attempts > 0) sheet.attempt = error.attempts;
        console.error(`Лист «${sheet.name}» не распознан:`, error instanceof Error ? error.message : error);
      }
    } finally {
      inFlight--;
    }
    const c = caseOf(sheet);
    if (c) {
      sheet.elapsedMs = now() - started;
      propagate(c, sheet);
      recompute(c);
      emit();
    }
    settleIdle();
  }

  const removeFrom = (c: CaseState, ids: readonly string[]): void => {
    const removing = new Set(ids);
    // Duplicates of removed sheets go with them; remaining duplicates of a removed original get a new original.
    for (const s of c.sheets) if (s.duplicateOf !== undefined && removing.has(s.duplicateOf) && !removing.has(s.id)) promote(c, s, removing);
    const removed = c.sheets.filter((s) => removing.has(s.id));
    c.sheets = c.sheets.filter((s) => !removing.has(s.id));
    for (const s of removed) if (s.imageUrl) deps.revokeUrl?.(s.imageUrl);
    sheetEdits.set(c.id, (sheetEdits.get(c.id) ?? []).filter((e) => e.sheetId === null || !removing.has(e.sheetId)));
  };

  const promote = (c: CaseState, dup: Sheet, removing: Set<string>): void => {
    const oldOriginal = dup.duplicateOf as string;
    dup.duplicateOf = undefined;
    for (const other of c.sheets) if (other !== dup && other.duplicateOf === oldOriginal && !removing.has(other.id)) other.duplicateOf = dup.id;
    if (dup.status !== 'done' && dup.image) {
      dup.status = 'queued';
      dup.attempt = 0;
      void runSheet(dup);
    }
  };

  const store: CaseStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    whenIdle() {
      if (inFlight === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },

    addSheets(inputs) {
      const c = current();
      const ids: string[] = [];
      const jobs: Sheet[] = [];
      for (const input of inputs) {
        sheetCounter++;
        const sheet: Sheet = { ...input, id: `sheet-${sheetCounter}`, status: 'queued', attempt: 0 };
        if (input.problem) {
          sheet.status = 'error';
          sheet.error = fileProblemMessage(input.problem);
        } else {
          const original = c.sheets.find((s) => s.hash === input.hash && !s.problem && s.duplicateOf === undefined);
          if (original) {
            sheet.duplicateOf = original.id;
            sheet.status = original.status;
            sheet.result = original.result;
            sheet.error = original.error;
            sheet.attempt = original.attempt;
            sheet.elapsedMs = original.elapsedMs;
          } else if (sheet.image) jobs.push(sheet);
          else {
            sheet.status = 'error';
            sheet.error = fileProblemMessage({ kind: 'corrupt' });
          }
        }
        c.sheets.push(sheet);
        ids.push(sheet.id);
        if (c.activeSheetId === undefined) c.activeSheetId = sheet.id;
      }
      recompute(c);
      emit();
      for (const sheet of jobs) void runSheet(sheet);
      return ids;
    },

    removeSheets(ids) {
      const c = current();
      removeFrom(c, ids);
      recompute(c);
      emit();
    },

    reorderSheets(sheetId, beforeId) {
      const c = current();
      const moving = c.sheets.find((s) => s.id === sheetId);
      if (!moving || sheetId === beforeId) return;
      const rest = c.sheets.filter((s) => s.id !== sheetId);
      const at = beforeId === null ? rest.length : rest.findIndex((s) => s.id === beforeId);
      rest.splice(at < 0 ? rest.length : at, 0, moving);
      c.sheets = rest;
      recompute(c);
      emit();
    },

    setActiveSheet(sheetId) {
      const c = current();
      if (!c.sheets.some((s) => s.id === sheetId)) return;
      c.activeSheetId = sheetId;
      emit();
    },

    setSpecies(species) {
      const c = current();
      if (species === null) c.settings.speciesSource = 'default';
      else {
        c.settings.species = species;
        c.settings.speciesSource = 'manual';
      }
      recompute(c);
      emit();
    },

    setDogSize(size) {
      const c = current();
      c.settings.dogSize = size;
      recompute(c);
      emit();
    },

    setCalibration(calib) {
      const c = current();
      if (calib === null) c.settings.calibSource = 'default';
      else if (validCalibration(calib)) {
        c.settings.calib = { ...calib };
        c.settings.calibSource = 'manual';
      } else return;
      recompute(c);
      emit();
    },

    setDrugs(text) {
      const c = current();
      c.settings.drugs = text;
      recompute(c);
      emit();
    },

    setMonitoringMinutes(minutes) {
      const c = current();
      if (minutes === null || !Number.isFinite(minutes) || minutes < 0) c.settings.minutesSource = 'pages';
      else {
        c.settings.monitoringMinutes = minutes;
        c.settings.minutesSource = 'manual';
      }
      recompute(c);
      emit();
    },

    setAnalyzeTogether(on) {
      const c = current();
      c.settings.analyzeTogether = on;
      recompute(c);
      emit();
    },

    resolveAnimals(decision) {
      const c = current();
      const groups = animalGroups(c);
      c.animalsDecisionKey = groupsKey(groups);
      c.dialog = undefined;
      if (groups.length > 1) {
        const others = groups.slice(1);
        const withDuplicates = (ids: string[]): string[] => [...ids, ...c.sheets.filter((s) => s.duplicateOf !== undefined && ids.includes(s.duplicateOf)).map((s) => s.id)];
        if (decision === 'together') c.settings.analyzeTogether = true;
        else if (decision === 'remove') removeFrom(c, others.flatMap(withDuplicates));
        else if (decision === 'split') {
          for (const group of others) {
            const ids = new Set(withDuplicates(group));
            const next = emptyCase({ ...c.settings, calib: { ...c.settings.calib } });
            next.sheets = c.sheets.filter((s) => ids.has(s.id));
            c.sheets = c.sheets.filter((s) => !ids.has(s.id));
            sheetEdits.set(c.id, (sheetEdits.get(c.id) ?? []).filter((e) => e.sheetId === null || !ids.has(e.sheetId)));
            next.activeSheetId = next.sheets[0]?.id;
            state.cases.push(next);
            recompute(next);
          }
        }
      }
      recompute(c);
      emit();
    },

    addEdit(edit) {
      const c = current();
      const sheetId = edit.page === undefined ? null : c.caseSheets[edit.page];
      if (sheetId === undefined) {
        console.warn('Правка на несуществующий лист пропущена:', edit);
        return;
      }
      (sheetEdits.get(c.id) ?? []).push({ sheetId, edit });
      recompute(c);
      emit();
    },

    setEdits(edits) {
      const c = current();
      const list: SheetEdit[] = [];
      for (const edit of edits) {
        const sheetId = edit.page === undefined ? null : c.caseSheets[edit.page];
        if (sheetId !== undefined) list.push({ sheetId, edit });
      }
      sheetEdits.set(c.id, list);
      recompute(c);
      emit();
    },

    resetEdits() {
      const c = current();
      sheetEdits.set(c.id, []);
      recompute(c);
      emit();
    },

    selectCase(caseId) {
      if (!state.cases.some((c) => c.id === caseId)) return;
      state.activeCaseId = caseId;
      emit();
    },

    newCase() {
      for (const c of state.cases) for (const s of c.sheets) if (s.imageUrl) deps.revokeUrl?.(s.imageUrl);
      sheetEdits.clear();
      const fresh = emptyCase();
      state.cases = [fresh];
      state.activeCaseId = fresh.id;
      emit();
    },
  };

  return store;
}

let instance: CaseStore | undefined;

/** The single app store — created by the entry point; submodules (`overlay`, `results`) get it via `getCaseStore`. */
export function initCaseStore(deps: CaseStoreDeps): CaseStore {
  instance = createCaseStore(deps);
  return instance;
}

export function getCaseStore(): CaseStore {
  if (!instance) throw new Error('Хранилище случая ещё не создано: вызовите initCaseStore в точке входа');
  return instance;
}
