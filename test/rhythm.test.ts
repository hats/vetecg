import { describe, expect, it } from 'vitest';
import { delineate, detectBeats } from '../src/analysis/beats';
import { filterSignal } from '../src/analysis/filter';
import { analyzeRhythm, analyzeRhythmPages } from '../src/analysis/rhythm';
import type { Beat, Delineation, LeadId, LeadSignal, PageBeats, Species } from '../src/types/contracts';
import { analyzePage } from '../src/core/page';
import { POLYSPECTRUM } from '../src/core/profile';
import { getFixture, loadFixture } from './fixtures';
import { renderSixLeads, type SyntheticBeatSpec, type SyntheticBeatTruth, type SyntheticSignalSpec } from './synthetic/signal';

const SAMPLE_MS = 2;

interface Synthetic {
  species: Species;
  signals: LeadSignal[];
  beats: Beat[];
  marks: Delineation[];
  truth: SyntheticBeatTruth[];
}

/** Task 06 chain on six synthetic leads: beats from the detector, delineation of filtered II with neighbours. */
function analyzeSynthetic(spec: Omit<SyntheticSignalSpec, 'id'>, scales?: Partial<Record<LeadId, number>>): Synthetic {
  const { signals, beats: truth } = renderSixLeads(spec, scales);
  const beats = detectBeats(signals, spec.species);
  const ii = filterSignal(signals.find((s) => s.id === 'II')!, spec.species);
  const marks = beats.map((b, k) => delineate(b, ii, spec.species, { prevTMs: beats[k - 1]?.tMs, nextTMs: beats[k + 1]?.tMs }));
  return { species: spec.species, signals, beats, marks, truth };
}

/** Wide "ventricular" complex without P: QRS 110 ms, deep S, T of opposite polarity. */
const VE_SHAPE: Partial<SyntheticBeatSpec> = { p: 0, q: 0, r: 1.3, s: 0.6, t: -0.5, qrsMs: 110, qtMs: 280, tDurationMs: 110 };
/** VE polarity per lead: negative in I and aVF — focus presumably in the left ventricle. */
const VE_SCALES: Partial<Record<LeadId, number>> = { I: -0.7, II: 1, III: 1, aVR: 0.5, aVL: -0.3, aVF: -0.6 };

/** Base sinus rhythm with pauses into which ectopic complexes of a different shape are mixed (signals are summed). */
function withEctopics(base: Omit<SyntheticSignalSpec, 'id'>, ectopicOnsetsMs: number[], shape = VE_SHAPE, scales = VE_SCALES): Synthetic {
  const { signals } = renderSixLeads(base);
  for (const onset of ectopicOnsetsMs) {
    const ve = renderSixLeads({ species: base.species, durationMs: base.durationMs, firstBeatMs: onset, rrMs: [], beat: shape, noiseMv: 0 }, scales);
    signals.forEach((s, k) => {
      for (let i = 0; i < s.mv.length; i++) s.mv[i] += ve.signals[k].mv[i];
    });
  }
  const beats = detectBeats(signals, base.species);
  const ii = filterSignal(signals.find((s) => s.id === 'II')!, base.species);
  const marks = beats.map((b, k) => delineate(b, ii, base.species, { prevTMs: beats[k - 1]?.tMs, nextTMs: beats[k + 1]?.tMs }));
  return { species: base.species, signals, beats, marks, truth: [] };
}

const page = (s: Synthetic, pageNo: number, offsetMs: number): PageBeats => ({ page: pageNo, offsetMs, beats: s.beats, delineations: s.marks, signals: s.signals });

/** Expected axis — atan2 of the net QRS areas in aVF and I, integrated over the signal on the true window [qOn, sOff]. */
function expectedAxis(signals: LeadSignal[], t: SyntheticBeatTruth): number {
  const area = (id: LeadId): number => {
    const mv = signals.find((s) => s.id === id)!.mv;
    let sum = 0;
    for (let i = Math.round(t.qOn / SAMPLE_MS); i <= Math.round(t.sOff / SAMPLE_MS); i++) sum += mv[i];
    return sum;
  };
  return (Math.atan2(area('aVF'), area('I')) * 180) / Math.PI;
}

