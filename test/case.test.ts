/**
 * Seam 2 — `orderPages` and `analyzeCase`: sheet order, "one animal", beat merging, edits.
 * The fixtures contain no multi-sheet recordings of one animal: the rules are checked on synthetic combinations
 * (two different fixtures; a fixture and its copy; the same sheet with shifted time labels; two synthetic sheets).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeCase, applyPageEdits, orderPages, resetEdits } from '../src/analysis/case';
import { VERIFICATION } from '../src/analysis/conclusion';
import { analyzePage } from '../src/core/page';
import { POLYSPECTRUM } from '../src/core/profile';
import { LEAD_IDS, type CaseSettings, type Edit, type PageResult, type Species } from '../src/types/contracts';
import { createGrayImage } from '../src/core/image';
import { getFixture, listFixtures, loadFixture, type Fixture } from './fixtures';
import { beatShape, renderSheet } from './synthetic/sheet';

const pageCache = new Map<string, PageResult>();
/** Fixture sheet result — computed once per run (analyzePage ≈ 0.3–0.5 s per sheet). */
function pageOf(fixture: Fixture): PageResult {
  let page = pageCache.get(fixture.name);
  if (!page) {
    page = analyzePage(loadFixture(fixture), POLYSPECTRUM);
    pageCache.set(fixture.name, page);
  }
  return page;
}

beforeAll(() => {
  for (const fixture of listFixtures()) pageOf(fixture);
}, 60_000);

/** The same sheet with time labels shifted by `shiftS` seconds (another part of the same recording). */
function shiftedCopy(page: PageResult, shiftS: number): PageResult {
  return {
    ...page,
    meta: { ...page.meta, timeLabels: page.meta.timeLabels.map((l) => ({ ...l, seconds: l.seconds + shiftS })) },
  };
}

describe('orderPages: "one animal" groups', () => {
  it('all 10 fixtures are different animals: 10 groups of one sheet each and multiple_animals', () => {
    const pages = listFixtures().map(pageOf);
    const order = orderPages(pages, pages.map((_, i) => `hash-${i}`));
    expect(order.groups.length).toBe(10);
    expect(order.groups.map((g) => g.length)).toEqual(Array(10).fill(1));
    expect(order.issues).toContain('multiple_animals');
    expect(order.duplicates).toEqual([]);
    expect(order.overlaps).toEqual([]);
  });

  it('a fixture and its byte-identical copy (same hash): one group, the copy is collapsed into duplicates and kept out of order', () => {
    const page = pageOf(getFixture('a-01'));
    const order = orderPages([page, page], ['same', 'same']);
    expect(order.groups).toEqual([[0]]);
    expect(order.duplicates).toEqual([[0, 1]]);
    expect(order.order).toEqual([0]);
    expect(order.issues).toEqual(['duplicate:1']);
  });

  it('the same sheet with shifted time labels (different hash): one group, ordered by recording time, not a repeat', () => {
    const page = pageOf(getFixture('a-01'));
    const later = shiftedCopy(page, 6);
    // Loaded in reverse order: the later sheet first.
    const order = orderPages([later, page], ['h-later', 'h-first']);
    expect(order.groups).toEqual([[1, 0]]);
    expect(order.order).toEqual([1, 0]);
    expect(order.overlaps).toEqual([]);
    expect(order.issues).toEqual([]);
    expect(order.spans?.[1]!.startS).toBeCloseTo(order.spans![0]!.startS - 6, 1);
  });

  it('a sheet repeating the interval of an already loaded one (0.5 s shift at 5.36 s length): overlaps and issue overlap, one counted', () => {
    const page = pageOf(getFixture('a-02'));
    const order = orderPages([page, shiftedCopy(page, 0.5)], ['h1', 'h2']);
    expect(order.groups).toEqual([[0, 1]]);
    expect(order.overlaps).toEqual([{ a: 0, b: 1 }]);
    expect(order.issues).toEqual(['overlap:1']);
  });

  it('time labels not read on one of the group sheets: load order and order_unknown', () => {
    const page = pageOf(getFixture('a-03'));
    const blind: PageResult = { ...page, meta: { ...page.meta, timeLabels: [] } };
    const order = orderPages([shiftedCopy(page, 6), blind], ['h1', 'h2']);
    expect(order.order).toEqual([0, 1]);
    expect(order.groups).toEqual([[0, 1]]);
    expect(order.issues).toEqual(['order_unknown']);
    expect(order.spans?.[1]).toBeUndefined();
  });

  it('different animals on the same date and one animal on different days — different groups', () => {
    const a = pageOf(getFixture('a-05'));
    const b = pageOf(getFixture('a-06'));
    const sameDay: PageResult = { ...b, meta: { ...b.meta, headerDate: a.meta.headerDate } };
    expect(orderPages([a, sameDay], ['h1', 'h2']).groups.length).toBe(2);
    const otherDay: PageResult = { ...a, meta: { ...a.meta, headerDate: '01.01.2020 10:00:00' } };
    expect(orderPages([a, otherDay], ['h1', 'h2']).groups.length).toBe(2);
  });
});

