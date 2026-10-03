import { describe, expect, it } from 'vitest';
import { checkPrintedHr, delineate, detectBeats } from '../src/analysis/beats';
import { filterSignal } from '../src/analysis/filter';
import { measure } from '../src/analysis/measure';
import { analyzeRhythm } from '../src/analysis/rhythm';
import { analyzePage } from '../src/core/page';
import { POLYSPECTRUM } from '../src/core/profile';
import type { Beat, Delineation, Measurements, PageResult, Species } from '../src/types/contracts';
import { getFixture, listFixtures, type Fixture } from './fixtures';
import { loadFixture } from './fixtures';

const speciesOf = (fixture: Fixture): Species => (fixture.expected.speciesLetter === 'к' ? 'cat' : 'dog');

interface Analyzed {
  page: PageResult;
  species: Species;
  beats: Beat[];
  marks: Delineation[];
}

const cache = new Map<string, Analyzed>();
/** Chain analyzePage → detectBeats → checkPrintedHr → filterSignal(II) → delineate — as `case` will assemble it. */
function analyzed(fixture: Fixture): Analyzed {
  let a = cache.get(fixture.name);
  if (!a) {
    const page = analyzePage(loadFixture(fixture), POLYSPECTRUM);
    const species = speciesOf(fixture);
    const detected = detectBeats(page.signals, species);
    const beats = checkPrintedHr(detected, page.meta, page.layout, page.calib).beats ?? detected;
    const ii = filterSignal(page.signals.find((s) => s.id === 'II')!, species);
    const marks = beats.map((b, k) => delineate(b, ii, species, { precision: page.precision, prevTMs: beats[k - 1]?.tMs, nextTMs: beats[k + 1]?.tMs }));
    a = { page, species, beats, marks };
    cache.set(fixture.name, a);
  }
  return a;
}

const measured = new Map<string, Measurements>();
function measurementsOf(fixture: Fixture): Measurements {
  let m = measured.get(fixture.name);
  if (!m) {
    const a = analyzed(fixture);
    m = measure(a.beats, a.marks, a.page.signals, a.species);
    measured.set(fixture.name, m);
  }
  return m;
}

/** HR from the printed row of instantaneous HR, computed the way `measure` does: 60000 / mean RR. */
const hrByPrintedRow = (row: number[]): number => 60000 / (row.reduce((acc, hr) => acc + 60000 / hr, 0) / row.length);

/**
 * Sheets where the device footer HR follows from the visible sheet (matches HR from the printed row within ±3).
 * On `a-07` the row gives 185 vs footer 192; on `b-01` footer 81 is the mean of the row's instantaneous HR (80), not
 * 60000/RR (76); on `b-02` footer 203 lies between 196 (by RR) and 215 (mean instantaneous); on `a-08` the row agrees
 * with the footer (152.7 vs 150), but the detector cannot see the row's two edge intervals (458 and 448 ms) — their
 * beats are off-frame.
 */
const FOOTER_FROM_VISIBLE_SHEET = ['a-01', 'a-02', 'a-03', 'a-04', 'a-05', 'a-06'];

describe('measurements on real sheets (seam analyzePage → beats → measure)', () => {
  describe.each(listFixtures())('$name', (fixture) => {
    it('mean HR by RR agrees with HR from the printed row within ±4 bpm and with the device footer within ±3 where the footer is computed from the visible sheet (MEAS-01); min/max cover the row', () => {
      const m = measurementsOf(fixture);
      expect(m.hrMean.value).not.toBeNull();
      expect(Math.abs(m.hrMean.value! - hrByPrintedRow(fixture.expected.hrRow))).toBeLessThanOrEqual(4);
      if (FOOTER_FROM_VISIBLE_SHEET.includes(fixture.name)) expect(Math.abs(m.hrMean.value! - fixture.expected.footerHr)).toBeLessThanOrEqual(3);
      expect(m.hrMean.unit).toBe('уд/мин');
      expect(m.hrMean.source).toBe('lead_ii');
      // Printed instantaneous HR values lie within [hrMin, hrMax] with the precision ceiling tolerance (±3 bpm, more for cats).
      const printed = fixture.expected.hrRow;
      const slack = fixture.expected.speciesLetter === 'к' ? 10 : 4;
      expect(m.hrMin.value!).toBeLessThanOrEqual(Math.min(...printed) + slack);
      expect(m.hrMax.value!).toBeGreaterThanOrEqual(Math.max(...printed) - slack);
    });

    it('signs and units as compose expects: R ≥ 0, Q and S ≤ 0 (mV), intervals in seconds, QRS complex list is non-empty', () => {
      const m = measurementsOf(fixture);
      expect(m.qrs.value).not.toBeNull();
      expect(m.qrs.unit).toBe('с');
      expect(m.qrs.beats.length).toBeGreaterThan(0);
      expect(m.qrs.value!).toBeGreaterThan(0.015);
      expect(m.qrs.value!).toBeLessThan(0.12);
      expect(m.r.value!).toBeGreaterThanOrEqual(0);
      expect(m.q.value!).toBeLessThanOrEqual(0);
      expect(m.s.value!).toBeLessThanOrEqual(0);
      for (const key of ['q', 'r', 's', 't', 'st', 'pAmplitude'] as const) expect(m[key].unit, key).toBe('мВ');
      for (const key of ['pDuration', 'pq', 'qt', 'qtc'] as const) expect(m[key].unit, key).toBe('с');
      if (fixture.expected.speciesLetter === 'к') expect(m.qtc.value).toBeNull();
    });
  });

  it('b-02 (17-56-22): the 713 ms pause is reflected by min HR ≈ 84 bpm', () => {
    const m = measurementsOf(getFixture('b-02'));
    expect(Math.abs(m.hrMin.value! - 84)).toBeLessThanOrEqual(3);
  });
});

