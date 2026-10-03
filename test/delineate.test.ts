import { describe, expect, it } from 'vitest';
import { delineate, detectBeats } from '../src/analysis/beats';
import { filterSignal } from '../src/analysis/filter';
import type { Delineation, Species } from '../src/types/contracts';
import { renderSignal, renderSixLeads, SIGNAL_FS, type SyntheticBeatTruth, type SyntheticSignalSpec } from './synthetic/signal';

const SAMPLE_MS = 1000 / SIGNAL_FS;

interface Item {
  d: Delineation;
  truth: SyntheticBeatTruth;
}

/** Delineation of all complete complexes of synthetic II; beats come from the detector over six leads of the same rhythm. */
function delineateAll(species: Species, spec: Omit<SyntheticSignalSpec, 'id'>, filter: boolean): { items: Item[]; mv: Float32Array } {
  const { signals, beats: truth } = renderSixLeads(spec);
  const beats = detectBeats(signals, species);
  const raw = signals.find((s) => s.id === 'II')!;
  const ii = filter ? filterSignal(raw, species) : raw;
  const items = truth
    .filter((t) => t.complete)
    .map((t) => {
      const beat = beats.find((b) => Math.abs(b.tMs - t.rPeak) <= 12);
      expect(beat, `beat at ${t.rPeak} ms not found`).toBeDefined();
      return { d: delineate(beat!, ii, species), truth: t };
    });
  expect(items.length).toBeGreaterThanOrEqual(4);
  return { items, mv: ii.mv };
}

const within = (got: number | null, truth: number | null, lo: number, hi: number): void => {
  expect(got).not.toBeNull();
  expect(truth).not.toBeNull();
  expect(got! - truth!).toBeGreaterThanOrEqual(lo);
  expect(got! - truth!).toBeLessThanOrEqual(hi);
};

describe('delineate: algorithm geometry on ideal synthetic complexes (no device smoothing or filter)', () => {
  it.each<Species>(['dog', 'cat'])('%s: Q onset and S end within ±1 sample, T end (tangent) within ±2, R and S peaks within ±1, P found, its bounds within ±1', (species) => {
    const { items, mv } = delineateAll(species, { species, durationMs: 5000, noiseMv: 0.003, smoothHz: 0 }, false);
    for (const { d, truth } of items) {
      within(d.qOn, truth.qOn, -SAMPLE_MS, SAMPLE_MS);
      within(d.sOff, truth.sOff, -SAMPLE_MS, SAMPLE_MS);
      within(d.tOff, truth.tOff, -2 * SAMPLE_MS, 2 * SAMPLE_MS);
      within(d.rPeak, truth.rPeak, -SAMPLE_MS, SAMPLE_MS);
      within(d.sPeak, truth.sPeak, -SAMPLE_MS, SAMPLE_MS);
      within(d.tPeak, truth.tPeak, -3 * SAMPLE_MS, 3 * SAMPLE_MS);
      expect(mv[Math.round(d.rPeak! / SAMPLE_MS)]).toBeGreaterThan(0);
      expect(mv[Math.round(d.sPeak! / SAMPLE_MS)]).toBeLessThan(0);
      expect(d.pFound).toBe(true);
      within(d.pOn, truth.pOn, -SAMPLE_MS, SAMPLE_MS);
      within(d.pOff, truth.pOff, -SAMPLE_MS, SAMPLE_MS);
      expect(d.confidence).toBeGreaterThanOrEqual(0.8);
      expect(d.reasons).toEqual([]);
    }
  });
});

describe('delineate: device path — print with 35 Hz filter and filterSignal', () => {
  // The device's 35 Hz smoothing and the 40/60 Hz LPF blur the corners: Q onset on the printed curve appears earlier
  // than ideal, S end and S trough later (task 06 measurement: dog −10 / +8.5 / +8.4 ms, cat −13 / +10 / +6 ms).
  // This is a property of the printed curve, not a delineation error: R peak, P and T end stay in place.
  it.each<Species>(['dog', 'cat'])('%s: R peak within ±1 sample, T end within ±3, P found with bounds within ±2; QRS bounds move outward by at most 16 ms', (species) => {
    const { items } = delineateAll(species, { species, durationMs: 5000, noiseMv: 0.004 }, true);
    for (const { d, truth } of items) {
      within(d.rPeak, truth.rPeak, -SAMPLE_MS, SAMPLE_MS);
      within(d.qOn, truth.qOn, -16, SAMPLE_MS);
      within(d.sOff, truth.sOff, -SAMPLE_MS, 16);
      within(d.sPeak, truth.sPeak, -SAMPLE_MS, 12);
      within(d.tOff, truth.tOff, -3 * SAMPLE_MS, 3 * SAMPLE_MS);
      expect(d.pFound).toBe(true);
      within(d.pOn, truth.pOn, -2 * SAMPLE_MS, 2 * SAMPLE_MS);
      within(d.pOff, truth.pOff, -2 * SAMPLE_MS, 2 * SAMPLE_MS);
      expect(d.pOff!).toBeLessThanOrEqual(d.qOn!);
      expect(d.confidence).toBeGreaterThanOrEqual(0.8);
    }
  });

  it.each<Species>(['dog', 'cat'])('%s: synthetic without P — pFound false for all, pOn/pOff null, reason p_not_found; QRS and T delineated', (species) => {
    const { items } = delineateAll(species, { species, durationMs: 5000, noiseMv: 0.004, beat: { p: 0 } }, true);
    for (const { d } of items) {
      expect(d.pFound).toBe(false);
      expect(d.pOn).toBeNull();
      expect(d.pOff).toBeNull();
      expect(d.reasons).toContain('p_not_found');
      expect(d.qOn).not.toBeNull();
      expect(d.tOff).not.toBeNull();
    }
  });

  it('beat outside the signal or empty signal: all bounds null, confidence 0, reason no_signal', () => {
    const { signal } = renderSignal({ species: 'dog', durationMs: 1000 });
    const beat = { index: 0, tMs: 5000, perLead: {}, confidence: 1, reasons: [] };
    const d = delineate(beat, signal, 'dog');
    expect(d.qOn).toBeNull();
    expect(d.pFound).toBe(false);
    expect(d.confidence).toBe(0);
    expect(d.reasons).toContain('no_signal');
  });
});
