/**
 * Template glyph reading: normalized cross-correlation (NCC) of a sheet crop with bitmaps of a known font.
 * Acceptance rule is "nearest template with a margin" (spec, decisions §2): best correlation ≥ 0.85 and a margin
 * over the best candidate with different text ≥ 0.05; a glyph wider than `set.pairAbove` is a merged pair, read by
 * trying template pairs; an unresolved glyph is "?".
 *
 * Comparison is done in "soft ink": brightness ≥ the set threshold (170, top of the ink hysteresis) → 0, darker is
 * linear up to 255. This way grid dots (180–235) do not take part in the correlation, while letter anti-aliasing is kept.
 * The comparison window is the union of crop and template sizes without padding (in the small font characters touch,
 * and padding would capture the neighbouring character), template at the top-left corner, best shift ±1 px on both
 * axes and half-pixel template variants; thresholds 0.85/0.05 come from a probe on HR digits.
 */
import type { Glyph, GlyphMatch, GlyphSet, GrayImage, Rect } from '../../types/contracts';

/** Acceptance threshold: correlation of the best template. */
export const ACCEPT_SCORE = 0.85;
/** Acceptance threshold: margin over the best candidate with different text. */
export const ACCEPT_MARGIN = 0.05;
/** Default soft-ink threshold (= the profile's `thresholds.inkEdge`). */
export const DEFAULT_INK_THRESHOLD = 170;
/** Comparison window padding (0: adjacent characters of thin fonts touch) and shift limit, px. */
const PAD = 0;
const SHIFT = 1;

/** Soft ink of a pixel: 0 at brightness ≥ `threshold`, linear up to 255 at brightness 0. */
export function softInk(gray: number, threshold: number): number {
  return gray >= threshold ? 0 : Math.round(((threshold - gray) * 255) / threshold);
}

/** Soft-ink crop of the sheet as a glyph: the build script cuts templates this way, and the sheet is compared the same way. */
export function cutGlyph(img: GrayImage, rect: Rect, threshold: number, text: string): Glyph {
  const data = new Uint8Array(rect.width * rect.height);
  for (let j = 0; j < rect.height; j++) {
    for (let i = 0; i < rect.width; i++) {
      const x = rect.x + i;
      const y = rect.y + j;
      const gray = x >= 0 && y >= 0 && x < img.width && y < img.height ? img.data[y * img.width + x] : 255;
      data[j * rect.width + i] = softInk(gray, threshold);
    }
  }
  return { text, width: rect.width, height: rect.height, data };
}

/** NCC of the sheet crop in window (x0, y0, w, h) with the template placed in the window at offset PAD from the top-left corner. */
function windowScore(img: GrayImage, x0: number, y0: number, w: number, h: number, glyph: Glyph, threshold: number): number {
  const n = w * h;
  let sumA = 0;
  let sumB = 0;
  let sumAB = 0;
  let sumAA = 0;
  let sumBB = 0;
  for (let j = 0; j < h; j++) {
    const y = y0 + j;
    const inside = y >= 0 && y < img.height;
    const tj = j - PAD;
    for (let i = 0; i < w; i++) {
      const x = x0 + i;
      const ti = i - PAD;
      const a = inside && x >= 0 && x < img.width ? softInk(img.data[y * img.width + x], threshold) : 0;
      const b = ti >= 0 && tj >= 0 && ti < glyph.width && tj < glyph.height ? glyph.data[tj * glyph.width + ti] : 0;
      sumA += a;
      sumB += b;
      sumAB += a * b;
      sumAA += a * a;
      sumBB += b * b;
    }
  }
  const covAB = sumAB - (sumA * sumB) / n;
  const varA = sumAA - (sumA * sumA) / n;
  const varB = sumBB - (sumB * sumB) / n;
  if (varA <= 0 || varB <= 0) return 0;
  return covAB / Math.sqrt(varA * varB);
}

/**
 * Template shifted by half a pixel (mean of adjacent columns and/or rows): text on the sheets is printed with an
 * arbitrary sub-pixel phase; a thin-font stroke lies in one column or is smeared over two, and an integer shift
 * cannot align that (correlation dropped to 0.64–0.80 on the same character).
 */
