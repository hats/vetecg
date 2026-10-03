/**
 * Sheet frame search: long lines (rows and columns where the share of pixels darker than `frameDark` ≥ `frameFill`).
 * The "Poly-Spectrum.NET" frame is gray (137–145), 1–2 px thick; inside the frame equally long rows can come
 * from baselines of low-amplitude leads, so only the outermost groups along each axis are taken.
 */
import type { GrayImage, ProfileThresholds, Rect } from '../../types/contracts';

/** A group of consecutive line rows/columns: indices of the first and the last. */
export type LineSpan = [number, number];

export interface FrameLines {
  top: LineSpan;
  bottom: LineSpan;
  left: LineSpan;
  right: LineSpan;
}

export interface FrameResult {
  /** Inner area: inner side of the line + 2 px halo (convention of the spike and the profile). */
  inner: Rect;
  lines: FrameLines;
}

/** Groups of consecutive indices where `fraction[i] ≥ minFraction`. */
function spans(fraction: Float64Array, minFraction: number): LineSpan[] {
  const result: LineSpan[] = [];
  let start = -1;
  for (let i = 0; i <= fraction.length; i++) {
    const on = i < fraction.length && fraction[i] >= minFraction;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      result.push([start, i - 1]);
      start = -1;
    }
  }
  return result;
}

export function findFrame(img: GrayImage, thresholds: ProfileThresholds): FrameResult | null {
  const { width, height, data } = img;
  const dark = thresholds.frameDark;
  const rowCount = new Int32Array(height);
  const colCount = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (data[row + x] < dark) {
        count++;
        colCount[x]++;
      }
    }
    rowCount[y] = count;
  }
  const rowFraction = Float64Array.from(rowCount, (c) => c / width);
  const colFraction = Float64Array.from(colCount, (c) => c / height);

  const rows = spans(rowFraction, thresholds.frameFill);
  const cols = spans(colFraction, thresholds.frameFill);
  if (rows.length < 2 || cols.length < 2) return null;

  const top = rows[0];
  const bottom = rows[rows.length - 1];
  const left = cols[0];
  const right = cols[cols.length - 1];
  const inner: Rect = {
    x: left[1] + 2,
    y: top[1] + 2,
    width: right[0] - 2 - (left[1] + 2) + 1,
    height: bottom[0] - 2 - (top[1] + 2) + 1,
  };
  // The frame covers a substantial part of the sheet; otherwise these are two random lines.
  if (inner.width < width / 2 || inner.height < height / 2) return null;
  return { inner, lines: { top, bottom, left, right } };
}