/** Synthetic header crop with a "pet name": one drawing for all sheets of one recording (0 — ink, 255 — background). */
const SYNTHETIC_CROP = (() => {
  const crop = createGrayImage(40, 10);
  for (let y = 2; y < 8; y++) for (let x = 3; x < 30; x += 3) crop.data[y * crop.width + x] = 0;
  return crop;
})();

const PERIOD_PX = 110;
/** Synthetic sheet of one recording: rhythm in all leads with phase `phasePx`, time labels `startS`…`startS + 5` above the seconds. */
function syntheticRecordPage(phasePx: number, startS: number): PageResult {
  const beat = (r: number, s: number, extra: Partial<Parameters<typeof beatShape>[0]> = {}) => beatShape({ periodPx: PERIOD_PX, r, s, phasePx, ...extra });
  const sheet = renderSheet({
    leads: { I: beat(45, 10), II: beat(100, 40, { q: 8 }), III: beat(65, 20), aVR: beat(15, 60, { t: -10 }), aVL: beat(30, 8), aVF: beat(70, 30) },
  });
  const page = analyzePage(sheet.image, POLYSPECTRUM);
  const plot = page.layout.zones.plot!;
  const pxPerSecond = page.layout.grid.pxPerSecond!;
  const timeLabels = [0, 1, 2, 3, 4, 5].map((k) => ({ text: String(startS + k), seconds: startS + k, x: plot.x + k * pxPerSecond }));
  return {
    ...page,
    meta: { ...page.meta, timeLabels, headerDate: '02.10.2026 10:00:00', headerNameCrop: SYNTHETIC_CROP },
    issues: page.issues.filter((code) => code !== 'header_name_unanchored'),
  };
}

const speciesOf = (fixture: Fixture): Species => (fixture.expected.speciesLetter === 'к' ? 'cat' : 'dog');
const settingsFor = (species: Species, extra: Partial<CaseSettings> = {}): CaseSettings => ({
  species,
  drugs: '',
  analyzeTogether: false,
  ...extra,
});

describe('analyzeCase: single-sheet case for each fixture', () => {
  describe.each(listFixtures())('$name', (fixture) => {
    it('no exceptions: 6 leads, HR measured, conclusion ends with the verification note, one sheet in the span', () => {
      const page = pageOf(fixture);
      const result = analyzeCase([page], settingsFor(speciesOf(fixture)), []);
      expect(result.perPage.length).toBe(1);
      expect(result.perPage[0].signals.map((s) => s.id)).toEqual([...LEAD_IDS]);
      expect(result.issues?.some((c) => c.startsWith('exception'))).not.toBe(true);
      expect(result.measurements.hrMean.value).not.toBeNull();
      expect(result.conclusion.text.endsWith(VERIFICATION)).toBe(true);
      expect(result.conclusion.table.length).toBeGreaterThan(0);
      expect(result.span.pages).toBe(1);
      expect(result.span.durationMs).toBeCloseTo((page.signals[0].mv.length * 1000) / 500, 0);
      expect(result.confidence).toBeGreaterThan(0.6);
      expect(result.flags ?? []).not.toContain('manual_correction');
      expect(result.analyzed).toEqual([0]);
      expect(result.beats?.[0].beats.length).toBeGreaterThan(2);
    });
  });

  it('empty case: no sheets — measurements unavailable with reason no_pages, conclusion is composed', () => {
    const result = analyzeCase([], settingsFor('dog'), []);
    expect(result.measurements.qrs.value).toBeNull();
    expect(result.measurements.qrs.reason).toBe('no_pages');
    expect(result.span).toMatchObject({ durationMs: 0, pages: 0 });
    expect(result.confidence).toBe(0);
    expect(result.conclusion.text.endsWith(VERIFICATION)).toBe(true);
  });
});

