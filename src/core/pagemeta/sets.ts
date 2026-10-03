/**
 * Built-in "Poly-Spectrum.NET" glyph sets from `fixtures/polyspectrum/glyphs/glyphs.json` (built by
 * `scripts/build-glyphs.ts`). Per the spec the format profile owns the glyphs (`FormatProfile.glyphs`), but its
 * area is closed to this module, so `glyphSetFor` takes the set from the profile if present, otherwise the
 * built-in one; the profile owner can plug `BUILTIN_GLYPH_SETS` into `POLYSPECTRUM.glyphs` without changes here.
 */
import glyphsFile from '../../../fixtures/polyspectrum/glyphs/glyphs.json' with { type: 'json' };
import type { FormatProfile, Glyph, GlyphSet } from '../../types/contracts';

export type BuiltinGlyphSetName = keyof typeof glyphsFile.sets;

interface GlyphJson {
  text: string;
  width: number;
  height: number;
  dy?: number;
  data: number[];
}

function toGlyph(g: GlyphJson): Glyph {
  const glyph: Glyph = { text: g.text, width: g.width, height: g.height, data: Uint8Array.from(g.data) };
  if (g.dy) glyph.dy = g.dy;
  return glyph;
}

function toSet(name: string, set: { pairAbove?: number; glyphs: GlyphJson[] }): GlyphSet {
  const out: GlyphSet = { name, glyphs: set.glyphs.map(toGlyph), inkThreshold: glyphsFile.inkThreshold };
  if (set.pairAbove !== undefined) out.pairAbove = set.pairAbove;
  return out;
}

/** All built-in sets by name (`hrDigits`, `rrDigits`, `timeDigits`, `textDigits`, `leadLabelsA/B`, `species`, `header`, `footer`). */
export const BUILTIN_GLYPH_SETS: Readonly<Record<BuiltinGlyphSetName, GlyphSet>> = Object.fromEntries(
  (Object.keys(glyphsFile.sets) as BuiltinGlyphSetName[]).map((name) => [name, toSet(name, glyphsFile.sets[name])]),
) as Record<BuiltinGlyphSetName, GlyphSet>;

/** The set from the profile (if the profile owner plugged it in), otherwise the built-in one. */
export function glyphSetFor(profile: FormatProfile, name: BuiltinGlyphSetName): GlyphSet {
  return profile.glyphs[name] ?? BUILTIN_GLYPH_SETS[name];
}
