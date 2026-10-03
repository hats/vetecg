/**
 * "+" second marks: dark 3–5 px crosses in the second-mark columns (step 50 mm = 10 five-millimetre
 * lines) and in rows every 10 mm (every other 5-mm row). Rows are predicted from the measured grid;
 * columns are the x with the most crosses across rows, required to lie on 5-mm lines along X and in one
 * "every 10 lines" class (cross-like curve segments do not fall into this class);
 * least squares over the subpixel column centres gives one second in px.
 */
import type { GrayImage, Rect } from '../../types/contracts';

export interface PlusMarks {
  /** Subpixel centres of the found "+" columns, sheet px. */
  columnsX: number[];
  /** Predicted "+" rows, sheet px. */
  rowsY: number[];
  /** One second of tape in px (least squares over columns); fewer than two columns — `null`. */
  pxPerSecond: number | null;
  /** Crosses in the best column — a reliability measure. */
  bestColumnHits: number;
}

export interface GridForPlus {
  pxPerMmX: number;
  pxPerMmY: number;
  /** First 5-mm lines along the axes, sheet px. */
  phaseX: number;
  phaseY: number;
}

/** Cross centred at (x, y): ≥ 3 dark of 5 vertically and ≥ 3 of 5 horizontally. */
function isCross(img: GrayImage, x: number, y: number, dark: number): boolean {
  const { width, height, data } = img;
  if (x < 2 || y < 2 || x + 2 >= width || y + 2 >= height) return false;
  let vertical = 0;
  let horizontal = 0;
  for (let d = -2; d <= 2; d++) {
    if (data[(y + d) * width + x] < dark) vertical++;
    if (data[y * width + x + d] < dark) horizontal++;
  }
  return vertical >= 3 && horizontal >= 3;
}

/** Darkness centroid of the horizontal arm over x−2..x+2 (subpixel column centre). */
function crossCenterX(img: GrayImage, x: number, y: number, dark: number): number {
  let weight = 0;
  let moment = 0;
  for (let d = -2; d <= 2; d++) {
    const v = img.data[y * img.width + x + d];
    if (v < dark) {
      const w = dark - v;
      weight += w;
      moment += w * (x + d);
    }
  }
  return weight > 0 ? moment / weight : x;
}

function rowsFor(rect: Rect, grid: GridForPlus, parity: number): number[] {
  const step5 = 5 * grid.pxPerMmY;
  const rows: number[] = [];
  for (let j = parity; ; j += 2) {
    const y = grid.phaseY + j * step5;
    if (y > rect.y + rect.height - 3) break;
    if (y >= rect.y + 3) rows.push(y);
  }
  return rows;
}

function columnScores(img: GrayImage, rect: Rect, rows: number[], dark: number): Int32Array {
  const scores = new Int32Array(rect.width);
  for (const yRow of rows) {
    const y = Math.round(yRow);
    for (let i = 0; i < rect.width; i++) {
      const x = rect.x + i;
      if (isCross(img, x, y, dark) || isCross(img, x, y - 1, dark) || isCross(img, x, y + 1, dark)) scores[i]++;
    }
  }
  return scores;
}

interface Candidate {
  x: number;
  hits: number;
  /** Index of the 5-mm line along X counted from the first. */
  line: number;
}

/** Local maxima of the cross count that lie on a 5-mm line (± `lineTolerance` of the line step). */
function lineCandidates(rect: Rect, scores: Int32Array, grid: GridForPlus, minHits: number, lineTolerance: number): Candidate[] {
  const step5 = 5 * grid.pxPerMmX;
  const out: Candidate[] = [];
  for (let i = 0; i < scores.length; i++) {
    const hits = scores[i];
    if (hits < minHits) continue;
    if ((i > 0 && scores[i - 1] > hits) || (i + 1 < scores.length && scores[i + 1] > hits)) continue;
    const x = rect.x + i;
    const position = (x - grid.phaseX) / step5;
    const line = Math.round(position);
    if (Math.abs(position - line) > lineTolerance) continue;
    const last = out[out.length - 1];
    if (last && last.line === line) {
      if (hits > last.hits) out[out.length - 1] = { x, hits, line };
      continue;
    }
    out.push({ x, hits, line });
  }
  return out;
}

/** The "every 10" line class with the largest cross total — the real second columns. */
function majorityClass(candidates: Candidate[]): Candidate[] {
  const weight = new Map<number, number>();
  for (const c of candidates) {
    const key = ((c.line % 10) + 10) % 10;
    weight.set(key, (weight.get(key) ?? 0) + c.hits);
  }
  let bestKey = -1;
  let bestWeight = 0;
  for (const [key, w] of weight) {
    if (w > bestWeight) {
      bestWeight = w;
      bestKey = key;
    }
  }
  return candidates.filter((c) => ((c.line % 10) + 10) % 10 === bestKey);
}

/** Least squares "centre = a + b·n", n being the second index (line / 10). */
function fitSecond(columns: { x: number; line: number }[]): number | null {
  if (columns.length < 2) return null;
  const n = columns.map((c) => c.line / 10);
  const count = n.length;
  const meanN = n.reduce((s, v) => s + v, 0) / count;
  const meanX = columns.reduce((s, c) => s + c.x, 0) / count;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < count; i++) {
    numerator += (n[i] - meanN) * (columns[i].x - meanX);
    denominator += (n[i] - meanN) ** 2;
  }
  return denominator > 0 ? numerator / denominator : null;
}

/** `dark` is the cross ink threshold; `lineTolerance` is the column position tolerance on a 5-mm line (fraction of line step). */
export function findPlusMarks(img: GrayImage, rect: Rect, grid: GridForPlus, dark: number, lineTolerance: number): PlusMarks {
  // The parity of the 5-mm rows carrying crosses is not known in advance — pick the one where the best column is richer.
  let best: { rows: number[]; scores: Int32Array; max: number } | null = null;
  for (const parity of [0, 1]) {
    const rows = rowsFor(rect, grid, parity);
    if (rows.length === 0) continue;
    const scores = columnScores(img, rect, rows, dark);
    let max = 0;
    for (let i = 0; i < scores.length; i++) if (scores[i] > max) max = scores[i];
    if (!best || max > best.max) best = { rows, scores, max };
  }
  if (!best || best.max === 0) return { columnsX: [], rowsY: [], pxPerSecond: null, bestColumnHits: 0 };

  const { rows, scores } = best;
  const minHits = Math.max(4, Math.ceil(0.25 * rows.length));
  const columns = majorityClass(lineCandidates(rect, scores, grid, minHits, lineTolerance)).map((c) => {
    let sum = 0;
    let n = 0;
    for (const yRow of rows) {
      const y = Math.round(yRow);
      for (const dy of [0, -1, 1]) {
        if (isCross(img, c.x, y + dy, dark)) {
          sum += crossCenterX(img, c.x, y + dy, dark);
          n++;
          break;
        }
      }
    }
    return { x: n ? sum / n : c.x, line: c.line };
  });

  return {
    columnsX: columns.map((c) => c.x),
    rowsY: rows,
    pxPerSecond: fitSecond(columns),
    bestColumnHits: best.max,
  };
}