describe('analyzeCase: several sheets', () => {
  it('three different fixtures: 3 groups and multiple_animals; without analyzeTogether one group is counted, the rest are pages_excluded', () => {
    const pages = ['a-01', 'a-03', 'b-02'].map((n) => pageOf(getFixture(n)));
    const result = analyzeCase(pages, settingsFor('dog'), []);
    expect(result.order?.groups.length).toBe(3);
    expect(result.issues).toContain('multiple_animals');
    expect(result.analyzed).toEqual([0]);
    expect(result.issues).toEqual(expect.arrayContaining(['pages_excluded:1', 'pages_excluded:2']));
    expect(result.span.pages).toBe(1);
    expect(result.flags ?? []).not.toContain('analyze_together_forced');
  });

  it('three different fixtures with analyzeTogether: all sheets counted, the analyze_together_forced flag reaches the conclusion', () => {
    const pages = ['a-01', 'a-03', 'b-02'].map((n) => pageOf(getFixture(n)));
    const result = analyzeCase(pages, settingsFor('dog', { analyzeTogether: true }), []);
    expect(result.analyzed).toEqual([0, 1, 2]);
    expect(result.span.pages).toBe(3);
    expect(result.flags).toContain('analyze_together_forced');
    expect(result.conclusion.text).toContain('листы проанализированы вместе по решению пользователя');
    const perPageBeats = result.beats!.map((p) => p.beats.length);
    expect(perPageBeats.every((n) => n > 0)).toBe(true);
  });

  it('two synthetic sheets of one recording (labels 0…5 and 5…10 s) loaded in reverse order: ordered by time, beats add up, span 10.36 s', () => {
    const first = syntheticRecordPage(7, 0);
    const second = syntheticRecordPage(50, 5);
    const alone = [first, second].map((p) => analyzeCase([p], settingsFor('dog'), []));
    const result = analyzeCase([second, first], settingsFor('dog'), []);
    expect(result.order?.issues).toEqual([]);
    expect(result.analyzed).toEqual([1, 0]);
    expect(result.span.pages).toBe(2);
    const total = alone[0].beats![0].beats.length + alone[1].beats![0].beats.length;
    expect(result.beats!.reduce((s, p) => s + p.beats.length, 0)).toBe(total);
    expect(result.beats![1].offsetMs).toBeCloseTo(5000, -1);
    const lengthMs = (first.signals[0].mv.length * 1000) / 500;
    expect(result.span.durationMs).toBeCloseTo(2 * lengthMs, 0);
    expect(result.span.coveredMs!).toBeCloseTo(5000 + lengthMs, -1);
    expect(result.span.minutes!).toBeCloseTo((5000 + lengthMs) / 60000, 3);
    expect(result.measurements.hrMean.value!).toBeCloseTo(alone[0].measurements.hrMean.value!, 0);
    expect(result.conclusion.text).toContain('2 листа');
  });

  it('a fixture and its copy: the duplicate does not double beats or duration', () => {
    const page = pageOf(getFixture('a-06'));
    const single = analyzeCase([page], settingsFor('dog'), []);
    const twice = analyzeCase([page, page], settingsFor('dog'), []);
    expect(twice.order?.duplicates).toEqual([[0, 1]]);
    expect(twice.span).toEqual(single.span);
    expect(twice.beats!.reduce((s, p) => s + p.beats.length, 0)).toBe(single.beats![0].beats.length);
    expect(twice.measurements.hrMean.value).toBeCloseTo(single.measurements.hrMean.value!, 6);
  });
});

