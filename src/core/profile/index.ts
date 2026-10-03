/**
 * Module `profile`: the "Poly-Spectrum.NET" format profile and its data (layout, zones, thresholds, header
 * templates, glyphs). Exposes `POLYSPECTRUM` and binary crop comparison (`binarizeRect`, `jaccardDistance`).
 * Template reading `matchGlyphs(img, rect, set)` belongs to the profile per the spec, but is implemented and
 * exported from `src/core/pagemeta` (task 03) — the only implementation in the contract; the profile owns
 * only data: `POLYSPECTRUM.glyphs` are the built-in glyph sets.
 */
import type { FormatProfile } from '../../types/contracts';

export { POLYSPECTRUM, THRESHOLDS } from './polyspectrum';
export { binarizeRect, jaccardDistance, patchFromRows } from './header';
export type { FormatProfile };
