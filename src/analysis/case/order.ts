/**
 * Order of the case sheets (decisions §2 step 11; stories 3, 6–9): sheet recording time from time labels,
 * byte-identical duplicates by hashes, "same animal" groups by header crop (Jaccard distance) and date, repeated intervals.
 *
 * Sheet recording time: each label `seconds_k` sits above column `x_k`; the sheet start (left edge of the plot area)
 * in recording seconds is the median over labels of `seconds_k − (x_k − plot.x) / pxPerSecond` (one misread digit
 * does not shift the median); the scale is the median slope over adjacent labels, else a second from the "+" marks of
 * the layout. End — start plus the sheet signal duration. The systematic offset of a label above its column is the same
 * on all sheets of the device and does not affect relative sheet offsets.
 *
 * "Same animal": the header dates (without time — it differs between sheets) match or at least one is unread,
 * and the Jaccard distance between header crops with the pet name (`PageMeta.headerNameCrop`, shift ±2 px) is below 0.3
 * (probe: different animals 0.65–0.80, copies 0). Crop not anchored on «ЭКГ» ("ECG"; `header_name_unanchored`, empty) —
 * ownership cannot be checked: the sheet stays in the group of the nearest-by-upload verifiable sheet with the code
 * `animal_unverified`. Groups are transitive (union of pairs). There are no multi-page recordings of one animal among
 * the fixtures — the rule is verified on synthetic combinations; real verification — with the first multi-page case.
 */
import type { BinaryPatch, GrayImage, PageOrder, PageResult, RecordSpan, TimeLabel } from '../../types/contracts';
import { binarizeRect, jaccardDistance } from '../../core/profile';
import { median } from '../measure';

/** Jaccard distance between header crops below which sheets are one recording of one animal. */
export const SAME_ANIMAL_MAX_DISTANCE = 0.3;
/** Shift when comparing header crops, px (text is printed with a 1–2 px shift between sheets). */
export const HEADER_MAX_SHIFT = 2;
/** Binarization threshold of the header crop (`headerNameCrop`: 0 — ink, 255 — background). */
const CROP_INK_THRESHOLD = 128;
/**
 * Overlap of the time intervals of two sheets of one recording from which the second is a "repeated interval", s.
 * Adjacent sheets of the device physically overlap: a variant A sheet lasts 5.36 s with labels every 1 s (≈ 0.4 s
 * shared). Verified only on synthetic combinations.
 */
export const OVERLAP_MIN_S = 1.0;

function secondScale(page: PageResult, labels: readonly TimeLabel[]): number {
  const sorted = [...labels].sort((a, b) => a.x - b.x);
  const slopes: number[] = [];
  for (let k = 1; k < sorted.length; k++) {
    const ds = sorted[k].seconds - sorted[k - 1].seconds;
    const dx = sorted[k].x - sorted[k - 1].x;
    if (ds > 0 && dx > 0) slopes.push(dx / ds);
  }
  if (slopes.length) return median(slopes);
  const grid = page.layout.grid;
  if (grid.pxPerSecond !== undefined && grid.pxPerSecond > 0) return grid.pxPerSecond;
  return grid.pxPerMmX * page.calib.mmPerS;
}

/** Sheet signal duration, s: from signal samples, else from the plot area width. */
export function pageDurationS(page: PageResult, pxPerSecond?: number): number {
  const samples = Math.max(0, ...page.signals.map((s) => s.mv.length));
  if (samples > 0) return samples / (page.signals[0]?.fs ?? 500);
  const plot = page.layout.zones.plot ?? page.layout.frame;
  return pxPerSecond !== undefined && pxPerSecond > 0 ? plot.width / pxPerSecond : 0;
}

/** Sheet recording time interval from time labels; no labels or unknown scale — `undefined`. */
export function recordSpan(page: PageResult): RecordSpan | undefined {
  const labels = page.meta.timeLabels.filter((l) => Number.isFinite(l.seconds) && Number.isFinite(l.x));
  if (labels.length === 0) return undefined;
  const pxPerSecond = secondScale(page, labels);
  if (!(pxPerSecond > 0)) return undefined;
  const plot = page.layout.zones.plot ?? page.layout.frame;
  const startS = median(labels.map((l) => l.seconds - (l.x - plot.x) / pxPerSecond));
  return { startS, endS: startS + pageDurationS(page, pxPerSecond) };
}

function cropPatch(crop: GrayImage): BinaryPatch {
  return binarizeRect(crop, { x: 0, y: 0, width: crop.width, height: crop.height }, CROP_INK_THRESHOLD);
}