function halfShifted(glyph: Glyph, byX: boolean, byY: boolean): Glyph {
  const width = glyph.width + (byX ? 1 : 0);
  const height = glyph.height + (byY ? 1 : 0);
  const data = new Uint8Array(width * height);
  const at = (i: number, j: number): number => (i >= 0 && j >= 0 && i < glyph.width && j < glyph.height ? glyph.data[j * glyph.width + i] : 0);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let sum = 0;
      let n = 0;
      for (const di of byX ? [-1, 0] : [0]) {
        for (const dj of byY ? [-1, 0] : [0]) {
          sum += at(i + di, j + dj);
          n++;
        }
      }
      data[j * width + i] = Math.round(sum / n);
    }
  }
  return { ...glyph, width, height, data };
}

const variantsCache = new WeakMap<Glyph, Glyph[]>();

/** The template and its three half-pixel variants (along x, along y, along both axes). */
function variants(glyph: Glyph): Glyph[] {
  let list = variantsCache.get(glyph);
  if (!list) {
    list = [glyph, halfShifted(glyph, true, false), halfShifted(glyph, false, true), halfShifted(glyph, true, true)];
    variantsCache.set(glyph, list);
  }
  return list;
}

/** Best correlation of the sheet glyph in `rect` with the template over shifts ±SHIFT and half-pixel template variants. */
function bestShiftScore(img: GrayImage, rect: Rect, glyph: Glyph, threshold: number): number {
  let best = -1;
  for (const variant of variants(glyph)) {
    const w = Math.max(rect.width, variant.width) + 2 * PAD;
    const h = Math.max(rect.height, variant.height) + 2 * PAD;
    for (let dy = -SHIFT; dy <= SHIFT; dy++) {
      for (let dx = -SHIFT; dx <= SHIFT; dx++) {
        const score = windowScore(img, rect.x - PAD + dx, rect.y - PAD + dy, w, h, variant, threshold);
        if (score > best) best = score;
      }
    }
  }
  return best;
}

interface Candidate {
  text: string;
  score: number;
}

/** Line height of the set: max of `dy + height` over templates. */
function lineHeight(set: GlyphSet): number {
  return Math.max(0, ...set.glyphs.map((g) => (g.dy ?? 0) + g.height));
}

/** Stamp the template onto the line canvas at column `x0` with its `dy` offset (max over overlap). */
function stamp(canvas: Uint8Array, width: number, height: number, g: Glyph, x0: number): void {
  const dy = g.dy ?? 0;
  for (let j = 0; j < g.height && dy + j < height; j++) {
    for (let i = 0; i < g.width; i++) {
      const k = (dy + j) * width + x0 + i;
      canvas[k] = Math.max(canvas[k], g.data[j * g.width + i]);
    }
  }
}

/** Join two templates into one line: `b` right of `a` by `a`'s width plus `gap` (−1 means a one-column overlap). */
function composite(a: Glyph, b: Glyph, gap: number, height: number): Glyph {
  const width = a.width + gap + b.width;
  const data = new Uint8Array(width * height);
  stamp(data, width, height, a, 0);
  stamp(data, width, height, b, a.width + gap);
  return { text: a.text + b.text, width, height, data };
}

/** Pair candidates for a merged glyph: all template pairs with gap −1..1 whose width differs from the crop by at most 1 px. */
function pairCandidates(img: GrayImage, rect: Rect, set: GlyphSet, threshold: number): Candidate[] {
  const out: Candidate[] = [];
  const height = lineHeight(set);
  for (const a of set.glyphs) {
    for (const b of set.glyphs) {
      for (let gap = -1; gap <= 1; gap++) {
        if (Math.abs(a.width + gap + b.width - rect.width) > 1) continue;
        const pair = composite(a, b, gap, height);
        out.push({ text: pair.text, score: bestShiftScore(img, rect, pair, threshold) });
      }
    }
  }
  return out;
}

/** Decision over the candidate list: the best one and its margin over the best with different text (none means margin 1). */
function decide(candidates: Candidate[]): GlyphMatch {
  if (!candidates.length) return { text: '?', score: 0, margin: 0 };
  const ranked = [...candidates].sort((p, q) => q.score - p.score);
  const best = ranked[0];
  const second = ranked.find((c) => c.text !== best.text);
  const margin = second ? best.score - second.score : 1;
  const accepted = best.score >= ACCEPT_SCORE && margin >= ACCEPT_MARGIN;
  return { text: accepted ? best.text : '?', score: best.score, margin };
}

