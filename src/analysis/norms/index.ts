/**
 * `norms` module: norm references per species and size, and value classification.
 * Data lives in `data.ts` (the single source of truth for the code and `docs/normy-ekg.md`).
 */
import type { DogSize, NormClass, NormKey, NormRange, NormTable, Species } from '../../types/contracts';
import { NORM_ENTRIES, RHYTHM_THRESHOLDS, type ProfileId } from './data';

export { NORM_ENTRIES, NORM_PROFILES, RHYTHM_THRESHOLDS, EXTRA_CHANGES, UNCONFIRMED, NORMS_CHECK_DATE, entryFor } from './data';
export type { NormEntry, NormProfile, ProfileId, ExtraChange } from './data';
export { NORM_SOURCES, findSource } from './sources';
export type { NormSource, SourceTrust } from './sources';
export { SIGNED_KEYS, num, coreRangeText, borderText, rangeText, decimalsFor, roundForUnit, formatMeasured, significant, plainNum } from './format';

/** Classification context: values of other parameters a rule depends on (T relative to R). */
export interface ClassifyContext {
  /** R amplitude, mV; `null`/`undefined` — unknown, the relative T rule is not applied. */
  r?: number | null;
}

function profileFor(species: Species, dogSize: DogSize | undefined): ProfileId {
  if (species === 'cat') return 'cat';
  return dogSize === 'small' ? 'dog-small' : 'dog-large';
}

/**
 * Norm table for a species and size. A dog without a size gets the standard-breed table (`large`);
 * for a cat `dogSize` is absent. Every row carries `source`; `thresholds` are always filled.
 */
export function getNorms(species: Species, dogSize?: DogSize): NormTable {
  const size: DogSize | undefined = species === 'dog' ? (dogSize ?? 'large') : undefined;
  const profile = profileFor(species, size);
  const params: Partial<Record<NormKey, NormRange>> = {};
  for (const entry of NORM_ENTRIES) {
    const range = entry.ranges[profile];
    if (range) params[entry.key] = { ...range };
  }
  const table: NormTable = { species, params, thresholds: structuredClone(RHYTHM_THRESHOLDS[species]) };
  if (size) table.dogSize = size;
  return table;
}

/** Fraction of the norm limit that forms the borderline zone when the reference gives no explicit grey zone. */
export const BORDER_FRACTION = 0.1;
const EPS = 1e-9;
const SEVERITY: readonly NormClass[] = ['norm', 'border', 'abnormal'];

function worst(a: NormClass, b: NormClass): NormClass {
  return SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b;
}

function againstRange(
  v: number,
  lo: number | undefined,
  hi: number | undefined,
  borderLo: number | undefined,
  borderHi: number | undefined,
  borderOnly: boolean | undefined,
): NormClass {
  if (lo !== undefined && v < lo - EPS) {
    if (borderOnly) return 'border';
    const limit = borderLo ?? lo - Math.abs(lo) * BORDER_FRACTION;
    return v >= limit - EPS ? 'border' : 'abnormal';
  }
  if (hi !== undefined && v > hi + EPS) {
    if (borderOnly) return 'border';
    const limit = borderHi ?? hi + Math.abs(hi) * BORDER_FRACTION;
    return v <= limit + EPS ? 'border' : 'abnormal';
  }
  return 'norm';
}

/**
 * Class of a value against the norm table: `norm` / `border` (the reference's explicit grey zone or
 * ±10 % outward from the limit) / `abnormal` / `n/a` ("norm not defined" or no value).
 * Rules from `NormRange`: `abs` — by absolute value; `borderOnly` — exceeding is only borderline ("deep Q");
 * `maxFractionOfR` — |value| ≤ fraction × R from `context.r` (not applied without R), the worse verdict wins;
 * `negativeIsBorder` — a negative value is at least `border`.
 */
export function classify(param: NormKey, value: number | null, norms: NormTable, context?: ClassifyContext): NormClass {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  const range = norms.params[param];
  if (!range) return 'n/a';

  const v = range.abs ? Math.abs(value) : value;
  let verdict = againstRange(v, range.min, range.max, range.borderMin, range.borderMax, range.borderOnly);

  const r = context?.r;
  if (range.maxFractionOfR !== undefined && typeof r === 'number' && Number.isFinite(r) && r > 0) {
    const relative = againstRange(Math.abs(value), undefined, range.maxFractionOfR * r, undefined, undefined, undefined);
    verdict = worst(verdict, relative);
  }
  if (range.negativeIsBorder && value < 0) verdict = worst(verdict, 'border');
  return verdict;
}