describe('analyzeRhythm: electrical axis from net QRS areas in I and aVF', () => {
  it.each([
    { name: 'axis down-left (I 0.6, aVF 0.85)', scales: { I: 0.6, aVF: 0.85 } },
    { name: 'axis right (I −0.5, aVF 0.85)', scales: { I: -0.5, aVF: 0.85 } },
    { name: 'axis left-up (I 0.7, aVF −0.4)', scales: { I: 0.7, aVF: -0.4 } },
  ])('$name: axis within ±5° of atan2 of the clean signal areas', ({ scales }) => {
    const s = analyzeSynthetic({ species: 'dog', durationMs: 5000, noiseMv: 0 }, scales);
    const report = analyzeRhythm(s.beats, s.marks, s.signals, 'dog', 5000);
    const expected = expectedAxis(s.signals, s.truth.filter((t) => t.complete)[1]);
    expect(report.axisDeg).not.toBeNull();
    const diff = Math.abs(((report.axisDeg! - expected + 540) % 360) - 180);
    expect(diff, `axis ${report.axisDeg} vs ${expected}`).toBeLessThanOrEqual(5);
  });

  it('I with confidence 0.3 — axis undetermined with reason axis_leads_unreliable; the other report fields are filled', () => {
    const s = analyzeSynthetic({ species: 'dog', durationMs: 5000, noiseMv: 0.003 });
    const signals = s.signals.map((x) => (x.id === 'I' ? { ...x, confidence: 0.3 } : x));
    const report = analyzeRhythm(s.beats, s.marks, signals, 'dog', 5000);
    expect(report.axisDeg).toBeNull();
    expect(report.reasons).toContain('axis_leads_unreliable');
    expect(report.type).toBe('sinus');
    expect(report.ectopics).toEqual([]);
    expect(report.episodes).toEqual([]);
  });
});

describe('analyzeRhythm: rhythm type and sinus arrhythmia', () => {
  it.each<Species>(['dog', 'cat'])('%s: regular rhythm with P — sinus with no reasons and no arrhythmia; no ectopics or episodes', (species) => {
    const s = analyzeSynthetic({ species, durationMs: 5000, noiseMv: 0.003 });
    const report = analyzeRhythm(s.beats, s.marks, s.signals, species, 5000);
    expect(report.type).toBe('sinus');
    expect(report.reasons).toEqual([]);
    expect(report.sinusArrhythmia).toBe(false);
    expect(report.ectopics).toEqual([]);
    expect(report.episodes).toEqual([]);
  });

  it('dog without P waves — non-sinus rhythm with reason p_not_found, a no-P stretch of ≥ 3 beats — episode no_p', () => {
    const s = analyzeSynthetic({ species: 'dog', durationMs: 5000, noiseMv: 0.003, beat: { p: 0 } });
    const report = analyzeRhythm(s.beats, s.marks, s.signals, 'dog', 5000);
    expect(report.type).toBe('non_sinus');
    expect(report.reasons).toContain('p_not_found');
    expect(report.sinusArrhythmia).toBe(false);
    expect(report.episodes.length).toBe(1);
    expect(report.episodes[0].kind).toBe('no_p');
    expect(report.episodes[0].beats.length).toBeGreaterThanOrEqual(3);
  });

  it.each<Species>(['dog', 'cat'])('%s: respiratory RR wave 460…620 ms (variation > 10 %) — sinus arrhythmia with sinus rhythm, no ectopics', (species) => {
    const rr = [460, 520, 580, 620, 580, 520, 460, 440, 480, 540];
    const s = analyzeSynthetic({ species, durationMs: 6000, firstBeatMs: 300, rrMs: rr, noiseMv: 0.003 });
    const report = analyzeRhythm(s.beats, s.marks, s.signals, species, 6000);
    expect(report.type).toBe('sinus');
    expect(report.sinusArrhythmia).toBe(true);
    expect(report.ectopics).toEqual([]);
  });
});

