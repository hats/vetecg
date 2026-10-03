/**
 * QRS window of a beat in the sheet's signal samples and the net QRS area of a lead — shared by the axis and the
 * extrasystole focus.
 *
 * The window is the II delineation bounds (`qOn`, `sOff`; the time scale is shared by the sheet's six leads), and
 * without a usable delineation — ±`fallbackHalfMs` around the beat time in this lead (`perLead[id].tMs`, else
 * `beat.tMs`). The lead baseline is the median of its PQ segment (16…4 ms before the window start), as in `delineate`;
 * for a window without delineation — the median of a wide window ±2 widths (as in `detectBeats`).
 * Area = Σ(mv − baseline)·Δt, mV·ms; a window inside `clipped`/`gap` has no area (that is not signal).
 */
import type { LeadId, LeadSignal } from '../../types/contracts';
import { delineationUsable, medianOf, type MergedBeat } from '../measure';

/** PQ segment for the baseline: this many ms before the QRS onset. */
const PQ_LEVEL_MS: [number, number] = [16, 4];

export interface QrsWindow {
  a: number;
  b: number;
  fromDelineation: boolean;
}

export function qrsWindowOf(m: MergedBeat, signal: LeadSignal, fallbackHalfMs: number): QrsWindow | undefined {
  const sampleMs = 1000 / signal.fs;
  const idx = (ms: number): number => Math.round(ms / sampleMs);
  const n = signal.mv.length;
  if (n === 0) return undefined;
  if (delineationUsable(m)) {
    const a = Math.max(0, idx(m.delineation.qOn));
    const b = Math.min(n - 1, idx(m.delineation.sOff));
    return b > a ? { a, b, fromDelineation: true } : undefined;
  }
  const center = idx(m.beat.perLead[signal.id]?.tMs ?? m.beat.tMs);
  const half = idx(fallbackHalfMs);
  const a = Math.max(0, center - half);
  const b = Math.min(n - 1, center + half);
  return b > a ? { a, b, fromDelineation: false } : undefined;
}

function inUnreliable(signal: LeadSignal, a: number, b: number): boolean {
  return signal.unreliable.some((u) => u.kind !== 'ambiguous' && u.i0 <= b && u.i1 >= a);
}

/** Net QRS area of a lead in the window, mV·ms; `undefined` if the window touches an unreliable span. */
export function netArea(signal: LeadSignal, w: QrsWindow): number | undefined {
  if (inUnreliable(signal, w.a, w.b)) return undefined;
  const sampleMs = 1000 / signal.fs;
  const idx = (ms: number): number => Math.round(ms / sampleMs);
  const mv = signal.mv;
  const width = w.b - w.a;
  const base = w.fromDelineation
    ? (medianOf(mv, w.a - idx(PQ_LEVEL_MS[0]), w.a - idx(PQ_LEVEL_MS[1])) ?? mv[w.a])
    : (medianOf(mv, w.a - 2 * width, w.b + 2 * width) ?? mv[w.a]);
  let sum = 0;
  for (let i = w.a; i <= w.b; i++) sum += mv[i] - base;
  return sum * sampleMs;
}

/** QRS area of lead `id` for a beat; no reliable lead or window — `undefined`. */
export function leadArea(m: MergedBeat, signal: LeadSignal | undefined, fallbackHalfMs: number): number | undefined {
  if (!signal) return undefined;
  const w = qrsWindowOf(m, signal, fallbackHalfMs);
  return w ? netArea(signal, w) : undefined;
}

export type AreaLead = Extract<LeadId, 'I' | 'aVF'>;
