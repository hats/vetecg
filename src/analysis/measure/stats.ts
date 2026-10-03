/** Robust statistics for measurements and rhythm: medians, mean, spread, correlation. Stateless. */

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample SD (n − 1); fewer than two values — 0. */
export function std(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / (values.length - 1));
}

/** Median of samples `mv[a..b]` (bounds inclusive, clipped to the signal); empty span — `undefined`. */
export function medianOf(mv: ArrayLike<number>, from: number, to: number): number | undefined {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(mv.length - 1, Math.max(from, to));
  if (b < a) return undefined;
  const values: number[] = [];
  for (let i = a; i <= b; i++) values.push(mv[i]);
  return median(values);
}

/** Index of the `score` extremum on `[from, to]` (bounds clipped to the array); empty span — `from`. */
export function argExtreme(values: ArrayLike<number>, from: number, to: number, score: (v: number) => number): number {
  const a = Math.max(0, from);
  const b = Math.min(values.length - 1, to);
  let best = a;
  let bestScore = -Infinity;
  for (let i = a; i <= b; i++) {
    const s = score(values[i]);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

/** Pearson correlation coefficient over the common length; degenerate series — 0. */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