const FOCUS_CODES = ['atrial', 'junctional', 'left_ventricle', 'right_ventricle', 'unknown'];
const EPISODE_CODES = ['sve_run', 've_run', 'svt', 'vt', 'no_p'];

function rhythmOf(fixture: Fixture) {
  const a = analyzed(fixture);
  return analyzeRhythm(a.beats, a.marks, a.page.signals, a.species, (a.page.signals[0]?.mv.length ?? 0) * 2);
}

describe('rhythm and arrhythmias on real sheets (seam analyzePage → beats → rhythm)', () => {
  describe.each(listFixtures())('$name', (fixture) => {
    it('report uses compose dictionary codes: rhythm type, foci, episode kinds; coupling intervals are positive', () => {
      const r = rhythmOf(fixture);
      expect(['sinus', 'non_sinus', 'undetermined']).toContain(r.type);
      for (const e of r.ectopics) {
        expect(['SVE', 'VE']).toContain(e.kind);
        expect(FOCUS_CODES).toContain(e.focus);
        expect(e.couplingMs).toBeGreaterThan(0);
      }
      for (const ep of r.episodes) {
        expect(EPISODE_CODES).toContain(ep.kind);
        expect(FOCUS_CODES).toContain(ep.focus);
        expect(ep.beats.length).toBeGreaterThanOrEqual(3);
      }
      for (const code of r.reasons) expect(code).toMatch(/^[a-z0-9_]+(:[^\s]+)?$/);
    });
  });

  it.each([
    { name: 'a-02', source: '17-56-08', couplings: [166, 166] },
    { name: 'a-08', source: '17-56-30', couplings: [284] },
  ])('$name ($source): exactly the premature beats of the printed HR spikes are found, coupling — their RR ±12 ms', ({ name, couplings }) => {
    const r = rhythmOf(getFixture(name));
    expect(r.ectopics.length).toBe(couplings.length);
    r.ectopics.forEach((e, k) => expect(Math.abs(e.couplingMs - couplings[k])).toBeLessThanOrEqual(12));
  });

  it('a-08 (17-56-30): the premature beat is a supraventricular extrasystole with an atrial focus (P′: PQ 120 ms vs sinus median 74, QRS 58 ms after compensation)', () => {
    const r = rhythmOf(getFixture('a-08'));
    expect(r.ectopics.length).toBe(1);
    expect(r.ectopics[0].kind).toBe('SVE');
    expect(r.ectopics[0].focus).toBe('atrial');
    expect(r.type).toBe('sinus');
  });

  // Per-sheet rhythm type is the current behaviour of the AXIS-02 rules on top of task 06 delineation; non_sinus/undetermined
  // rows reflect delineation limits (see the task 07 report), not clinical truth.
  it.each([
    { name: 'a-01', type: 'sinus', sinusArrhythmia: true },
    { name: 'a-03', type: 'sinus', sinusArrhythmia: false },
    { name: 'a-04', type: 'undetermined', reasons: ['p_not_found'] }, // cat 224: P hidden in T in 18 of 19 complexes
    { name: 'a-05', type: 'sinus', sinusArrhythmia: false },
    { name: 'a-06', type: 'sinus', sinusArrhythmia: false },
    { name: 'a-08', type: 'sinus', sinusArrhythmia: false },
    // A 713 ms pause at RR ≈ 240 removes the sinus arrhythmia verdict (task 13: a pause is a finding for the specialist).
    { name: 'b-02', type: 'sinus', sinusArrhythmia: false },
  ])('$name: rhythm type $type', ({ name, type, sinusArrhythmia, reasons }) => {
    const r = rhythmOf(getFixture(name));
    expect(r.type).toBe(type);
    if (sinusArrhythmia !== undefined) expect(r.sinusArrhythmia).toBe(sinusArrhythmia);
    if (reasons) expect(r.reasons.filter((c) => c !== 'axis_leads_unreliable')).toEqual(reasons);
    expect(r.episodes).toEqual([]);
  });

  it.each(['a-01', 'a-03', 'a-05', 'b-01'])('%s: no extrasystoles detected (b-01 — marked sinus arrhythmia, not extrasystole)', (name) => {
    const r = rhythmOf(getFixture(name));
    expect(r.ectopics).toEqual([]);
  });

  it('b-01 (17-56-13): RR 545…1038 ms — either sinus rhythm with sinus arrhythmia, or "non-sinus" only due to missing P (P 1.8 px high is below the 2 px threshold of task 06 delineation: found in 5 of 7)', () => {
    const r = rhythmOf(getFixture('b-01'));
    if (r.type === 'sinus') expect(r.sinusArrhythmia).toBe(true);
    else {
      expect(r.type).toBe('non_sinus');
      // Task 13: P found in some complexes — a reason with counts instead of an absolute "P not found".
      expect(r.reasons.filter((c) => c !== 'axis_leads_unreliable')).toEqual(['p_not_all:5/7']);
    }
  });
});
