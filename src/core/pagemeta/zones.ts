/**
 * Segmentation of the profile's text zones, shared by sheet reading (`readers.ts`) and the template rebuild script
 * (`scripts/build-glyphs.ts`): templates are thus cut as exactly the same glyphs the sheet is later read with.
 *
 * Sheet fonts (measured on fixtures): bold HR digits 10 px (y69–78 A / 71–80 B), bold RR row digits
 * 9 px (B, y825–833), small time labels 7 px (y50–56), regular header and footer font 8–9 px (dots 1–2 px,
 * letters with descenders up to 12 px). The component threshold is per font (sweep 130–170 over 10 sheets): bold at 130
 * (ink core) gives 3 + 2 merged pairs and no break-ups; small and regular fall apart at 130–150
 * (small-font colon at 123–161, digit joint at 132–139), at 170 (ink edge) they are intact but merge more often;
 * merged words are split by `decodeWord`. A regular-font space is 4–6 empty columns, gaps inside a word
 * ≤ 3; between HR/RR row numbers and time labels, tens of columns.
 */
import type { GrayImage, ProfileThresholds, Rect } from '../../types/contracts';
import { darkComponents, groupLines, mergeByOverlapX, splitWords, union, type Box } from './segment';

/** Font parameters: component threshold (profile threshold key), allowed glyph height, gap between words. */
export interface BandFont {
  ink: 'inkCore' | 'inkEdge';
  minHeight: number;
  maxHeight: number;
  wordGap: number;
}

export const FONTS = {
  /** Bold instantaneous HR digits above lead I. */
  hr: { ink: 'inkCore', minHeight: 8, maxHeight: 12, wordGap: 6 },
  /** Bold RR row digits in ms (variant B). */
  rr: { ink: 'inkCore', minHeight: 7, maxHeight: 11, wordGap: 6 },
  /** Small time labels above the frame; ":" after merging its dots is 4–5 px. */
  time: { ink: 'inkEdge', minHeight: 3, maxHeight: 9, wordGap: 6 },
  /** Regular header and footer font: height is not limited, a word break is a gap ≥ 4 columns. */
  text: { ink: 'inkEdge', minHeight: 1, maxHeight: 14, wordGap: 4 },
  /** Bold lead labels in the left column. */
  labels: { ink: 'inkCore', minHeight: 1, maxHeight: 14, wordGap: 6 },
} as const satisfies Record<string, BandFont>;

const right = (b: Rect): number => b.x + b.width - 1;
const bottom = (b: Rect): number => b.y + b.height - 1;

/** Zone components darker than the font threshold. */
function components(img: GrayImage, zone: Rect, thresholds: ProfileThresholds, font: BandFont): Box[] {
  return darkComponents(img, zone, thresholds[font.ink]);
}

/**
 * Glyphs of a text band inside the grid: components not touching the zone edges (curves enter from below and above,
 * b-02: trace I in the HR digit band; on the right, the frame halo), with height within the font range, merged by stack;
 * 1 px wide glyphs are columns of grid dots darkened near the frame (164–169 on a-06), not text (the narrowest
 * character is the colon, 2 px). A colon with only one surviving dot is dropped by height; its position is
 * recovered by `decodeWord` from the word's grayscale image.
 */
export function bandGlyphs(img: GrayImage, zone: Rect, thresholds: ProfileThresholds, font: BandFont): Box[] {
  const inner = components(img, zone, thresholds, font).filter(
    (c) => c.y > zone.y && bottom(c) < bottom(zone) && c.x > zone.x && right(c) < right(zone) && c.height <= font.maxHeight,
  );
  return mergeByOverlapX(inner).filter((g) => g.width >= 2 && g.height >= font.minHeight && g.height <= font.maxHeight);
}

/** Band words: glyphs separated by a gap ≥ `font.wordGap`. */
export function bandWords(img: GrayImage, zone: Rect, thresholds: ProfileThresholds, font: BandFont): Box[][] {
  return splitWords(bandGlyphs(img, zone, thresholds, font), font.wordGap);
}

/** Glyphs of a regular text line (header, footer): components merged along x, no height filter. */
export function textGlyphs(img: GrayImage, zone: Rect, thresholds: ProfileThresholds): Box[] {
  return mergeByOverlapX(components(img, zone, thresholds, FONTS.text));
}

/** Words of a regular text line. */
export function textWords(img: GrayImage, zone: Rect, thresholds: ProfileThresholds): Box[][] {
  return splitWords(textGlyphs(img, zone, thresholds), FONTS.text.wordGap);
}

/** Lines of the lead label column: components overlapping in y form one label; top to bottom. */
export function labelLines(img: GrayImage, zone: Rect, thresholds: ProfileThresholds): Box[] {
  return groupLines(components(img, zone, thresholds, FONTS.labels)).map(union);
}

/** Word rectangle: the union of its glyphs. */
export const wordRect = (word: readonly Box[]): Box => union(word);