/**
 * Reads one sheet glyph in `rect` against the template set: nearest template with a margin; a glyph wider than
 * `set.pairAbove` is resolved by trying pairs; a rejected one is `text: '?'` (with the best attempt's correlation and margin).
 */
export function matchGlyphs(img: GrayImage, rect: Rect, set: GlyphSet): GlyphMatch {
  const threshold = set.inkThreshold ?? DEFAULT_INK_THRESHOLD;
  if (set.pairAbove !== undefined && rect.width > set.pairAbove) {
    return decide(pairCandidates(img, rect, set, threshold));
  }
  return decide(set.glyphs.map((g) => ({ text: g.text, score: bestShiftScore(img, rect, g, threshold) })));
}

/** A template placed on the sheet: rectangle in sheet px. */
export interface Placement {
  glyph: Glyph;
  rect: Rect;
}

/**
 * Aligns a known template sequence to a word (for building templates from merged words with known text):
 * tries gaps between adjacent templates from −1 to `maxGap` and shifts ±1 px; the criterion is the correlation
 * of the composite template with the word window. Returns character positions and correlation (no templates: empty).
 */
export function alignSequence(img: GrayImage, rect: Rect, sequence: Glyph[], threshold: number, maxGap = 2): { parts: Placement[]; score: number } {
  if (!sequence.length) return { parts: [], score: 0 };
  const height = Math.max(...sequence.map((g) => (g.dy ?? 0) + g.height));
  let best = { parts: [] as Placement[], score: -1 };
  const gaps = new Array<number>(sequence.length - 1).fill(0);
  const tryGaps = (k: number): void => {
    if (k < gaps.length) {
      for (let g = -1; g <= maxGap; g++) {
        gaps[k] = g;
        tryGaps(k + 1);
      }
      return;
    }
    const offsets: number[] = [0];
    for (let i = 1; i < sequence.length; i++) offsets.push(offsets[i - 1] + sequence[i - 1].width + gaps[i - 1]);
    const width = offsets[sequence.length - 1] + sequence[sequence.length - 1].width;
    const data = new Uint8Array(width * height);
    sequence.forEach((g, i) => stamp(data, width, height, g, offsets[i]));
    const composite: Glyph = { text: sequence.map((g) => g.text).join(''), width, height, data };
    const w = Math.max(rect.width, width) + 2 * PAD;
    const h = Math.max(rect.height, height) + 2 * PAD;
    for (let dy = -SHIFT; dy <= SHIFT; dy++) {
      for (let dx = -SHIFT; dx <= SHIFT; dx++) {
        const score = windowScore(img, rect.x - PAD + dx, rect.y - PAD + dy, w, h, composite, threshold);
        if (score > best.score) {
          best = {
            score,
            parts: sequence.map((g, i) => ({ glyph: g, rect: { x: rect.x + dx + offsets[i], y: rect.y + dy + (g.dy ?? 0), width: g.width, height: g.height } })),
          };
        }
      }
    }
  };
  tryGaps(0);
  return best;
}

/** Limits of template brightness fitting during DP placement: no dimmer than half and no brighter than double. */
const SCALE_MIN = 0.5;
const SCALE_MAX = 2;
/** Fixed cost of placing a template (square of one pixel's soft ink ≈ 50): on a tie, the empty column wins. */
const PLACEMENT_COST = 50 * 50;

/**
 * Splits a word into a template sequence by dynamic programming over the word window's columns
 * (with 1 px padding on each side, line shift −1..1 px): a column is either empty (cost is its soft-ink energy)
 * or a template start (cost is the sum of squared differences between soft ink and the template over its columns
 * and all rows of the font line, plus PLACEMENT_COST). Template brightness is fitted by least squares at each
 * placement (factor SCALE_MIN..SCALE_MAX): templates from different sheets differ in brightness, and a light
 * template would otherwise cheaply "explain" the edge of a neighbouring character. Templates are taken together
 * with their half-pixel variants, the same space in which instances are selected and a glyph is accepted. The
 * minimum total cost gives glyph positions, including merged ones (anti-aliasing joins adjacent digits); each
 * position is read by `matchGlyphs` over the original template's rectangle.
 */
