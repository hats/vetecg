/**
 * Layout variant choice (A 1280×905 / B 1280×883) by voting of features:
 * presence of the RR row at the bottom of the frame and the product line in the header (primary, per the spec), frame
 * height and sheet height (confirmation). Disagreeing features — `ambiguous`; confidence is the winner's weight share.
 */
import type { FormatProfile, GrayImage, PageVariant, ProfileThresholds, ProfileVariant, Rect } from '../../types/contracts';
import { binarizeRect, jaccardDistance } from '../profile';

export type VariantVote = 'height' | 'frame' | 'rrRow' | 'header';

export interface VariantDecision {
  variant: PageVariant;
  /** 1 — all cast votes are for the winner; 0 — no votes (default by sheet height). */
  confidence: number;
  votes: Partial<Record<VariantVote, PageVariant>>;
  ambiguous: boolean;
}

const WEIGHTS: Record<VariantVote, number> = { rrRow: 1.5, header: 1.5, frame: 1, height: 1 };

/** Digit-row evidence in a band: dark pixel total, number of starting columns (background→ink transitions), dark above the band. */
export interface RowEvidence {
  dark: number;
  transitions: number;
  darkAbove: number;
}

export function rowEvidence(img: GrayImage, band: Rect, dark: number): RowEvidence {
  const { width, height, data } = img;
  let total = 0;
  let transitions = 0;
  let previousInk = false;
  for (let x = band.x; x < band.x + band.width; x++) {
    if (x < 0 || x >= width) continue;
    let columnInk = false;
    for (let y = band.y; y < band.y + band.height; y++) {
      if (y < 0 || y >= height) continue;
      if (data[y * width + x] < dark) {
        total++;
        columnInk = true;
      }
    }
    if (columnInk && !previousInk) transitions++;
    previousInk = columnInk;
  }
  let darkAbove = 0;
  for (let y = band.y - 3; y < band.y; y++) {
    if (y < 0 || y >= height) continue;
    for (let x = band.x; x < band.x + band.width; x++) if (x >= 0 && x < width && data[y * width + x] < dark) darkAbove++;
  }
  return { dark: total, transitions, darkAbove };
}

/**
 * The RR row is present if the digit band has enough ink, many separate glyphs (column transitions)
 * and almost nothing above the band — a downward-going aVF curve of variant A comes from above, which sets it apart from text.
 */
export function hasBottomRow(img: GrayImage, rrRowZone: Rect, t: ProfileThresholds): boolean {
  // Glyph band: digits occupy 8 rows above the two bottom pixels of the zone.
  const band: Rect = { x: rrRowZone.x, y: rrRowZone.y + 3, width: rrRowZone.width, height: rrRowZone.height - 5 };
  const e = rowEvidence(img, band, t.inkCore);
  return e.dark >= t.rrRowMinInk && e.transitions >= t.rrRowMinGlyphs && e.darkAbove <= t.rrRowMaxAboveRatio * e.dark;
}

function nearestByHeight(height: number, profile: FormatProfile, pick: (v: ProfileVariant) => number, tolerance: number): PageVariant | undefined {
  let best: PageVariant | undefined;
  let bestError = Infinity;
  for (const key of Object.keys(profile.variants) as PageVariant[]) {
    const expected = pick(profile.variants[key]);
    const error = Math.abs(height - expected) / expected;
    if (error < bestError) {
      bestError = error;
      best = key;
    }
  }
  return bestError <= tolerance ? best : undefined;
}

function headerVote(img: GrayImage, profile: FormatProfile, dx: number, dy: number): PageVariant | undefined {
  const t = profile.thresholds;
  const matching: PageVariant[] = [];
  for (const key of Object.keys(profile.variants) as PageVariant[]) {
    const v = profile.variants[key];
    const zone = v.zones.headerProduct;
    if (!zone) continue;
    const crop = binarizeRect(img, { x: zone.x + dx, y: zone.y + dy, width: zone.width, height: zone.height }, t.headerThreshold);
    const template = { ...v.headerProduct, x: v.headerProduct.x + dx, y: v.headerProduct.y + dy };
    if (jaccardDistance(crop, template, 2) <= t.headerMaxDistance) matching.push(key);
  }
  return matching.length === 1 ? matching[0] : undefined;
}

/** The variant that has the `rrRow` zone (RR row inside the frame), and the variant without it. */
function splitByBottomRow(profile: FormatProfile): { withRow?: PageVariant; withoutRow?: PageVariant } {
  const result: { withRow?: PageVariant; withoutRow?: PageVariant } = {};
  for (const key of Object.keys(profile.variants) as PageVariant[]) {
    if (profile.variants[key].zones.rrRow) result.withRow = key;
    else result.withoutRow = key;
  }
  return result;
}

export function decideVariant(img: GrayImage, profile: FormatProfile, frame: Rect | null): VariantDecision {
  const t = profile.thresholds;
  const votes: Partial<Record<VariantVote, PageVariant>> = {};

  const byHeight = nearestByHeight(img.height, profile, (v) => v.height, t.frameTolerance);
  if (byHeight) votes.height = byHeight;

  // The header is anchored to the frame: when a frame is found, zones are shifted by its offset from the profile.
  const fallback: PageVariant = byHeight ?? 'A';
  const reference = profile.variants[frame ? nearestByHeight(frame.height, profile, (v) => v.frame.height, 1) ?? fallback : fallback];
  const dx = frame ? frame.x - reference.frame.x : 0;
  const dy = frame ? frame.y - reference.frame.y : 0;

  if (frame) {
    const byFrame = nearestByHeight(frame.height, profile, (v) => v.frame.height, t.frameTolerance);
    if (byFrame) votes.frame = byFrame;

    const { withRow, withoutRow } = splitByBottomRow(profile);
    if (withRow && withoutRow) {
      // The RR row zone ends at the bottom edge of the frame — look for it at the bottom edge of the found frame.
      const zone = profile.variants[withRow].zones.rrRow!;
      const band: Rect = { x: zone.x + dx, y: frame.y + frame.height - zone.height, width: zone.width, height: zone.height };
      votes.rrRow = hasBottomRow(img, band, t) ? withRow : withoutRow;
    }
  }

  const byHeader = headerVote(img, profile, dx, dy);
  if (byHeader) votes.header = byHeader;

  const weight: Partial<Record<PageVariant, number>> = {};
  let total = 0;
  for (const [name, variant] of Object.entries(votes) as [VariantVote, PageVariant][]) {
    weight[variant] = (weight[variant] ?? 0) + WEIGHTS[name];
    total += WEIGHTS[name];
  }
  const ranked = (Object.entries(weight) as [PageVariant, number][]).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return { variant: fallback, confidence: 0, votes, ambiguous: false };
  const [variant, winnerWeight] = ranked[0];
  return { variant, confidence: winnerWeight / total, votes, ambiguous: ranked.length > 1 };
}
