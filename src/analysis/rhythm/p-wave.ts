/**
 * Assessment of P presence from the II delineation (`delineate`, task 06): "P not found" splits into "P absent" and
 * "P could not be seen". In tachycardia the P search window is covered by the T of the previous beat: delineation gives
 * `p_window_too_short` (window shorter than the minimum), `p_lobe_outside_window` (the lobe in the window is the T tail)
 * or `p_duration_out_of_range` (a lobe merged with T, of the wrong length). On fixture cats at 224–257 bpm this is
 * 18 of 19 and 18 of 22 complexes — they must not be counted as a "span without P" and "non-sinus rhythm": P there is
 * hidden, not absent. P is considered absent only on `p_low_amplitude`: the window is free, yet there is no wave in it.
 */
import type { Delineation } from '../../types/contracts';

export const P_NOT_ASSESSABLE_REASONS: ReadonlySet<string> = new Set(['p_window_too_short', 'p_lobe_outside_window', 'p_duration_out_of_range']);

/** P found, or the P window was free for assessment. */
export function pAssessed(d: Delineation): boolean {
  return d.pFound || !(d.reasons ?? []).some((c) => P_NOT_ASSESSABLE_REASONS.has(c));
}

/** P assessed and absent. */
export function pAbsent(d: Delineation): boolean {
  return !d.pFound && pAssessed(d);
}
