import { beforeAll, describe, expect, it } from 'vitest';
import { hashBytes } from '../src/app/files/hash';
import {
  activeCase,
  createCaseStore,
  sheetBadges,
  sheetTimeText,
  type CaseStore,
  type SheetInput,
} from '../src/app/state/case-store';
import { PageAnalysisFailed, type AnalyzeEvents } from '../src/app/worker/pool';
import { analyzeCase, type CaseOptions } from '../src/analysis/case';
import { analyzePage } from '../src/core/page';
import { POLYSPECTRUM } from '../src/core/profile';
import type { CaseSettings, Edit, GrayImage, PageOptions, PageResult } from '../src/types/contracts';
import { loadFixture, loadFixtureBytes } from './fixtures';

type Analyzer = (image: GrayImage, options: PageOptions | undefined, events: AnalyzeEvents) => Promise<PageResult>;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Analyzer that replies at once with a ready result per image; counts calls. */
function autoAnalyzer(results: Map<GrayImage, PageResult>) {
  const state = { calls: 0 };
  const analyzeSheet: Analyzer = (image, _options, events) => {
    state.calls++;
    events.onAttempt?.(1);
    const result = results.get(image);
    return result ? Promise.resolve(result) : Promise.reject(new PageAnalysisFailed('no result for the sheet', 3));
  };
  return { state, analyzeSheet };
}

/** Test-controlled analyzer: the attempt and the reply are triggered manually. */
function manualAnalyzer(results: Map<GrayImage, PageResult>) {
  const calls: { image: GrayImage; events: AnalyzeEvents; resolve(r: PageResult): void }[] = [];
  const analyzeSheet: Analyzer = (image, _options, events) =>
    new Promise<PageResult>((resolve) => {
      calls.push({ image, events, resolve });
    });
  return {
    calls,
    analyzeSheet,
    start: (i: number) => calls[i].events.onAttempt?.(1),
    finish: (i: number) => calls[i].resolve(results.get(calls[i].image) as PageResult),
  };
}

/** Wrapper around the real `analyzeCase` that records the last call. */
function spyCase() {
  const last: { settings?: CaseSettings; edits?: Edit[]; options?: CaseOptions } = {};
  const fn = (pages: PageResult[], settings: CaseSettings, edits: Edit[], options?: CaseOptions) => {
    last.settings = settings;
    last.edits = edits;
    last.options = options;
    return analyzeCase(pages, settings, edits, options);
  };
  return { last, fn };
}