describe('analyzeCase: manual edits', () => {
  it('calibration 25 mm/s: sheet recomputed (manual), recording twice as long, HR halved, manual_correction flag and phrase in the conclusion', () => {
    const page = pageOf(getFixture('a-01'));
    const auto = analyzeCase([page], settingsFor('dog'), []);
    const edited = analyzeCase([page], settingsFor('dog'), [{ kind: 'calibration', calib: { mmPerS: 25, mmPerMv: 10 } }]);
    expect(edited.perPage[0].calibSource).toBe('manual');
    expect(edited.perPage[0].calib).toEqual({ mmPerS: 25, mmPerMv: 10 });
    expect(edited.span.durationMs).toBeCloseTo(auto.span.durationMs * 2, -1);
    expect(Math.abs(edited.measurements.hrMean.value! - auto.measurements.hrMean.value! / 2)).toBeLessThanOrEqual(3);
    expect(edited.flags).toContain('manual_correction');
    expect(edited.conclusion.text).toContain('разметка скорректирована вручную');
    // The source sheet is unchanged.
    expect(page.calibSource).toBe('footer');
  });

  it('calibration with pxPerMm (story 17): a sheet without a measured grid is digitized with the vet\'s step after the edit — signals and HR as on a sheet with a grid, mm/s, mm/mV, source and phase unchanged, table with numbers', () => {
    const withGrid = syntheticRecordPage(7, 0);
    const g = withGrid.layout.grid;
    // A sheet whose grid was not found: px/mm 0, empty signals (as `digitize` returns them without a grid), precision ceiling 0.
    const blind: PageResult = {
      ...withGrid,
      layout: { ...withGrid.layout, grid: { ...g, pxPerMmX: 0, pxPerMmY: 0, confidence: 0 }, issues: [...withGrid.layout.issues, 'no_grid'] },
      signals: withGrid.signals.map((s) => ({ ...s, mv: new Float32Array(0), confidence: 0 })),
      precision: { mvPerPx: 0, msPerPx: 0 },
      issues: [...withGrid.issues, 'no_grid'],
    };
    const auto = analyzeCase([blind], settingsFor('dog'), []);
    expect(auto.measurements.hrMean.value).toBeNull();
    const edited = analyzeCase([blind], settingsFor('dog'), [{ kind: 'calibration', calib: blind.calib, pxPerMm: { x: g.pxPerMmX, y: g.pxPerMmY } }]);
    const page = edited.perPage[0];
    expect(page.layout.grid.pxPerMmX).toBe(g.pxPerMmX);
    expect(page.layout.grid.pxPerMmY).toBe(g.pxPerMmY);
    expect(page.layout.grid.phaseX).toBe(blind.layout.grid.phaseX);
    expect(page.layout.grid.phaseY).toBe(blind.layout.grid.phaseY);
    expect(page.calibSource).toBe(blind.calibSource);
    expect(page.calib).toEqual(blind.calib);
    expect(page.signals[1].mv.length).toBe(withGrid.signals[1].mv.length);
    for (const k of [100, 1000, 2000]) expect(page.signals[1].mv[k]).toBeCloseTo(withGrid.signals[1].mv[k], 5);
    expect(page.precision.mvPerPx).toBeCloseTo(withGrid.precision.mvPerPx, 9);
    expect(page.precision.msPerPx).toBeCloseTo(withGrid.precision.msPerPx, 9);
    expect(page.issues).toContain('grid_manual');
    const reference = analyzeCase([withGrid], settingsFor('dog'), []);
    expect(edited.measurements.hrMean.value!).toBeCloseTo(reference.measurements.hrMean.value!, 3);
    expect(edited.conclusion.table.find((r) => r.key === 'hr')!.value).toMatch(/\d/);
    expect(edited.flags).toContain('manual_correction');
  });

  it('calibration with doubled pxPerMm on a real sheet: signal half as long and half as tall, mm/s, mm/mV and source unchanged; invalid pxPerMm is skipped', () => {
    const page = pageOf(getFixture('a-01'));
    const g = page.layout.grid;
    const edited = analyzeCase([page], settingsFor('dog'), [{ kind: 'calibration', calib: page.calib, pxPerMm: { x: 2 * g.pxPerMmX, y: 2 * g.pxPerMmY } }]);
    const p = edited.perPage[0];
    expect(p.calibSource).toBe('footer');
    expect(p.calib).toEqual(page.calib);
    expect(p.signals[1].mv.length).toBeCloseTo(page.signals[1].mv.length / 2, -1);
    expect(Math.max(...p.signals[1].mv)).toBeCloseTo(Math.max(...page.signals[1].mv) / 2, 2);
    expect(p.precision.msPerPx).toBeCloseTo(page.precision.msPerPx / 2, 6);
    expect(p.layout.grid.phaseY).toBe(g.phaseY);
    const skipped = analyzeCase([page], settingsFor('dog'), [{ kind: 'calibration', calib: page.calib, pxPerMm: { x: 0, y: -1 } }]);
    expect(skipped.issues).toContain('edit_skipped:calibration:0');
    expect(skipped.perPage[0].signals[1].mv.length).toBe(page.signals[1].mv.length);
  });

  it('baseline: manual II baseline 10 px lower on the sheet — II samples are +10 px (in mV) higher above the new baseline, other leads untouched', () => {
    const page = pageOf(getFixture('a-01'));
    const auto = analyzeCase([page], settingsFor('dog'), []);
    const ii = page.leads.find((l) => l.id === 'II')!;
    const y = ii.baselineY + 10;
    const edited = analyzeCase([page], settingsFor('dog'), [{ kind: 'baseline', page: 0, lead: 'II', y }]);
    const before = auto.perPage[0].signals[1];
    const after = edited.perPage[0].signals[1];
    expect(edited.perPage[0].leads[1].baselineY).toBe(y);
    expect(after.baselineY).toBe(y);
    expect(after.mv.length).toBe(before.mv.length);
    // mv = −(y − baseline) / (px/mm · mm/mV): baseline 10 px lower ⇒ each sample is 10 px further above it.
    const shift = 10 * page.precision.mvPerPx;
    for (const k of [100, 1000, 2000]) expect(after.mv[k]).toBeCloseTo(before.mv[k] + shift, 3);
    expect(edited.perPage[0].signals[0].mv).toEqual(auto.perPage[0].signals[0].mv);
    expect(edited.flags).toContain('manual_correction');
    expect(edited.measurements.hrMean.value).not.toBeNull();
  });

  // a-01 and a-06 are the sheets where the drawn baseline (trace mode) is farthest from the PQ level (4.1 and 6.0 px).
  it.each(['a-01', 'a-06'])('baseline (story 20), %s: manual line is an offset from the drawn one: in its place numbers match the automatic ones; +10 px lower makes II R and ST 10 px (in mV) higher; intervals, HR and other leads unchanged', (name) => {
    const fixture = getFixture(name);
    const page = pageOf(fixture);
    const settings = settingsFor(speciesOf(fixture));
    const ii = page.leads.find((l) => l.id === 'II')!;
    const shift = 10 * page.precision.mvPerPx;
    const ceiling = 2 * page.precision.mvPerPx;
    const auto = analyzeCase([page], settings, []);
    const a = auto.measurements;
    expect(a.r.value).not.toBeNull();
    expect(a.st.value).not.toBeNull();
    // Line placed exactly on the drawn one — all numbers match the automatic ones.
    const same = analyzeCase([page], settings, [{ kind: 'baseline', page: 0, lead: 'II', y: ii.baselineY }]);
    expect(same.measurements).toEqual(a);
    expect(same.flags).toContain('manual_correction');
    // +10 px lower on the sheet: R and ST grew by 10 px × mvPerPx within the precision ceiling (2 sheet px).
    const edited = analyzeCase([page], settings, [{ kind: 'baseline', page: 0, lead: 'II', y: ii.baselineY + 10 }]);
    const m = edited.measurements;
    expect(Math.abs(m.r.value! - a.r.value! - shift)).toBeLessThanOrEqual(ceiling);
    expect(Math.abs(m.st.value! - a.st.value! - shift)).toBeLessThanOrEqual(ceiling);
    // Intervals and HR do not depend on the baseline (up to float32 filter rounding — far below 1 px in time).
    for (const key of ['hrMean', 'hrMin', 'hrMax'] as const) expect(m[key].value).toBe(a[key].value);
    for (const key of ['pDuration', 'pq', 'qrs', 'qt', 'qtc'] as const) {
      if (a[key].value === null) expect(m[key].value, key).toBeNull();
      else expect(Math.abs(m[key].value! - a[key].value!), key).toBeLessThan(page.precision.msPerPx / 1000 / 10);
    }
    // Other leads untouched.
    for (const k of [0, 2, 3, 4, 5]) expect(edited.perPage[0].signals[k].mv).toEqual(auto.perPage[0].signals[k].mv);
    // Values from a manual baseline carry the manual correction flag; without the edit they do not.
    expect(edited.flags).toContain('manual_correction');
    expect(auto.flags).not.toContain('manual_correction');
  });

  it('leadLabel "no lead" for II: slot empty, wave measurements blocked with lead_ii_unreliable, HR from the other leads', () => {
    const page = pageOf(getFixture('a-03'));
    const edited = analyzeCase([page], settingsFor('cat'), [{ kind: 'leadLabel', page: 0, lead: 'II', as: null }]);
    expect(edited.perPage[0].signals.map((s) => s.id)).toEqual([...LEAD_IDS]);
    expect(edited.perPage[0].signals[1].mv.length).toBe(0);
    expect(edited.perPage[0].leads[1].points).toEqual([]);
    expect(edited.measurements.qrs.value).toBeNull();
    expect(edited.measurements.qrs.reason).toBe('lead_ii_unreliable');
    expect(edited.measurements.hrMean.value).not.toBeNull();
    expect(edited.measurements.hrMean.source).toBe('all_leads');
    expect(edited.rhythm.reasons).toContain('lead_ii_unreliable');
    expect(edited.flags).toContain('manual_correction');
  });

  it('baseline + leadLabel: manual baseline follows the trace — a lead I baseline edit with an I↔II swap measures II amplitudes from the manual line', () => {
    const page = pageOf(getFixture('a-01'));
    const i = page.leads.find((l) => l.id === 'I')!;
    const swap: Edit[] = [
      { kind: 'leadLabel', page: 0, lead: 'I', as: 'II' },
      { kind: 'leadLabel', page: 0, lead: 'II', as: 'I' },
    ];
    const edits: Edit[] = [{ kind: 'baseline', page: 0, lead: 'I', y: i.baselineY + 10 }, ...swap];
    const counter = { applied: 0 };
    const applied = applyPageEdits([page], edits, settingsFor('dog'), {}, counter);
    const shift = 10 * page.precision.mvPerPx;
    expect(Object.keys(applied.baselineShiftsMv[0])).toEqual(['II']);
    expect(applied.baselineShiftsMv[0].II).toBeCloseTo(shift, 9);
    expect(applyPageEdits([page], swap, settingsFor('dog'), {}, { applied: 0 }).baselineShiftsMv).toEqual([{}]);
    expect(Object.keys(applyPageEdits([page], [edits[0]], settingsFor('dog'), {}, { applied: 0 }).baselineShiftsMv[0])).toEqual(['I']);
    // In the case: with the same swap, R of the new II (former I) is 10 px higher than without the baseline edit.
    const swapped = analyzeCase([page], settingsFor('dog'), swap).measurements;
    const shifted = analyzeCase([page], settingsFor('dog'), edits).measurements;
    expect(swapped.r.value).not.toBeNull();
    expect(Math.abs(shifted.r.value! - swapped.r.value! - shift)).toBeLessThanOrEqual(2 * page.precision.mvPerPx);
  });

  it('leadLabel I↔II at once: slots swapped, nothing overwritten, slot order unchanged', () => {
    const page = pageOf(getFixture('a-05'));
    const auto = analyzeCase([page], settingsFor('cat'), []);
    const edited = analyzeCase([page], settingsFor('cat'), [
      { kind: 'leadLabel', page: 0, lead: 'I', as: 'II' },
      { kind: 'leadLabel', page: 0, lead: 'II', as: 'I' },
    ]);
    const was = auto.perPage[0].signals;
    const now = edited.perPage[0].signals;
    expect(now.map((s) => s.id)).toEqual([...LEAD_IDS]);
    expect(now[0].mv).toEqual(was[1].mv);
    expect(now[1].mv).toEqual(was[0].mv);
    expect(now[2].mv).toEqual(was[2].mv);
    expect(edited.perPage[0].leads[0].points).toEqual(auto.perPage[0].leads[1].points);
    expect(edited.issues ?? []).not.toContain('lead_label_conflict:I');
  });

  it('marker: QRS end of one complex moved by +20 ms — only its delineation changes (confidence 1), other complexes and traces unchanged; an edit without a beat is skipped', () => {
    const page = pageOf(getFixture('a-01'));
    const auto = analyzeCase([page], settingsFor('dog'), []);
    const marks = auto.beats![0].delineations;
    const k = marks.findIndex((d) => d.qOn !== null && d.sOff !== null && d.confidence >= 0.6);
    expect(k).toBeGreaterThanOrEqual(0);
    const sOff = marks[k].sOff! + 20;
    const edited = analyzeCase([page], settingsFor('dog'), [
      { kind: 'marker', page: 0, beat: k, field: 'sOff', tMs: sOff },
      { kind: 'marker', page: 0, beat: 999, field: 'tOff', tMs: 100 },
    ]);
    const after = edited.beats![0].delineations;
    expect(after[k].sOff).toBe(sOff);
    expect(after[k].qOn).toBe(marks[k].qOn);
    expect(after[k].confidence).toBe(1);
    after.forEach((d, i) => {
      if (i !== k) expect(d).toEqual(marks[i]);
    });
    expect(edited.beats![0].beats).toEqual(auto.beats![0].beats);
    expect(edited.perPage[0]).toBe(page);
    expect(edited.flags).toContain('manual_correction');
    expect(edited.issues).toContain('edit_skipped:marker:0');
    // The vet's complex takes part in the QRS measurement.
    expect(edited.measurements.qrs.beats).toContain(k);
  });

  it('P onset marker on a complex without a found P: P counts as found, reason p_not_found removed, unreliable_segment stays', () => {
    const page = pageOf(getFixture('a-04'));
    const auto = analyzeCase([page], settingsFor('cat'), []);
    const marks = auto.beats![0].delineations;
    const k = marks.findIndex((d) => !d.pFound && d.qOn !== null);
    expect(k).toBeGreaterThanOrEqual(0);
    const qOn = marks[k].qOn!;
    const edited = analyzeCase([page], settingsFor('cat'), [
      { kind: 'marker', page: 0, beat: k, field: 'pOn', tMs: qOn - 60 },
      { kind: 'marker', page: 0, beat: k, field: 'pOff', tMs: qOn - 25 },
    ]);
    const d = edited.beats![0].delineations[k];
    expect(d.pFound).toBe(true);
    expect(d.pOn).toBe(qOn - 60);
    expect(d.pOff).toBe(qOn - 25);
    expect(d.reasons ?? []).not.toContain('p_not_found');
    expect((d.reasons ?? []).includes('unreliable_segment')).toBe((marks[k].reasons ?? []).includes('unreliable_segment'));
  });

  it('two traces reassigned to one lead: lead_label_conflict, the last edit wins', () => {
    const page = pageOf(getFixture('a-05'));
    const auto = analyzeCase([page], settingsFor('cat'), []);
    const edited = analyzeCase([page], settingsFor('cat'), [{ kind: 'leadLabel', page: 0, lead: 'III', as: 'I' }]);
    expect(edited.issues).toContain('lead_label_conflict:I');
    // Trace III (edited) beats trace I (unedited); slot III is empty.
    expect(edited.perPage[0].signals[0].mv).toEqual(auto.perPage[0].signals[2].mv);
    expect(edited.perPage[0].signals[2].mv.length).toBe(0);
  });
});

