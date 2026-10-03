/**
 * `filter` module: filtering of a lead signal before beat detection and wave delineation (SIGNAL-01, SIGNAL-02).
 * Exposes `filterSignal(signal, species) -> LeadSignal`; hides filter design and edge handling.
 *
 * 0.5 Hz high-pass (baseline drift) and 40 Hz (dog) / 60 Hz (cat) low-pass — Butterworth, two-pass (zero
 * phase delay: a single-pass IIR shifts peaks and corrupts intervals). Parameters are data in `FILTER_SETTINGS`.
 *
 * Order 4 (two 2nd-order sections), not 2 as in the ticket: the two-pass scheme squares the magnitude response, and
 * with 2nd order a 0.3 Hz × 0.5 mV drift leaves 0.057 mV (criterion ≤ 0.02), while a dog's R (QRS 52–56 ms,
 * device print at 35 Hz) drops by 4–6 % (criterion < 3 %). 4th order with the same cutoffs: residual drift
 * 0.008 mV, R drop 0.4–2.3 %; the 1 Hz band passes with |H| = 0.998. Measurements are in the task 06 report.
 *
 * A section that is unstable at the given sampling rate (cutoff ≥ fs/2) is not applied: the signal passes without
 * that filter, with `filter_skipped:highpass` / `filter_skipped:lowpass` in `issues` (snake_case per the
 * orchestrator's decision; the ticket says "filter-skipped").
 *
 * Unreliable spans (`unreliable`): `clipped` and `gap` are expanded by the filter kernel length (fs / low-pass cutoff
 * samples) on both sides — the filter transient at the edge of saturation is not signal either; `ambiguous` stays
 * as is. Overlapping spans of the same kind are merged.
 */
import type { LeadSignal, Species, UnreliableSamples } from '../../types/contracts';
import { designHighpass, designLowpass, filtfilt, isStable, type Biquad } from './biquad';

export { designHighpass, designLowpass, filtfilt, isStable } from './biquad';
export type { Biquad } from './biquad';

export interface FilterSettings {
  highpassHz: number;
  highpassOrder: number;
  lowpassHz: number;
  lowpassOrder: number;
}

/** Cutoffs and orders per species (specification §3). */
export const FILTER_SETTINGS: Record<Species, FilterSettings> = {
  dog: { highpassHz: 0.5, highpassOrder: 4, lowpassHz: 40, lowpassOrder: 4 },
  cat: { highpassHz: 0.5, highpassOrder: 4, lowpassHz: 60, lowpassOrder: 4 },
};

/**
 * Filter sections if the filter is realizable at the given sampling rate: cutoff strictly between 0 and fs/2 and all
 * poles inside the unit circle; otherwise `undefined` (a cutoff at Nyquist degenerates the section to zero without
 * failing `isStable`).
 */
export function designStable(kind: 'lowpass' | 'highpass', fc: number, fs: number, order: number): Biquad[] | undefined {
  if (!(fc > 0) || !(fc < fs / 2)) return undefined;
  const sections = kind === 'lowpass' ? designLowpass(fc, fs, order) : designHighpass(fc, fs, order);
  return isStable(sections) ? sections : undefined;
}

/** Filter kernel length in samples — clipped/gap spans are expanded by this much on each side. */
export function filterKernelSamples(fs: number, settings: FilterSettings): number {
  return Math.ceil(fs / settings.lowpassHz);
}

/** Expands `clipped`/`gap` spans by `pad` samples and merges overlapping spans of the same kind. */
export function expandUnreliable(spans: UnreliableSamples[], pad: number, length: number): UnreliableSamples[] {
  const expanded = spans
    .map((s) =>
      s.kind === 'ambiguous'
        ? { ...s }
        : { i0: Math.max(0, s.i0 - pad), i1: Math.min(length - 1, s.i1 + pad), kind: s.kind },
    )
    .sort((a, b) => a.i0 - b.i0 || a.i1 - b.i1);
  const out: UnreliableSamples[] = [];
  for (const s of expanded) {
    const last = out[out.length - 1];
    if (last && last.kind === s.kind && s.i0 <= last.i1 + 1) last.i1 = Math.max(last.i1, s.i1);
    else out.push({ ...s });
  }
  return out;
}

export function filterSignal(signal: LeadSignal, species: Species): LeadSignal {
  const settings = FILTER_SETTINGS[species];
  const issues: string[] = [];
  const n = signal.mv.length;
  if (n === 0) return { ...signal, mv: new Float32Array(0), unreliable: signal.unreliable.map((u) => ({ ...u })), issues };

  const stages: [string, Biquad[] | undefined][] = [
    ['highpass', designStable('highpass', settings.highpassHz, signal.fs, settings.highpassOrder)],
    ['lowpass', designStable('lowpass', settings.lowpassHz, signal.fs, settings.lowpassOrder)],
  ];
  let mv: Float32Array = Float32Array.from(signal.mv);
  for (const [name, sections] of stages) {
    if (!sections) {
      issues.push(`filter_skipped:${name}`);
      continue;
    }
    mv = filtfilt(mv, sections);
  }

  const pad = filterKernelSamples(signal.fs, settings);
  return { ...signal, mv, unreliable: expandUnreliable(signal.unreliable, pad, n), issues };
}