describe('case state: sheets, settings, different-animals dialog', () => {
  let a01: GrayImage;
  let a03: GrayImage;
  const results = new Map<GrayImage, PageResult>();

  beforeAll(() => {
    a01 = loadFixture('a-01');
    a03 = loadFixture('a-03');
    results.set(a01, analyzePage(a01, POLYSPECTRUM));
    results.set(a03, analyzePage(a03, POLYSPECTRUM));
  });

  const inputOf = (name: 'a-01' | 'a-03', image: GrayImage, extra: Partial<SheetInput> = {}): SheetInput => ({
    name: `${name}.jpg`,
    hash: hashBytes(loadFixtureBytes(name)),
    image,
    width: image.width,
    height: image.height,
    ...extra,
  });

  const sheetOf = (store: CaseStore, id: string) => {
    const sheet = activeCase(store.getState()).sheets.find((s) => s.id === id);
    if (!sheet) throw new Error(`no sheet ${id}`);
    return sheet;
  };

  it('sheet goes «в очереди» → «распознаётся» → «готово»; case is built with images and hashes; sheet time is read', async () => {
    const analyzer = manualAnalyzer(results);
    const spy = spyCase();
    const store = createCaseStore({ analyzeSheet: analyzer.analyzeSheet, analyzeCase: spy.fn });
    expect(store.getState().phase).toBe('empty');

    const [id] = store.addSheets([inputOf('a-01', a01)]);
    expect(store.getState().phase).toBe('case');
    expect(sheetOf(store, id).status).toBe('queued');
    await tick();
    analyzer.start(0);
    expect(sheetOf(store, id).status).toBe('analyzing');
    expect(sheetOf(store, id).attempt).toBe(1);
    analyzer.finish(0);
    await store.whenIdle();

    expect(sheetOf(store, id).status).toBe('done');
    const c = activeCase(store.getState());
    expect(c.caseSheets).toEqual([id]);
    expect(c.result?.perPage).toHaveLength(1);
    expect(spy.last.options?.images?.[0]).toBe(a01);
    expect(spy.last.options?.hashes).toEqual([hashBytes(loadFixtureBytes('a-01'))]);
    // a-01 time labels are 01:45…01:49 (expected.json), the sheet lasts ≈ 5.4 s: start at 01:44, end around 01:50.
    expect(sheetTimeText(c, id)).toMatch(/^01:4[45]–01:(49|5[01])$/);
  });

  it('a byte-identical duplicate is not recognized twice, is badged «дубликат» and excluded from the case analysis', async () => {
    const analyzer = autoAnalyzer(results);
    const store = createCaseStore({ analyzeSheet: analyzer.analyzeSheet });

    const [a, b] = store.addSheets([inputOf('a-01', a01), inputOf('a-01', a01, { name: 'копия.jpg' })]);
    await store.whenIdle();

    expect(analyzer.state.calls).toBe(1);
    const c = activeCase(store.getState());
    expect(sheetOf(store, b).duplicateOf).toBe(a);
    expect(sheetOf(store, b).status).toBe('done');
    expect(sheetBadges(c, b)).toContain('дубликат');
    expect(c.result?.order?.duplicates).toEqual([[0, 1]]);
    expect(c.result?.analyzed).toEqual([0]);
  });

  it('a broken file gets a Russian error text and is not sent to recognition; the other sheets are processed', async () => {
    const analyzer = autoAnalyzer(results);
    const store = createCaseStore({ analyzeSheet: analyzer.analyzeSheet });

    const [bad, good] = store.addSheets([{ name: 'заметки.txt', hash: 'x', problem: { kind: 'not_image' } }, inputOf('a-01', a01)]);
    await store.whenIdle();

    expect(sheetOf(store, bad).status).toBe('error');
    expect(sheetOf(store, bad).error).toBe('Это не изображение — нужен JPEG или PNG');
    expect(analyzer.state.calls).toBe(1);
    expect(sheetOf(store, good).status).toBe('done');
    const c = activeCase(store.getState());
    expect(c.caseSheets).toEqual([good]);
    expect(c.result?.perPage).toHaveLength(1);
  });

  it('a sheet failing after all attempts — «Ошибка распознавания, лист пропущен»; the case is computed from the rest', async () => {
    const analyzeSheet: Analyzer = (image, _options, events) => {
      events.onAttempt?.(3);
      return image === a03 ? Promise.reject(new PageAnalysisFailed('boom', 3)) : Promise.resolve(results.get(image) as PageResult);
    };
    const store = createCaseStore({ analyzeSheet });

    const [ok, failed] = store.addSheets([inputOf('a-01', a01), inputOf('a-03', a03)]);
    await store.whenIdle();

    expect(sheetOf(store, failed).status).toBe('error');
    expect(sheetOf(store, failed).error).toBe('Ошибка распознавания, лист пропущен');
    expect(sheetOf(store, failed).attempt).toBe(3);
    expect(sheetOf(store, ok).status).toBe('done');
    expect(activeCase(store.getState()).caseSheets).toEqual([ok]);
  });

  it('species is suggested from the header with the «из шапки» note; manual choice takes priority; different letters on sheets — warning', async () => {
    const spy = spyCase();
    const store = createCaseStore({ analyzeSheet: autoAnalyzer(results).analyzeSheet, analyzeCase: spy.fn });

    store.addSheets([inputOf('a-01', a01)]);
    await store.whenIdle();
    expect(activeCase(store.getState()).settings).toMatchObject({ species: 'dog', speciesSource: 'header' });
    expect(spy.last.settings?.species).toBe('dog');

    store.setSpecies('cat');
    expect(activeCase(store.getState()).settings).toMatchObject({ species: 'cat', speciesSource: 'manual' });
    expect(spy.last.settings?.species).toBe('cat');

    store.setSpecies(null);
    expect(activeCase(store.getState()).settings).toMatchObject({ species: 'dog', speciesSource: 'header' });

    store.addSheets([inputOf('a-03', a03)]);
    await store.whenIdle();
    expect(activeCase(store.getState()).warnings.some((w) => /вид/i.test(w) && /разн/i.test(w))).toBe(true);
  });

  it('calibration from the footer with a note; manual beats footer (sheet becomes manual); reset restores the footer', async () => {
    const store = createCaseStore({ analyzeSheet: autoAnalyzer(results).analyzeSheet });
    store.addSheets([inputOf('a-01', a01)]);
    await store.whenIdle();

    expect(activeCase(store.getState()).settings).toMatchObject({ calib: { mmPerS: 50, mmPerMv: 10 }, calibSource: 'footer' });
    expect(activeCase(store.getState()).result?.perPage[0].calibSource).toBe('footer');

    store.setCalibration({ mmPerS: 50, mmPerMv: 20 });
    expect(activeCase(store.getState()).settings.calibSource).toBe('manual');
    expect(activeCase(store.getState()).result?.perPage[0]).toMatchObject({ calibSource: 'manual', calib: { mmPerS: 50, mmPerMv: 20 } });

    store.setCalibration(null);
    expect(activeCase(store.getState()).settings.calibSource).toBe('footer');
    expect(activeCase(store.getState()).result?.perPage[0].calibSource).toBe('footer');
  });

  it('monitoring minutes are prefilled from the sheets and reach the conclusion; manual input takes priority', async () => {
    const store = createCaseStore({ analyzeSheet: autoAnalyzer(results).analyzeSheet });
    store.addSheets([inputOf('a-01', a01)]);
    await store.whenIdle();

    const c = activeCase(store.getState());
    expect(c.settings.minutesSource).toBe('pages');
    expect(c.settings.monitoringMinutes).toBeGreaterThan(0);
    expect(c.settings.monitoringMinutes).toBeCloseTo(c.result?.span.minutes ?? -1, 1);

    store.setMonitoringMinutes(15);
    const manual = activeCase(store.getState());
    expect(manual.settings).toMatchObject({ monitoringMinutes: 15, minutesSource: 'manual' });
    expect(JSON.stringify(manual.result?.conclusion)).toContain('15');
  });

  it('different animals: the dialog lists groups; «вместе» sets the flag; «убрать» keeps the main group; «разделить» creates a second case', async () => {
    const make = async () => {
      const store = createCaseStore({ analyzeSheet: autoAnalyzer(results).analyzeSheet });
      const [dog, cat] = store.addSheets([inputOf('a-01', a01), inputOf('a-03', a03)]);
      await store.whenIdle();
      return { store, dog, cat };
    };

    const together = await make();
    let c = activeCase(together.store.getState());
    expect(c.result?.issues).toContain('multiple_animals');
    expect(c.dialog?.groups).toEqual([[together.dog], [together.cat]]);
    expect(sheetBadges(c, together.cat).some((b) => /не учтён/i.test(b))).toBe(true);
    together.store.resolveAnimals('together');
    c = activeCase(together.store.getState());
    expect(c.dialog).toBeUndefined();
    expect(c.settings.analyzeTogether).toBe(true);
    expect(c.result?.flags).toContain('analyze_together_forced');
    expect(c.result?.analyzed).toEqual([0, 1]);

    const remove = await make();
    remove.store.resolveAnimals('remove');
    c = activeCase(remove.store.getState());
    expect(c.sheets.map((s) => s.id)).toEqual([remove.dog]);
    expect(c.dialog).toBeUndefined();
    expect(c.result?.issues).not.toContain('multiple_animals');

    const split = await make();
    split.store.resolveAnimals('split');
    const state = split.store.getState();
    expect(state.cases).toHaveLength(2);
    expect(state.cases[0].sheets.map((s) => s.id)).toEqual([split.dog]);
    expect(state.cases[1].sheets.map((s) => s.id)).toEqual([split.cat]);
    expect(state.cases[1].result?.perPage).toHaveLength(1);
    expect(state.cases[1].settings).toMatchObject({ species: 'cat', speciesSource: 'header' });
    expect(activeCase(state).dialog).toBeUndefined();
  });

  it('the main group is the one whose sheets analyzeCase counted, even if not loaded first; dialog caption and actions agree', async () => {
    const make = async () => {
      const store = createCaseStore({ analyzeSheet: autoAnalyzer(results).analyzeSheet });
      const [cat, dog1, dog2] = store.addSheets([
        inputOf('a-03', a03),
        inputOf('a-01', a01, { hash: 'h1' }),
        inputOf('a-01', a01, { hash: 'h2', name: 'второй.jpg' }),
      ]);
      await store.whenIdle();
      return { store, cat, dog1, dog2 };
    };

    const first = await make();
    const c = activeCase(first.store.getState());
    expect(c.result?.order?.groups).toEqual([[0], [1, 2]]);
    expect(c.result?.issues).toContain('pages_excluded:0');
    expect(c.dialog?.groups[0]).toEqual([first.dog1, first.dog2]);
    expect(c.dialog?.groups[1]).toEqual([first.cat]);
    first.store.resolveAnimals('remove');
    expect(activeCase(first.store.getState()).sheets.map((s) => s.id)).toEqual([first.dog1, first.dog2]);

    const second = await make();
    second.store.resolveAnimals('split');
    const state = second.store.getState();
    expect(activeCase(state).sheets.map((s) => s.id)).toEqual([second.dog1, second.dog2]);
    expect(state.cases[1].sheets.map((s) => s.id)).toEqual([second.cat]);
  });

  it('the «разные животные» dialog waits until all sheets are recognized and after «решить позже» does not reappear for the same groups', async () => {
    const analyzer = manualAnalyzer(results);
    const store = createCaseStore({ analyzeSheet: analyzer.analyzeSheet });
    store.addSheets([inputOf('a-01', a01), inputOf('a-03', a03), inputOf('a-01', a01, { hash: 'h3', name: 'третий.jpg' })]);
    await tick();
    analyzer.finish(0);
    analyzer.finish(1);
    await tick();

    let c = activeCase(store.getState());
    expect(c.result?.issues).toContain('multiple_animals');
    expect(c.dialog).toBeUndefined(); // the third sheet is still being recognized — too early for the dialog

    analyzer.finish(2);
    await store.whenIdle();
    c = activeCase(store.getState());
    expect(c.dialog?.groups.length).toBe(2);

    store.resolveAnimals('dismiss');
    c = activeCase(store.getState());
    expect(c.dialog).toBeUndefined();
    expect(c.warnings.some((w) => /другое животное/i.test(w))).toBe(true);
    store.setDogSize('small');
    expect(activeCase(store.getState()).dialog).toBeUndefined();
  });

  it('order not read: warning, and manual thumbnail reordering changes the case sheet order', async () => {
    const base = results.get(a01) as PageResult;
    const noTime: PageResult = { ...base, meta: { ...base.meta, timeLabels: [] } };
    const analyzeSheet: Analyzer = (_image, _options, events) => {
      events.onAttempt?.(1);
      return Promise.resolve(noTime);
    };
    const store = createCaseStore({ analyzeSheet });

    const [first, second] = store.addSheets([inputOf('a-01', a01, { hash: 'h1' }), inputOf('a-01', a01, { hash: 'h2', name: 'второй.jpg' })]);
    await store.whenIdle();

    let c = activeCase(store.getState());
    expect(c.result?.issues).toContain('order_unknown');
    expect(c.warnings.some((w) => /порядок/i.test(w))).toBe(true);
    expect(c.caseSheets).toEqual([first, second]);

    store.reorderSheets(second, first);
    c = activeCase(store.getState());
    expect(c.caseSheets).toEqual([second, first]);
    expect(c.sheets.map((s) => s.id)).toEqual([second, first]);
    expect(c.result?.order?.order).toEqual([0, 1]);
  });

  it('«Новый случай» resets the state to the empty screen', async () => {
    const store = createCaseStore({ analyzeSheet: autoAnalyzer(results).analyzeSheet });
    store.addSheets([inputOf('a-01', a01)]);
    await store.whenIdle();
    let changes = 0;
    store.subscribe(() => changes++);

    store.newCase();

    const state = store.getState();
    expect(state.phase).toBe('empty');
    expect(state.cases).toHaveLength(1);
    expect(activeCase(state).sheets).toEqual([]);
    expect(activeCase(state).result).toBeUndefined();
    expect(changes).toBeGreaterThan(0);
  });
});