describe('analyzeCase: lead separator (retracing)', () => {
  const fixture = getFixture('a-06');
  /**
   * III/aVR separator on x 300–420, 30 px above the III baseline: trace III must pass above the line,
   * aVR below it, so the hint really changes III points (without it they lie on the baseline, i.e. below the line).
   */
  const hintFor = (page: PageResult) => {
    const iii = page.leads.find((l) => l.id === 'III')!;
    return { x0: 300, x1: 420, y: iii.baselineY - 30, above: 'III' as const, below: 'aVR' as const };
  };
  const within = (lead: { points: { x: number; y: number }[] }, x0: number, x1: number) => lead.points.filter((p) => p.x >= x0 && p.x <= x1);

  it('without the source image the edit is not applied: edit_skipped:separator, sheet unchanged, no manual_correction flag', () => {
    const page = pageOf(fixture);
    const result = analyzeCase([page], settingsFor('dog'), [{ kind: 'separator', page: 0, hint: hintFor(page) }]);
    expect(result.issues).toContain('edit_skipped:separator:0');
    expect(result.perPage[0]).toBe(page);
    expect(result.flags ?? []).not.toContain('manual_correction');
  });

  it('with the image the sheet is retraced via analyzePage with the hint and the case manual calibration; the result is deterministic', () => {
    const page = pageOf(fixture);
    const image = loadFixture(fixture);
    const hint = hintFor(page);
    const edits = [{ kind: 'separator', page: 0, hint } as const];
    const settings = settingsFor('dog', { calib: { mmPerS: 50, mmPerMv: 20 } });
    const result = analyzeCase([page], settings, edits, { images: [image] });
    expect(result.issues ?? []).not.toContain('edit_skipped:separator:0');
    expect(result.perPage[0]).not.toBe(page);
    expect(result.perPage[0].signals.map((s) => s.id)).toEqual([...LEAD_IDS]);
    expect(result.perPage[0].calibSource).toBe('manual');
    expect(result.perPage[0].calib).toEqual({ mmPerS: 50, mmPerMv: 20 });
    expect(result.flags).toContain('manual_correction');
    // (a) The hint reached the tracer: trace III differs from tracing without hints at the same calibration.
    const plain = analyzePage(image, POLYSPECTRUM, { calib: settings.calib });
    const iii = result.perPage[0].leads.find((l) => l.id === 'III')!;
    const avr = result.perPage[0].leads.find((l) => l.id === 'aVR')!;
    expect(iii.points).not.toEqual(plain.leads.find((l) => l.id === 'III')!.points);
    // (b) Within the hint span III passes above the line, aVR below it.
    const iiiOn = within(iii, hint.x0, hint.x1);
    const avrOn = within(avr, hint.x0, hint.x1);
    expect(iiiOn.length).toBeGreaterThan(50);
    expect(avrOn.length).toBeGreaterThan(50);
    expect(iiiOn.every((p) => p.y < hint.y)).toBe(true);
    expect(avrOn.every((p) => p.y > hint.y)).toBe(true);
    // Exactly what the sheet seam returns with the same hint and calibration; determinism.
    const reference = analyzePage(image, POLYSPECTRUM, { hints: [hint], calib: settings.calib });
    expect(result.perPage[0]).toEqual(reference);
    expect(analyzeCase([page], settings, edits, { images: [image] })).toEqual(result);
  }, 20_000);
});

