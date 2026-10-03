import { describe, expect, it } from 'vitest';
import { beatProfileFor, checkPrintedHr, delineate, detectBeats } from '../src/analysis/beats';
import { filterSignal } from '../src/analysis/filter';
import { analyzePage } from '../src/core/page';
import { POLYSPECTRUM } from '../src/core/profile';
import type { Beat, Delineation, PageResult, Species } from '../src/types/contracts';
import { listFixtures, loadFixture, type Fixture } from './fixtures';

const speciesOf = (fixture: Fixture): Species => (fixture.expected.speciesLetter === 'к' ? 'cat' : 'dog');

interface Analyzed {
  page: PageResult;
  species: Species;
  beats: Beat[];
}

const cache = new Map<string, Analyzed>();
function analyzed(fixture: Fixture): Analyzed {
  let a = cache.get(fixture.name);
  if (!a) {
    const page = analyzePage(loadFixture(fixture), POLYSPECTRUM);
    const species = speciesOf(fixture);
    // The detector gets the raw sheet signals: it has its own band, and the 40 Hz LPF shifts a narrow QRS peak by a column.
    const beats = detectBeats(page.signals, species);
    a = { page, species, beats };
    cache.set(fixture.name, a);
  }
  return a;
}

const marksCache = new Map<string, Delineation[]>();
/** Delineation of all sheet beats on filtered II, with neighbours for the P and T windows. */
function delineated(fixture: Fixture): Analyzed & { marks: Delineation[] } {
  const a = analyzed(fixture);
  let marks = marksCache.get(fixture.name);
  if (!marks) {
    const ii = filterSignal(a.page.signals.find((s) => s.id === 'II')!, a.species);
    marks = a.beats.map((b, k) =>
      delineate(b, ii, a.species, { precision: a.page.precision, prevTMs: a.beats[k - 1]?.tMs, nextTMs: a.beats[k + 1]?.tMs }),
    );
    marksCache.set(fixture.name, marks);
  }
  return { ...a, marks };
}

describe('beats on real sheets vs printed HR digits (seam analyzePage → filter → beats)', () => {
  describe.each(listFixtures())('$name', (fixture) => {
    it('each digit is matched to the interval below it within ±3 bpm or is an edge one; found beats are exactly the chain of matched intervals (+1)', () => {
      const { page, beats } = analyzed(fixture);
      expect(page.meta.hrRow.map((h) => h.value)).toEqual(fixture.expected.hrRow);
      const check = checkPrintedHr(beats, page.meta, page.layout, page.calib);
      const unmatched = check.unmatched ?? [];
      expect(check.mismatches).toEqual([]);
      expect(check.matched + unmatched.length).toBe(page.meta.hrRow.length);
      // Only an edge digit may be left without an interval below it (beat beyond the sheet edge or cut by the frame).
      for (const k of unmatched) expect([0, page.meta.hrRow.length - 1]).toContain(k);
      expect(beats.length).toBe(check.matched + 1);
    });

    it('every beat has a position in II and snake_case reason codes; confidence in 0..1', () => {
      const { beats } = analyzed(fixture);
      expect(beats.length).toBeGreaterThan(0);
      beats.forEach((b, k) => {
        expect(b.index).toBe(k);
        expect(b.perLead.II).toBeDefined();
        expect(b.confidence).toBeGreaterThanOrEqual(0);
        expect(b.confidence).toBeLessThanOrEqual(1);
        for (const r of b.reasons) expect(r).toMatch(/^[a-z0-9_]+(:[^\s]+)?$/);
      });
    });

    it('II delineation of each beat: QRS found and no wider than 1.5× the species norm limit plus tangent overshoots (8 ms per side); each found P lies in the species window before QRS and is not longer than allowed', () => {
      const { species, marks } = delineated(fixture);
      const profile = beatProfileFor(species);
      for (const d of marks) {
        expect(d.qOn).not.toBeNull();
        expect(d.sOff! - d.qOn!).toBeLessThanOrEqual(profile.qrsRegionMaxMs + 16);
      }
      for (const d of marks.filter((m) => m.pFound)) {
        expect(d.pOn!).toBeLessThan(d.pOff!);
        expect(d.pOff!).toBeLessThanOrEqual(d.qOn!);
        expect(d.qOn! - d.pOn!).toBeLessThanOrEqual(profile.pSearch.maxMs + profile.pDuration.maxMs);
        expect(d.pOff! - d.pOn!).toBeLessThanOrEqual(profile.pDuration.maxMs);
      }
    });
  });

  it('on dog sheets P is found for at least 80 % of II complexes (all dog sheets combined; task 06 measurement: 71 of 83)', () => {
    // Per sheet: a-01 12/12, a-08 14/14, b-02 16/17 — but a-02 (230 bpm, P lies on the previous beat's T) 14/20,
    // a-06 (tremor, deformed complexes) 10/13, b-01 (P 1.8 px high — below the spec threshold of 2 px) 5/7.
    let found = 0;
    let total = 0;
    for (const fixture of listFixtures().filter((f) => speciesOf(f) === 'dog')) {
      const { marks } = delineated(fixture);
      found += marks.filter((d) => d.pFound).length;
      total += marks.length;
    }
    expect(total).toBeGreaterThan(50);
    expect(found / total).toBeGreaterThanOrEqual(0.8);
  });
});
