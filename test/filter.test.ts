import { describe, expect, it } from 'vitest';
import { filterSignal } from '../src/analysis/filter';
import type { LeadSignal, Species } from '../src/types/contracts';
import { renderSignal, SIGNAL_FS } from './synthetic/signal';

const SAMPLE_MS = 1000 / SIGNAL_FS;
const at = (ms: number): number => Math.round(ms / SAMPLE_MS);

/** Signal maximum in a ±`halfMs` window around moment `ms`. */
function peakNear(mv: ArrayLike<number>, ms: number, halfMs = 8): number {
  let best = -Infinity;
  for (let i = at(ms - halfMs); i <= at(ms + halfMs); i++) if (i >= 0 && i < mv.length && mv[i] > best) best = mv[i];
  return best;
}

/** Baseline level before the complex — median of the PQ segment (20…4 ms before QRS onset). */
function baselineBefore(mv: ArrayLike<number>, qOnMs: number): number {
  const seg: number[] = [];
  for (let i = at(qOnMs - 20); i <= at(qOnMs - 4); i++) seg.push(mv[i]);
  seg.sort((a, b) => a - b);
  return seg[Math.floor(seg.length / 2)];
}

/** R amplitude from the local baseline: the HPF removes the mean, so the peak cannot be compared "from zero". */
function rAmplitude(mv: ArrayLike<number>, beat: { rPeak: number; qOn: number }): number {
  return peakNear(mv, beat.rPeak) - baselineBefore(mv, beat.qOn);
}

describe('filterSignal: HPF 0.5 Hz and LPF 40 Hz (dog) / 60 Hz (cat), zero phase', () => {
  it.each<Species>(['dog', 'cat'])('%s: R amplitude drops by less than three percent after the filter, the peak does not shift', (species) => {
    const { signal, beats } = renderSignal({ species, durationMs: 4000 });
    const filtered = filterSignal(signal, species);
    expect(filtered.mv.length).toBe(signal.mv.length);
    expect(beats.length).toBeGreaterThanOrEqual(5);
    for (const beat of beats) {
      const before = rAmplitude(signal.mv, beat);
      const after = rAmplitude(filtered.mv, beat);
      expect(after).toBeGreaterThan(before * 0.97);
      expect(after).toBeLessThanOrEqual(before * 1.01);
      // R peak in the same sample (±1): zero phase delay.
      let argBefore = 0;
      let argAfter = 0;
      for (let i = at(beat.rPeak - 10); i <= at(beat.rPeak + 10); i++) {
        if (signal.mv[i] > signal.mv[argBefore]) argBefore = i;
        if (filtered.mv[i] > filtered.mv[argAfter]) argAfter = i;
      }
      expect(Math.abs(argAfter - argBefore)).toBeLessThanOrEqual(1);
    }
  });

  it('baseline drift of 0.3 Hz × 0.5 mV is at most 0.02 mV after the filter over the whole signal, edges included', () => {
    const { signal } = renderSignal({ species: 'dog', durationMs: 5000, beat: { p: 0, q: 0, r: 0, s: 0, t: 0 }, drift: { hz: 0.3, mv: 0.5 } });
    const filtered = filterSignal(signal, 'dog');
    let worst = 0;
    for (let i = 0; i < filtered.mv.length; i++) worst = Math.max(worst, Math.abs(filtered.mv[i]));
    expect(worst).toBeLessThanOrEqual(0.02);
  });

  it('a filter infeasible at the given sampling rate (LPF 60 Hz at fs 100) is skipped with filter_skipped:lowpass; HPF is applied', () => {
    const n = 500;
    const mv = new Float32Array(n);
    for (let i = 0; i < n; i++) mv[i] = 1 + 0.5 * Math.sin(2 * Math.PI * 0.2 * (i / 100));
    const filtered = filterSignal(signalWith(mv, 100), 'cat');
    expect(filtered.issues).toEqual(['filter_skipped:lowpass']);
    // The mean (1 mV) is removed by the HPF, so it ran; the signal is non-empty and has no NaN.
    const mean = filtered.mv.reduce((s, v) => s + v, 0) / n;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(filtered.mv.every(Number.isFinite)).toBe(true);
    // Normal case: no issues.
    expect(filterSignal(signalWith(mv), 'cat').issues).toEqual([]);
  });

  it('clipped and gap spans are widened by the LPF kernel length (fs / cutoff samples) on both sides and merged; ambiguous is untouched', () => {
    const base = signalWith(new Float32Array(1000));
    const signal: LeadSignal = {
      ...base,
      unreliable: [
        { i0: 100, i1: 120, kind: 'clipped' },
        { i0: 130, i1: 140, kind: 'clipped' },
        { i0: 500, i1: 510, kind: 'gap' },
        { i0: 700, i1: 705, kind: 'ambiguous' },
        { i0: 995, i1: 999, kind: 'clipped' },
      ],
    };
    const dog = filterSignal(signal, 'dog'); // 40 Hz → 13 samples
    expect(dog.unreliable).toEqual([
      { i0: 87, i1: 153, kind: 'clipped' },
      { i0: 487, i1: 523, kind: 'gap' },
      { i0: 700, i1: 705, kind: 'ambiguous' },
      { i0: 982, i1: 999, kind: 'clipped' },
    ]);
    const cat = filterSignal(signal, 'cat'); // 60 Hz → 9 samples
    expect(cat.unreliable[0]).toEqual({ i0: 91, i1: 149, kind: 'clipped' });
    // The source signal is unchanged.
    expect(signal.unreliable[0]).toEqual({ i0: 100, i1: 120, kind: 'clipped' });
  });
});

/** Signal with the required sampling rate, for robustness checks (the `fs` type is the literal 500, bypassed with a cast). */
export function signalWith(mv: Float32Array, fs = 500): LeadSignal {
  return { id: 'II', fs: fs as 500, t0: 0, mv, baselineY: 200, confidence: 1, unreliable: [] };
}
