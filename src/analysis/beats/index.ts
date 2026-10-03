/**
 * `beats` module: beats, waves, cross-check against the printed HR (task 06).
 * - `detectBeats(signals, species)` — Pan-Tompkins over the sum of reliable leads (`detect.ts`); input — raw signals of
 *   `analyzePage` (its own band; the common low-pass shifts the peak of a narrow QRS);
 * - `delineate(beat, signalII, species, options?)` — P/QRS/T bounds of one beat from II after `filterSignal` (`delineate.ts`);
 * - `checkPrintedHr(beats, meta, layout, calib?)` — cross-check of intervals against the printed HR digits (`printed-hr.ts`).
 * Species profile (windows, refractory period, band) — `species.ts`.
 */
export { detectBeats, panTompkinsFeature } from './detect';
export { delineate } from './delineate';
export type { DelineateOptions } from './delineate';
export { checkPrintedHr, PRINTED_HR_RULE } from './printed-hr';
export { beatProfileFor, HR_PLAUSIBLE, LEAD_AGREEMENT_MS } from './species';
export type { BeatSpeciesProfile } from './species';
