import { describe, expect, it } from 'vitest';
import { delineate, detectBeats } from '../src/analysis/beats';
import { filterSignal } from '../src/analysis/filter';
import { measure, measurePages } from '../src/analysis/measure';
import type { Beat, Delineation, LeadSignal, MeasurementKey, Species } from '../src/types/contracts';
import { renderSixLeads, type SyntheticBeatTruth, type SyntheticSignalSpec } from './synthetic/signal';

const ALL_KEYS: MeasurementKey[] = ['hrMean', 'hrMin', 'hrMax', 'pDuration', 'pAmplitude', 'pq', 'q', 'qrs', 'r', 's', 'qt', 'qtc', 't', 'st'];

interface Synthetic {
  species: Species;
  signals: LeadSignal[];
  beats: Beat[];
  marks: Delineation[];
  truth: SyntheticBeatTruth[];
}

/**
 * Task 06 chain on six synthetic leads: beats from the detector, II delineation with neighbours.
 * `filter: false` — delineation on the raw signal (geometry without LPF blur, as in the first block of `delineate.test.ts`).
 */
function analyzeSynthetic(spec: Omit<SyntheticSignalSpec, 'id'>, scales?: Parameters<typeof renderSixLeads>[1], filter = true): Synthetic {
  const { signals, beats: truth } = renderSixLeads(spec, scales);
  const beats = detectBeats(signals, spec.species);
  const rawII = signals.find((s) => s.id === 'II')!;
  const ii = filter ? filterSignal(rawII, spec.species) : rawII;
  const marks = beats.map((b, k) => delineate(b, ii, spec.species, { prevTMs: beats[k - 1]?.tMs, nextTMs: beats[k + 1]?.tMs }));
  return { species: spec.species, signals, beats, marks, truth };
}

