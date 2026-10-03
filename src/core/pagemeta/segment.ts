/**
 * Sheet text segmentation, internal to module `pagemeta`: 8-connected components of dark pixels inside a
 * rectangle, merging of components overlapping in x into glyphs (":" and ";" are two stacked dots, "." above a
 * letter), splitting of glyphs into words by gap and of components into lines by y overlap.
 * Pure functions over `GrayImage`; coordinates are sheet px.
 */
import type { GrayImage, Rect } from '../../types/contracts';

/** Bounding rectangle of a component or glyph with its ink area. */
export interface Box extends Rect {
  area: number;
}

/** 8-connected components of pixels darker than `threshold` inside `rect` (the rectangle is clipped to the sheet). */
export function darkComponents(img: GrayImage, rect: Rect, threshold: number): Box[] {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.height));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return [];
  const dark = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const row = (y0 + j) * img.width + x0;
    for (let i = 0; i < w; i++) if (img.data[row + i] < threshold) dark[j * w + i] = 1;
  }
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const boxes: Box[] = [];
  for (let start = 0; start < dark.length; start++) {
    if (!dark[start] || seen[start]) continue;
    seen[start] = 1;
    let sp = 0;
    stack[sp++] = start;
    let area = 0;
    let xmin = w;
    let xmax = -1;
    let ymin = h;
    let ymax = -1;
    while (sp > 0) {
      const p = stack[--sp];
      const py = (p / w) | 0;
      const px = p - py * w;
      area++;
      if (px < xmin) xmin = px;
      if (px > xmax) xmax = px;
      if (py < ymin) ymin = py;
      if (py > ymax) ymax = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (dark[q] && !seen[q]) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    boxes.push({ x: x0 + xmin, y: y0 + ymin, width: xmax - xmin + 1, height: ymax - ymin + 1, area });
  }
  return boxes;
}

const right = (b: Rect): number => b.x + b.width - 1;
const bottom = (b: Rect): number => b.y + b.height - 1;

/** Union rectangle; area is the sum of areas. */
export function union(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map(right));
  const y1 = Math.max(...boxes.map(bottom));
  return { x, y, width: x1 - x + 1, height: y1 - y + 1, area: boxes.reduce((s, b) => s + b.area, 0) };
}

/** Overlap of two segments `[a0, a1]` and `[b0, b1]` in px (≤ 0 means no overlap). */
const overlap1d = (a0: number, a1: number, b0: number, b1: number): number => Math.min(a1, b1) - Math.max(a0, b0) + 1;

/** A tiny fragment (a detached anti-aliasing pixel) has at most this area. */
const FRAGMENT_AREA = 3;

/**
 * Components of one glyph are merged if they are stacked (dots of ":"/";": x overlap at least half the width of
 * the wider part and no y overlap, so a grid dot above a digit will not merge this way) or if a tiny fragment
 * lies entirely within the glyph's x range and adjoins it vertically within 1 px (an anti-aliasing pixel detached
 * from a letter). Adjacent letters overlap in x by at most one column, and a "." next to a digit shares its
 * rows, so they do not merge. The result is sorted by x.
 */
export function mergeByOverlapX(boxes: readonly Box[]): Box[] {
  const sorted = [...boxes].sort((a, b) => a.x - b.x || a.y - b.y);
  const glyphs: Box[] = [];
  let group: Box[] = [];
  for (const box of sorted) {
    const current = group.length ? union(group) : undefined;
    const overlapX = current ? overlap1d(current.x, right(current), box.x, right(box)) : 0;
    const stacked =
      current !== undefined &&
      overlapX >= 0.5 * Math.max(current.width, box.width) &&
      group.every((g) => overlap1d(g.y, bottom(g), box.y, bottom(box)) <= 0);
    const fragment =
      current !== undefined &&
      box.area <= FRAGMENT_AREA &&
      box.x >= current.x &&
      right(box) <= right(current) &&
      overlap1d(current.y, bottom(current), box.y, bottom(box)) >= 0;
    if (stacked || fragment) {
      group.push(box);
    } else {
      if (group.length) glyphs.push(union(group));
      group = [box];
    }
  }
  if (group.length) glyphs.push(union(group));
  return glyphs;
}

/** Glyphs (sorted by x) are split into words where neighbours are separated by at least `minGap` empty columns. */
export function splitWords(glyphs: readonly Box[], minGap: number): Box[][] {
  const words: Box[][] = [];
  let word: Box[] = [];
  let wordRight = -Infinity;
  for (const glyph of glyphs) {
    if (word.length && glyph.x - wordRight - 1 >= minGap) {
      words.push(word);
      word = [];
      wordRight = -Infinity;
    }
    word.push(glyph);
    wordRight = Math.max(wordRight, right(glyph));
  }
  if (word.length) words.push(word);
  return words;
}

/** Components overlapping in y (with a tolerance of `slack` rows) form one line; lines go top to bottom. */
export function groupLines(boxes: readonly Box[], slack = 0): Box[][] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Box[][] = [];
  let line: Box[] = [];
  let lineBottom = -Infinity;
  for (const box of sorted) {
    if (line.length && box.y <= lineBottom + 1 + slack) {
      line.push(box);
      lineBottom = Math.max(lineBottom, bottom(box));
    } else {
      if (line.length) lines.push(line.sort((a, b) => a.x - b.x));
      line = [box];
      lineBottom = bottom(box);
    }
  }
  if (line.length) lines.push(line.sort((a, b) => a.x - b.x));
  return lines;
}