describe('analyzeRhythm: ectopics and episodes', () => {
  it('supraventricular: a beat with RR 320 in a 500 rhythm, same shape with P — one SVE, atrial focus, coupling 320 ±10 ms', () => {
    const s = analyzeSynthetic({ species: 'dog', durationMs: 5000, firstBeatMs: 300, rrMs: [500, 500, 500, 320, 680, 500, 500, 500], noiseMv: 0.003 });
    const report = analyzeRhythm(s.beats, s.marks, s.signals, 'dog', 5000);
    expect(report.ectopics.length).toBe(1);
    const [e] = report.ectopics;
    expect(e.kind).toBe('SVE');
    expect(e.focus).toBe('atrial');
    expect(Math.abs(e.couplingMs - 320)).toBeLessThanOrEqual(10);
    expect(s.beats[e.beat]).toBeDefined();
    expect(report.episodes).toEqual([]);
    expect(report.type).toBe('sinus');
  });

  it('II with confidence 0.3: arrhythmias are computed from the other leads — SVE found, rhythm type undetermined with reason lead_ii_unreliable, I/aVF axis present', () => {
    const s = analyzeSynthetic({ species: 'dog', durationMs: 5000, firstBeatMs: 300, rrMs: [500, 500, 500, 320, 680, 500, 500, 500], noiseMv: 0.003 });
    const signals = s.signals.map((x) => (x.id === 'II' ? { ...x, confidence: 0.3 } : x));
    const report = analyzeRhythm(s.beats, s.marks, signals, 'dog', 5000);
    expect(report.ectopics.length).toBe(1);
    expect(Math.abs(report.ectopics[0].couplingMs - 320)).toBeLessThanOrEqual(10);
    expect(report.ectopics[0].kind).toBe('SVE');
    expect(report.type).toBe('undetermined');
    expect(report.reasons).toContain('lead_ii_unreliable');
    expect(report.axisDeg).not.toBeNull();
    expect(report.episodes).toEqual([]);
  });

  it('ventricular: a wide complex of a different shape without P in a rhythm pause — one VE, focus by I/aVF polarity — left ventricle, coupling ≈ 337 ms', () => {
    // Sinus QRS start at 300, 800, 1300, 1800, then a pause until 2800; the VE starts at 2110 (R at 2165, previous R at 1828).
    const s = withEctopics({ species: 'dog', durationMs: 5000, firstBeatMs: 300, rrMs: [500, 500, 500, 1000, 500, 500, 500], noiseMv: 0.003 }, [2110]);
    const report = analyzeRhythm(s.beats, s.marks, s.signals, 'dog', 5000);
    expect(report.ectopics.length).toBe(1);
    const [e] = report.ectopics;
    expect(e.kind).toBe('VE');
    expect(e.focus).toBe('left_ventricle');
    expect(Math.abs(e.couplingMs - 337)).toBeLessThanOrEqual(12);
    expect(report.episodes).toEqual([]);
  });

  it('a run of four VEs (RR 300) — one ve_run episode of 4 beats, start ≈ 2.16 s, duration ≈ 1.2 s; a normal recording — empty lists', () => {
    const s = withEctopics({ species: 'dog', durationMs: 5000, firstBeatMs: 300, rrMs: [500, 500, 500, 2000, 500, 500], noiseMv: 0.003 }, [2100, 2400, 2700, 3000]);
    const report = analyzeRhythm(s.beats, s.marks, s.signals, 'dog', 5000);
    expect(report.ectopics.length).toBe(4);
    expect(report.ectopics.every((e) => e.kind === 'VE')).toBe(true);
    expect(report.episodes.length).toBe(1);
    const [ep] = report.episodes;
    expect(ep.kind).toBe('ve_run');
    expect(ep.beats.length).toBe(4);
    expect(Math.abs(ep.startMs - 2155)).toBeLessThanOrEqual(12);
    expect(Math.abs(ep.durationMs - 1200)).toBeLessThanOrEqual(60);
    expect(ep.focus).toBe('left_ventricle');
  });

  it.each<Species>(['dog', 'cat'])('%s: RR pause of 1100 ms in a 500 rhythm (≥ 2 × median) — one pause ≈ 1100 ms, no sinus arrhythmia', (species) => {
    const s = analyzeSynthetic({ species, durationMs: 6000, firstBeatMs: 300, rrMs: [500, 500, 500, 1100, 500, 500, 500, 500], noiseMv: 0.003 });
    const report = analyzeRhythm(s.beats, s.marks, s.signals, species, 6000);
    expect(report.pauses?.length).toBe(1);
    expect(Math.abs(report.pauses![0].durationMs - 1100)).toBeLessThanOrEqual(10);
    expect(report.sinusArrhythmia).toBe(false);
    expect(report.ectopics).toEqual([]);
  });

  it('a-02 (17-56-08): rhythm verdict agrees with P delineation — «P найден перед 14 из 18» sinus complexes (not «P не найден»)', () => {
    // Fixture breakdown (task 13): 20 beats, 2 premature VEs (coupling 166 ms) without P; of the other 18
    // `delineate` found P in 14 — the same 14 for which the overlay draws P; 14/18 = 78 % < 90 % (AXIS-02) — non-sinus.
    const page = analyzePage(loadFixture(getFixture('a-02')), POLYSPECTRUM);
    const beats = detectBeats(page.signals, 'dog');
    const ii = filterSignal(page.signals.find((x) => x.id === 'II')!, 'dog');
    const marks = beats.map((b, k) => delineate(b, ii, 'dog', { precision: page.precision, prevTMs: beats[k - 1]?.tMs, nextTMs: beats[k + 1]?.tMs }));
    const report = analyzeRhythm(beats, marks, page.signals, 'dog', 5358);
    expect(report.type).toBe('non_sinus');
    expect(report.reasons).toContain('p_not_all:14/18');
    expect(report.reasons).not.toContain('p_not_found');
  });

  it('b-02 (17-56-22): one pause ≈ 713 ms (RR 2114 → 2824 ms with median ≈ 245) — no sinus arrhythmia', () => {
    const page = analyzePage(loadFixture(getFixture('b-02')), POLYSPECTRUM);
    const beats = detectBeats(page.signals, 'dog');
    const ii = filterSignal(page.signals.find((x) => x.id === 'II')!, 'dog');
    const marks = beats.map((b, k) => delineate(b, ii, 'dog', { precision: page.precision, prevTMs: beats[k - 1]?.tMs, nextTMs: beats[k + 1]?.tMs }));
    const report = analyzeRhythm(beats, marks, page.signals, 'dog', 5230);
    expect(report.pauses?.length).toBe(1);
    expect(Math.abs(report.pauses![0].durationMs - 713)).toBeLessThanOrEqual(12);
    expect(report.sinusArrhythmia).toBe(false);
  });

  it('a compensatory pause after ectopics (RR ≈ 1073 ms after a run, ≈ 1000 after a single VE with median 500) — not a pause', () => {
    const run = withEctopics({ species: 'dog', durationMs: 5000, firstBeatMs: 300, rrMs: [500, 500, 500, 2000, 500, 500], noiseMv: 0.003 }, [2100, 2400, 2700]);
    expect(analyzeRhythm(run.beats, run.marks, run.signals, 'dog', 5000).pauses).toEqual([]);
    const single = withEctopics({ species: 'dog', durationMs: 5000, firstBeatMs: 300, rrMs: [500, 500, 500, 1000, 500, 500, 500], noiseMv: 0.003 }, [2110]);
    const report = analyzeRhythm(single.beats, single.marks, single.signals, 'dog', 5000);
    expect(report.ectopics.length).toBe(1);
    expect(report.pauses).toEqual([]);
  });

  it('a run of three VEs: each coupling is measured from the last sinus beat (R 1828 ms) — ≈ 327, 627, 927 ms; the episode has the first one\'s coupling', () => {
    // Sinus QRS start at 300…1800 (R ≈ onset + 28 ms), VEs at 2100, 2400, 2700 (R ≈ onset + 55 ms).
    const s = withEctopics({ species: 'dog', durationMs: 5000, firstBeatMs: 300, rrMs: [500, 500, 500, 2000, 500, 500], noiseMv: 0.003 }, [2100, 2400, 2700]);
    const report = analyzeRhythm(s.beats, s.marks, s.signals, 'dog', 5000);
    expect(report.ectopics.length).toBe(3);
    // Tolerance 20 ms: the T of the previous VE (−0.5 mV) overlaps the next one and shifts the peak consensus by up to ~17 ms.
    // The old rule (RR to the previous beat) would give ≈ 327, 300, 300 — far beyond tolerance.
    [327, 627, 927].forEach((expected, k) => expect(Math.abs(report.ectopics[k].couplingMs - expected)).toBeLessThanOrEqual(20));
    expect(report.episodes.length).toBe(1);
    expect(Math.abs(report.episodes[0].couplingMs - 327)).toBeLessThanOrEqual(12);
  });

  it('two synthetic sheets with an offset: the ectopic on the second sheet gets a global index, medians and axis are computed over both', () => {
    const a = analyzeSynthetic({ species: 'dog', durationMs: 5000, noiseMv: 0.003 });
    const b = analyzeSynthetic({ species: 'dog', durationMs: 5000, firstBeatMs: 300, rrMs: [500, 500, 500, 320, 680, 500, 500, 500], noiseMv: 0.003 });
    const report = analyzeRhythmPages([page(a, 3, 0), page(b, 4, 6000)], 'dog');
    expect(report.ectopics.length).toBe(1);
    expect(report.ectopics[0].beat).toBeGreaterThanOrEqual(a.beats.length);
    expect(report.type).toBe('sinus');
    expect(report.axisDeg).not.toBeNull();
    // The ectopic on the second sheet does not break the regular rhythm of the first: no sinus arrhythmia, no episodes.
    expect(report.sinusArrhythmia).toBe(false);
    expect(report.episodes).toEqual([]);
  });
});