/** The header crop is fit for comparison: non-empty and cropped at the «ЭКГ» ("ECG") anchor. */
export function headerComparable(page: PageResult): boolean {
  const crop = page.meta.headerNameCrop;
  return crop.width > 0 && crop.height > 0 && !page.issues.includes('header_name_unanchored');
}

/** Jaccard distance between the header crops of two sheets (0 — identical). */
export function headerDistance(a: PageResult, b: PageResult): number {
  return jaccardDistance(cropPatch(a.meta.headerNameCrop), cropPatch(b.meta.headerNameCrop), HEADER_MAX_SHIFT);
}

const dateOf = (page: PageResult): string | undefined => page.meta.headerDate?.slice(0, 10);

/** Same recording of one animal: `false` — different dates or distant headers; `undefined` — at least one header not comparable. */
export function sameAnimal(a: PageResult, b: PageResult): boolean | undefined {
  const da = dateOf(a);
  const db = dateOf(b);
  if (da !== undefined && db !== undefined && da !== db) return false;
  if (!headerComparable(a) || !headerComparable(b)) return undefined;
  return headerDistance(a, b) < SAME_ANIMAL_MAX_DISTANCE;
}

const overlapS = (a: RecordSpan, b: RecordSpan): number => Math.min(a.endS, b.endS) - Math.max(a.startS, b.startS);

export function orderPages(pages: PageResult[], hashes: string[]): PageOrder {
  const spans = pages.map(recordSpan);

  // 1. Byte-identical duplicates — equal hashes; the original is the first uploaded.
  const firstByHash = new Map<string, number>();
  const dupGroups = new Map<number, number[]>();
  const canonical: number[] = [];
  pages.forEach((_, i) => {
    const hash = hashes[i];
    const first = hash === undefined ? undefined : firstByHash.get(hash);
    if (first === undefined) {
      if (hash !== undefined) firstByHash.set(hash, i);
      canonical.push(i);
      return;
    }
    const group = dupGroups.get(first) ?? [first];
    group.push(i);
    dupGroups.set(first, group);
  });
  const duplicates = [...dupGroups.values()];

  // 2. Animal groups — union of pairs with a confirmed "same"; unverifiable sheets go to their upload neighbor.
  const parent = pages.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const comparable = canonical.filter((i) => headerComparable(pages[i]));
  for (let x = 0; x < comparable.length; x++) {
    for (let y = x + 1; y < comparable.length; y++) {
      if (sameAnimal(pages[comparable[x]], pages[comparable[y]]) === true) union(comparable[x], comparable[y]);
    }
  }
  const unverified = canonical.filter((i) => !headerComparable(pages[i]));
  for (const i of unverified) {
    const compatible = (j: number): boolean => sameAnimal(pages[i], pages[j]) !== false;
    const before = comparable.filter((j) => j < i && compatible(j)).at(-1);
    const after = comparable.find((j) => j > i && compatible(j));
    const neighbour = before ?? after ?? unverified.find((j) => j !== i && compatible(j) && find(j) !== find(i));
    if (neighbour !== undefined) union(i, neighbour);
  }

  // 3. Groups in upload order of their first sheet; within a group — by recording time if known for all.
  const byRoot = new Map<number, number[]>();
  for (const i of canonical) {
    const root = find(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), i]);
  }
  const issues: string[] = [];
  const overlaps: { a: number; b: number }[] = [];
  const order: number[] = [];
  let orderUnknown = false;
  const groups = [...byRoot.values()]
    .sort((g1, g2) => g1[0] - g2[0])
    .map((group) => {
      const known = group.every((i) => spans[i] !== undefined);
      if (group.length > 1 && !known) orderUnknown = true;
      const sorted = known ? [...group].sort((a, b) => spans[a]!.startS - spans[b]!.startS || a - b) : [...group];
      if (known) {
        // 4. Repeated interval: a sheet overlaps an already counted sheet of the group by at least `OVERLAP_MIN_S` — only one is counted.
        const counted: number[] = [];
        for (const i of sorted) {
          const hit = counted.find((j) => overlapS(spans[i]!, spans[j]!) >= OVERLAP_MIN_S);
          if (hit === undefined) counted.push(i);
          else overlaps.push({ a: hit, b: i });
        }
      }
      order.push(...sorted);
      return sorted;
    });

  if (groups.length > 1) issues.push('multiple_animals');
  if (orderUnknown) issues.push('order_unknown');
  for (const group of duplicates) for (const i of group.slice(1)) issues.push(`duplicate:${i}`);
  for (const { b } of overlaps) issues.push(`overlap:${b}`);
  for (const i of unverified) issues.push(`animal_unverified:${i}`);
  return { order, groups, duplicates, overlaps, issues, spans };
}