describe('measure: HR from RR intervals', () => {
  it('dog 120 bpm on six synthetic leads: hrMean 120 ±1, hrMin/hrMax 120 ±2, source lead_ii, all beats listed; all 14 keys have units', () => {
    const s = analyzeSynthetic({ species: 'dog', durationMs: 5000, noiseMv: 0.003 });
    const m = measure(s.beats, s.marks, s.signals, 'dog');
    expect(Object.keys(m).sort()).toEqual([...ALL_KEYS].sort());
    for (const key of ALL_KEYS) expect(m[key].unit, key).not.toBe('');
    expect(Math.abs(m.hrMean.value! - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.hrMin.value! - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.hrMax.value! - 120)).toBeLessThanOrEqual(2);
    expect(m.hrMean.unit).toBe('уд/мин');
    expect(m.hrMean.source).toBe('lead_ii');
    expect(m.hrMean.beats).toEqual(s.beats.map((b) => b.index));
    expect(m.hrMean.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

const NO_WIDENING = { printWidening: { onsetMs: 0, offsetMs: 0 } };
/** 0.5 px on the variant A grid at 10 mm/mV — amplitude tolerance from the acceptance criterion. */
const HALF_PX_MV = 0.5 / (4.305 * 10);
const SAMPLE_MS = 2;

/** Amplitude truth — from the II signal itself over the true wave windows (not from the preset: peaks may fall between samples). */
function amplitudesFromSignal(mv: Float32Array, t: SyntheticBeatTruth): { p: number; q: number; r: number; s: number; t: number } {
  const i = (ms: number) => Math.round(ms / SAMPLE_MS);
  const extreme = (a: number, b: number, pick: 'max' | 'min') => {
    let best = mv[i(a)];
    for (let k = i(a); k <= i(b); k++) best = pick === 'max' ? Math.max(best, mv[k]) : Math.min(best, mv[k]);
    return best;
  };
  return {
    p: extreme(t.pOn!, t.pOff!, 'max'),
    q: extreme(t.qOn, t.rPeak, 'min'),
    r: extreme(t.qOn, t.sOff, 'max'),
    s: extreme(t.rPeak, t.sOff, 'min'),
    t: mv[i(t.tPeak)],
  };
}

describe('measure: II waves on ideal synthetic data (no device smoothing, no print compensation)', () => {
  it.each<Species>(['dog', 'cat'])('%s: P, PQ, QRS, QT durations within ±1 sample of truth; P, Q, R, S, T amplitudes within ±0.5 px of the signal; Q and S negative; ST ≈ 0; QTc by Van de Water for dog, n/a for cat', (species) => {
    const s = analyzeSynthetic({ species, durationMs: 5000, noiseMv: 0, smoothHz: 0 }, undefined, false);
    const m = measure(s.beats, s.marks, s.signals, species, NO_WIDENING);
    const full = s.truth.filter((t) => t.complete);
    const beat = s.truth[0];
    const spec = { pDuration: beat.pOff! - beat.pOn!, pq: beat.qOn - beat.pOn!, qrs: beat.sOff - beat.qOn, qt: beat.tOff - beat.qOn };
    for (const [key, ms] of Object.entries(spec) as [MeasurementKey, number][]) {
      expect(m[key].unit, key).toBe('с');
      expect(Math.abs(m[key].value! * 1000 - ms), key).toBeLessThanOrEqual(SAMPLE_MS);
      expect(m[key].confidence, key).toBeGreaterThanOrEqual(0.8);
      expect(m[key].beats.length, key).toBeGreaterThanOrEqual(full.length - 1);
    }
    const ii = s.signals.find((x) => x.id === 'II')!.mv;
    const truthAmp = amplitudesFromSignal(ii, full[1]);
    for (const key of ['pAmplitude', 'q', 'r', 's', 't'] as const) {
      const expected = truthAmp[key === 'pAmplitude' ? 'p' : key];
      expect(m[key].unit, key).toBe('мВ');
      expect(Math.abs(m[key].value! - expected), `${key}: ${m[key].value} vs ${expected}`).toBeLessThanOrEqual(HALF_PX_MV);
    }
    expect(m.q.value).toBeLessThan(0);
    expect(m.s.value).toBeLessThan(0);
    expect(m.r.value).toBeGreaterThan(0);
    // ST — signal value at J + 60 ms (dog) / J + 40 ms (cat) from the true QRS end (MEAS-10);
    // in this synthetic signal the point already lies on the T upslope, so the expectation comes from the signal, not 0.
    const stPoint = full[1].sOff + (species === 'dog' ? 60 : 40);
    expect(Math.abs(m.st.value! - ii[Math.round(stPoint / SAMPLE_MS)])).toBeLessThanOrEqual(HALF_PX_MV);
    expect(m.st.unit).toBe('мВ');
    if (species === 'dog') {
      // QTc = QT − 0.087·(RR − 1): RR 0.5 s at 120 bpm.
      expect(Math.abs(m.qtc.value! - (spec.qt / 1000 + 0.087 * 0.5))).toBeLessThanOrEqual(0.003);
    } else {
      expect(m.qtc.value).toBeNull();
      expect(m.qtc.reason).toBeDefined();
    }
  });
});

describe('measurePages: manual II baseline (story 20, baselineShiftMv)', () => {
  it('II digitized from a line 0.2 mV below the automatic one: without the option the reference is local PQ (offset removed), with a 0.2 mV shift — PQ lowered by the shift (P, R, T, ST higher by 0.2 mV); another sheet number has no effect', () => {
    const offset = 0.2;
    const s = analyzeSynthetic({ species: 'dog', durationMs: 5000, noiseMv: 0, smoothHz: 0 }, undefined, false);
    const signals = s.signals.map((x) => (x.id === 'II' ? { ...x, mv: x.mv.map((v) => v + offset) } : x));
    const page = { page: 3, offsetMs: 0, beats: s.beats, delineations: s.marks, signals };
    const auto = measurePages([page], 'dog', NO_WIDENING);
    const manual = measurePages([page], 'dog', { ...NO_WIDENING, baselineShiftMv: { 3: offset } });
    const other = measurePages([page], 'dog', { ...NO_WIDENING, baselineShiftMv: { 0: offset } });
    const clean = s.signals.find((x) => x.id === 'II')!.mv;
    const full = s.truth.filter((t) => t.complete);
    const truthAmp = amplitudesFromSignal(clean, full[1]);
    const stTruth = clean[Math.round((full[1].sOff + 60) / SAMPLE_MS)];
    const expected = { pAmplitude: truthAmp.p, r: truthAmp.r, t: truthAmp.t, st: stTruth };
    for (const [key, value] of Object.entries(expected) as ['pAmplitude' | 'r' | 't' | 'st', number][]) {
      expect(Math.abs(auto[key].value! - value), `auto ${key}`).toBeLessThanOrEqual(HALF_PX_MV);
      expect(Math.abs(manual[key].value! - (value + offset)), `manual ${key}`).toBeLessThanOrEqual(HALF_PX_MV);
      expect(other[key].value, `other ${key}`).toBe(auto[key].value);
    }
    // Durations do not depend on the baseline.
    for (const key of ['pDuration', 'pq', 'qrs', 'qt', 'hrMean'] as const) expect(manual[key].value, key).toBe(auto[key].value);
  });
});

describe('measure: device path — 35 Hz print, filterSignal, default QRS widening compensation', () => {
  // P bounds and T end on the printed curve drift by ±2 ms (task 06 delineation), with no compensation for them:
  // PQ and QT are checked within ±2 samples, P duration within ±2.5; QRS after compensation within ±1 sample.
  it.each<Species>(['dog', 'cat'])('%s: QRS ±1 sample, PQ and QT ±2, P ±2.5; amplitudes ±0.5 px of the printed curve; cat Q below 2 px — 0 flagged q_absent', (species) => {
    const s = analyzeSynthetic({ species, durationMs: 5000, noiseMv: 0.004 });
    const m = measure(s.beats, s.marks, s.signals, species);
    const beat = s.truth[0];
    expect(Math.abs(m.qrs.value! * 1000 - (beat.sOff - beat.qOn))).toBeLessThanOrEqual(SAMPLE_MS);
    expect(Math.abs(m.pq.value! * 1000 - (beat.qOn - beat.pOn!))).toBeLessThanOrEqual(2 * SAMPLE_MS);
    expect(Math.abs(m.qt.value! * 1000 - (beat.tOff - beat.qOn))).toBeLessThanOrEqual(2 * SAMPLE_MS);
    expect(Math.abs(m.pDuration.value! * 1000 - (beat.pOff! - beat.pOn!))).toBeLessThanOrEqual(2.5 * SAMPLE_MS);
    // Amplitude truth — the same printed curve without noise.
    const clean = renderSixLeads({ species, durationMs: 5000, noiseMv: 0 }).signals.find((x) => x.id === 'II')!.mv;
    const truthAmp = amplitudesFromSignal(clean, s.truth.filter((t) => t.complete)[1]);
    const twoPx = 2 / (4.305 * 10);
    for (const key of ['pAmplitude', 'r', 's', 't'] as const) {
      const expected = truthAmp[key === 'pAmplitude' ? 'p' : key];
      expect(Math.abs(m[key].value! - expected), `${key}: ${m[key].value} vs ${expected}`).toBeLessThanOrEqual(HALF_PX_MV);
    }
    if (Math.abs(truthAmp.q) >= twoPx) {
      expect(Math.abs(m.q.value! - truthAmp.q)).toBeLessThanOrEqual(HALF_PX_MV);
    } else {
      expect(m.q.value).toBe(0);
      expect(m.q.reason).toBe('q_absent');
    }
  });
});

describe('measure: unreliable II and empty inputs', () => {
  it('II with confidence 0.3: all wave measurements null with reason lead_ii_unreliable, HR from lead consensus with source all_leads', () => {
    const s = analyzeSynthetic({ species: 'dog', durationMs: 5000, noiseMv: 0.003 });
    const signals = s.signals.map((x) => (x.id === 'II' ? { ...x, confidence: 0.3 } : x));
    const m = measure(s.beats, s.marks, signals, 'dog');
    for (const key of ['pDuration', 'pAmplitude', 'pq', 'q', 'qrs', 'r', 's', 'qt', 'qtc', 't', 'st'] as const) {
      expect(m[key].value, key).toBeNull();
      expect(m[key].reason, key).toBe('lead_ii_unreliable');
      expect(m[key].beats, key).toEqual([]);
    }
    expect(Math.abs(m.hrMean.value! - 120)).toBeLessThanOrEqual(1);
    expect(m.hrMean.source).toBe('all_leads');
    expect(m.hrMin.source).toBe('all_leads');
  });

  it('two synthetic sheets with a 6 s offset: HR and medians over the merged array, global beat indices, R — median across sheets', () => {
    const a = analyzeSynthetic({ species: 'dog', durationMs: 5000, noiseMv: 0.003, beat: { r: 1.5 } });
    const b = analyzeSynthetic({ species: 'dog', durationMs: 5000, noiseMv: 0.003, hrBpm: 150, beat: { r: 1.0 } });
    const m = measurePages(
      [
        { page: 0, offsetMs: 0, beats: a.beats, delineations: a.marks, signals: a.signals },
        { page: 1, offsetMs: 6000, beats: b.beats, delineations: b.marks, signals: b.signals },
      ],
      'dog',
    );
    const total = a.beats.length + b.beats.length;
    expect(m.hrMean.beats.length).toBe(total);
    expect(Math.max(...m.qrs.beats)).toBeGreaterThanOrEqual(a.beats.length);
    expect(Math.abs(m.hrMin.value! - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.hrMax.value! - 150)).toBeLessThanOrEqual(2);
    // Mean HR — 60000 / mean RR over all intervals of both sheets.
    const rrA = 60000 / 120;
    const rrB = 60000 / 150;
    const expectedMean = 60000 / ((rrA * (a.beats.length - 1) + rrB * (b.beats.length - 1)) / (total - 2));
    expect(Math.abs(m.hrMean.value! - expectedMean)).toBeLessThanOrEqual(1.5);
    // R — median over the merged set: lies between 1.0 and 1.5 mV (slightly lower after print smoothing).
    expect(m.r.value!).toBeGreaterThan(0.9);
    expect(m.r.value!).toBeLessThan(1.5);
    expect(m.r.beats.length).toBeGreaterThanOrEqual(total - 4);
  });

  it('no beats — everything null with reason no_beats; no sheets — no_pages', () => {
    const s = analyzeSynthetic({ species: 'dog', durationMs: 5000 });
    const none = measure([], [], s.signals, 'dog');
    for (const key of ALL_KEYS) {
      expect(none[key].value, key).toBeNull();
      expect(none[key].reason, key).toBe('no_beats');
    }
    const noPages = measurePages([], 'cat');
    for (const key of ALL_KEYS) expect(noPages[key].reason, key).toBe('no_pages');
  });
});