export function decodeWord(img: GrayImage, rect: Rect, set: GlyphSet): Placement[] {
  const threshold = set.inkThreshold ?? DEFAULT_INK_THRESHOLD;
  const H = lineHeight(set) + 1;
  const x0 = rect.x - 1;
  const N = rect.width + 2;
  if (!set.glyphs.length || H === 0 || N <= 0) return [];
  /** All variants of all templates; each variant carries its original template, whose rectangle describes the position. */
  const templates = set.glyphs.flatMap((g) => variants(g).map((v) => ({ v, g })));
  let bestTotal = Infinity;
  let bestParts: Placement[] = [];
  for (let shift = -SHIFT; shift <= SHIFT; shift++) {
    const y0 = rect.y + shift;
    const cols: Float64Array[] = [];
    const energy = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const col = new Float64Array(H);
      const x = x0 + i;
      for (let j = 0; j < H; j++) {
        const y = y0 + j;
        const v = x >= 0 && y >= 0 && x < img.width && y < img.height ? softInk(img.data[y * img.width + x], threshold) : 0;
        col[j] = v;
        energy[i] += v * v;
      }
      cols.push(col);
    }
    const best = new Float64Array(N + 1).fill(Infinity);
    const from = new Int32Array(N + 1).fill(-1);
    const via = new Int32Array(N + 1).fill(-1);
    best[0] = 0;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(best[i])) continue;
      if (best[i] + energy[i] < best[i + 1]) {
        best[i + 1] = best[i] + energy[i];
        from[i + 1] = i;
        via[i + 1] = -1;
      }
      templates.forEach(({ v }, ti) => {
        if (i + v.width > N) return;
        const dy = v.dy ?? 0;
        // Brightness fit: α = Σ I·T / Σ T² within SCALE_MIN..SCALE_MAX.
        let it = 0;
        let tt = 0;
        for (let a = 0; a < v.width; a++) {
          const col = cols[i + a];
          for (let j = 0; j < v.height; j++) {
            const t = v.data[j * v.width + a];
            it += col[dy + j] * t;
            tt += t * t;
          }
        }
        const scale = tt > 0 ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, it / tt)) : 1;
        let cost = PLACEMENT_COST;
        for (let a = 0; a < v.width; a++) {
          const col = cols[i + a];
          for (let j = 0; j < H; j++) {
            const t = j >= dy && j < dy + v.height ? scale * v.data[(j - dy) * v.width + a] : 0;
            const d = col[j] - t;
            cost += d * d;
          }
        }
        const end = i + v.width;
        if (best[i] + cost < best[end]) {
          best[end] = best[i] + cost;
          from[end] = i;
          via[end] = ti;
        }
      });
    }
    if (best[N] < bestTotal) {
      bestTotal = best[N];
      const parts: Placement[] = [];
      for (let i = N; i > 0; i = from[i]) {
        const ti = via[i];
        if (ti < 0) continue;
        const { g } = templates[ti];
        parts.push({ glyph: g, rect: { x: x0 + from[i], y: y0 + (g.dy ?? 0), width: g.width, height: g.height } });
      }
      bestParts = parts.reverse();
    }
  }
  return bestParts;
}

/** Position of a found fragment on the sheet. */
export interface FragmentHit {
  text: string;
  rect: Rect;
  score: number;
}

/**
 * Finds a fragment (a template string) by sliding over an area: best correlation over all window positions in
 * `area` (x: all columns, y: all rows of the area). Accepted at correlation ≥ ACCEPT_SCORE, otherwise `undefined`.
 */
export function findFragment(img: GrayImage, area: Rect, glyph: Glyph, threshold = DEFAULT_INK_THRESHOLD): FragmentHit | undefined {
  let best: FragmentHit | undefined;
  const w = glyph.width + 2 * PAD;
  const h = glyph.height + 2 * PAD;
  for (let y = area.y; y + glyph.height <= area.y + area.height; y++) {
    for (let x = area.x; x + glyph.width <= area.x + area.width; x++) {
      const score = windowScore(img, x - PAD, y - PAD, w, h, glyph, threshold);
      if (!best || score > best.score) best = { text: glyph.text, rect: { x, y, width: glyph.width, height: glyph.height }, score };
    }
  }
  return best && best.score >= ACCEPT_SCORE ? best : undefined;
}
