/**
 * QRS electrical axis (AXIS-01): atan2 of the median net QRS areas in aVF and I over the "best" sinus complexes
 * (the same selection as for measurements); without them — over all non-ectopic reliable beats (window ±half-width of
 * a confidently wide QRS for the species, from the reference). I or aVF unreliable on all sheets — axis undefined,
 * `axis_leads_unreliable`.
 */
import type { Species } from '../../types/contracts';
import { beatReliable, measurementBeats, median, reliableLead, type MergedBeat } from '../measure';
import { getNorms } from '../norms';
import { leadArea } from './qrs-area';

export interface AxisResult {
  axisDeg: number | null;
  reason?: string;
}

/** QRS window half-width without delineation, ms: a confidently wide QRS for the species (`thresholds.wideQrs.confidentS`). */
export function fallbackHalfMs(species: Species): number {
  // `getNorms` always fills `thresholds` (interfaces.md, task 08).
  return getNorms(species).thresholds!.wideQrs.confidentS * 1000;
}

export function computeAxis(merged: readonly MergedBeat[], premature: readonly boolean[], species: Species): AxisResult {
  if (merged.length === 0) return { axisDeg: null, reason: 'no_beats' };
  let candidates: readonly MergedBeat[] = measurementBeats(merged, premature);
  if (candidates.length === 0) candidates = merged.filter((m, i) => !premature[i] && beatReliable(m));
  if (candidates.length === 0) return { axisDeg: null, reason: 'too_few_beats' };

  const half = fallbackHalfMs(species);
  const areasI: number[] = [];
  const areasF: number[] = [];
  let leadsMissing = 0;
  for (const m of candidates) {
    const sigI = reliableLead(m.signals, 'I');
    const sigF = reliableLead(m.signals, 'aVF');
    if (!sigI || !sigF) {
      leadsMissing++;
      continue;
    }
    const aI = leadArea(m, sigI, half);
    const aF = leadArea(m, sigF, half);
    if (aI === undefined || aF === undefined) continue;
    areasI.push(aI);
    areasF.push(aF);
  }
  if (areasI.length === 0) return { axisDeg: null, reason: leadsMissing > 0 ? 'axis_leads_unreliable' : 'too_few_beats' };
  const deg = (Math.atan2(median(areasF), median(areasI)) * 180) / Math.PI;
  return { axisDeg: Math.round(deg * 10) / 10 };
}