describe('analyzeCase: determinism and edit reset', () => {
  it('same edits — same result; resetEdits restores the automatic result', () => {
    const page = pageOf(getFixture('a-08'));
    const auto = analyzeCase([page], settingsFor('dog'), []);
    const k = auto.beats![0].delineations.findIndex((d) => d.qOn !== null && d.sOff !== null);
    const edits: Edit[] = [
      { kind: 'calibration', calib: { mmPerS: 50, mmPerMv: 5 } },
      { kind: 'baseline', page: 0, lead: 'aVF', y: page.leads[5].baselineY - 3 },
      { kind: 'leadLabel', page: 0, lead: 'aVL', as: null },
      { kind: 'marker', page: 0, beat: k, field: 'tOff', tMs: auto.beats![0].delineations[k].sOff! + 150 },
    ];
    const once = analyzeCase([page], settingsFor('dog'), edits);
    const twice = analyzeCase([page], settingsFor('dog'), edits);
    expect(twice).toEqual(once);
    expect(once.flags).toContain('manual_correction');
    expect(once.measurements.r.value).not.toBeNull();
    // Half the gain (5 mm/mV) — R amplitude twice the automatic one.
    expect(once.measurements.r.value!).toBeCloseTo(auto.measurements.r.value! * 2, 1);
    expect(resetEdits(edits)).toEqual([]);
    const reset = analyzeCase([page], settingsFor('dog'), resetEdits(edits));
    expect(reset).toEqual(auto);
    expect(reset.flags ?? []).not.toContain('manual_correction');
  });
});

describe('analyzeCase: unreliable lead II', () => {
  it('II with confidence 0.3: wave measurements blocked with reason lead_ii_unreliable, HR and rhythm from the other leads', () => {
    const page = pageOf(getFixture('a-06'));
    const weak: PageResult = { ...page, signals: page.signals.map((s) => (s.id === 'II' ? { ...s, confidence: 0.3 } : s)) };
    const result = analyzeCase([weak], settingsFor('dog'), []);
    for (const key of ['qrs', 'pq', 'r', 'q', 's', 'qt'] as const) {
      expect(result.measurements[key].value, key).toBeNull();
      expect(result.measurements[key].reason, key).toBe('lead_ii_unreliable');
    }
    expect(result.measurements.hrMean.value).not.toBeNull();
    expect(result.measurements.hrMean.source).toBe('all_leads');
    expect(result.beats![0].beats.length).toBeGreaterThan(2);
    expect(result.rhythm.reasons).toContain('lead_ii_unreliable');
    expect(result.conclusion.text).toContain('отведение II ненадёжно');
    expect(result.flags ?? []).not.toContain('manual_correction');
  });
});
