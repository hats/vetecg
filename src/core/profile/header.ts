/**
 * Binary sheet crops and the Jaccard distance between them — to confirm the variant by the product line
 * in the header (task 02) and to compare the left part of the header for "same animal" (case task).
 * Crops are compared in sheet coordinates: pixel (x, y) of one is matched with (x + dx, y + dy) of the other.
 */
import type { BinaryPatch, GrayImage, Rect } from '../../types/contracts';

/** Template from rows like `..##.#..`: `#` is ink, everything else is background. Rows have equal length. */
export function patchFromRows(x: number, y: number, rows: readonly string[]): BinaryPatch {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8Array(width * height);
  rows.forEach((row, j) => {
    if (row.length !== width) throw new Error(`Строка ${j} шаблона имеет длину ${row.length}, ожидалось ${width}`);
    for (let i = 0; i < width; i++) if (row[i] === '#') data[j * width + i] = 1;
  });
  return { x, y, width, height, data };
}

/** Pixels darker than `threshold` inside `rect` → 1; outside the sheet — background. */
export function binarizeRect(img: GrayImage, rect: Rect, threshold: number): BinaryPatch {
  const { width, height } = rect;
  const data = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    const sy = rect.y + j;
    if (sy < 0 || sy >= img.height) continue;
    const row = sy * img.width;
    for (let i = 0; i < width; i++) {
      const sx = rect.x + i;
      if (sx >= 0 && sx < img.width && img.data[row + sx] < threshold) data[j * width + i] = 1;
    }
  }
  return { x: rect.x, y: rect.y, width, height, data };
}

function inkCount(p: BinaryPatch): number {
  let n = 0;
  for (let i = 0; i < p.data.length; i++) n += p.data[i];
  return n;
}

/** Jaccard distance (1 − |A∩B|/|A∪B|) with `b` shifted by (dx, dy) in sheet coordinates. */
function jaccardAt(a: BinaryPatch, b: BinaryPatch, dx: number, dy: number, inkA: number, inkB: number): number {
  let inter = 0;
  for (let j = 0; j < a.height; j++) {
    const by = a.y + j - b.y + dy;
    if (by < 0 || by >= b.height) continue;
    const rowA = j * a.width;
    const rowB = by * b.width;
    for (let i = 0; i < a.width; i++) {
      if (!a.data[rowA + i]) continue;
      const bx = a.x + i - b.x + dx;
      if (bx >= 0 && bx < b.width && b.data[rowB + bx]) inter++;
    }
  }
  const union = inkA + inkB - inter;
  return union === 0 ? 0 : 1 - inter / union;
}

/**
 * Jaccard distance between two crops in sheet coordinates; `maxShift` > 0 — minimum over shifts of the
 * second crop by ±maxShift px along both axes (robustness to text shifted by 1–2 px).
 */
export function jaccardDistance(a: BinaryPatch, b: BinaryPatch, maxShift = 0): number {
  const inkA = inkCount(a);
  const inkB = inkCount(b);
  if (inkA === 0 && inkB === 0) return 0;
  if (inkA === 0 || inkB === 0) return 1;
  let best = 1;
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      const d = jaccardAt(a, b, dx, dy, inkA, inkB);
      if (d < best) best = d;
    }
  }
  return best;
}
