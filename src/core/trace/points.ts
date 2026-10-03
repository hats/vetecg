/**
 * Trace points from a lead's primary runs: on flat stretches, the subpixel center of mass of the column's
 * darkness; on steep ones, the run's entry (x−0.5) and exit (x+0.5) at column boundaries plus an apex (x, run
 * edge) if the path turns inside the run and that run is the stroke's extreme among its neighbors.
 */
import type { InkMask, Point } from '../../types/contracts';
import type { Run } from './runs';

/** A run no taller than this is a flat stretch: one point at the center of mass. */
export const FLAT_MAX_HEIGHT = 3;
/** A part of the run not covered by the path at least this long is an apex (a turn inside the run). */
export const PEAK_MIN = 2;

export interface PathRun {
  x: number;
  run: Run;
}

/** Subpixel center of mass of darkness in the run's column; without a darkness map, the run's midpoint. */
export function centerOfMass(ink: InkMask, run: Run): number {
  const { darkness, width } = ink;
  if (!darkness) return (run.y0 + run.y1) / 2;
  let weight = 0;
  let moment = 0;
  for (let y = run.y0; y <= run.y1; y++) {
    const w = darkness[y * width + run.x];
    weight += w;
    moment += w * y;
  }
  return weight > 0 ? moment / weight : (run.y0 + run.y1) / 2;
}

/** Which extremes of a run the lead may declare an apex (for runs shared with another lead). */
export interface PeakClaim {
  top: boolean;
  bottom: boolean;
}

/** Transition point between runs of adjacent columns: center of the overlap or middle of the gap. */
export function boundaryY(a: Run, b: Run): number {
  const lo = Math.max(a.y0, b.y0);
  const hi = Math.min(a.y1, b.y1);
  if (lo <= hi) return (lo + hi) / 2;
  return b.y0 > a.y1 ? (a.y1 + b.y0) / 2 : (a.y0 + b.y1) / 2;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isFlat = (run: Run) => run.y1 - run.y0 + 1 <= FLAT_MAX_HEIGHT;

/**
 * Builds the polyline from a sequence of primary runs (ascending x; columns may be skipped, in which case
 * the polyline joins neighboring points directly, and that is the gap interpolation). For runs in
 * `claims` (shared with another lead) apexes are declared only with permission: a shared run's extreme
 * belongs to one of the leads, and the caller decides that from the geometry of the whole shared stretch.
 */
export function buildPoints(ink: InkMask, seq: PathRun[], claims?: Map<number, PeakClaim>): Point[] {
  const points: Point[] = [];
  let lastY: number | null = null;
  for (let k = 0; k < seq.length; k++) {
    const { x, run } = seq[k];
    const claim = claims?.get(x);
    const prev = k > 0 && seq[k - 1].x === x - 1 ? seq[k - 1].run : null;
    const next = k + 1 < seq.length && seq[k + 1].x === x + 1 ? seq[k + 1].run : null;
    if (isFlat(run)) {
      const y = centerOfMass(ink, run);
      if (prev && !isFlat(prev)) points.push({ x: x - 0.5, y: boundaryY(prev, run) });
      points.push({ x, y });
      lastY = y;
      continue;
    }
    // Steep run: entry and exit.
    let yIn: number;
    if (prev) yIn = boundaryY(prev, run);
    else if (lastY !== null) yIn = clamp(lastY, run.y0, run.y1);
    else yIn = (run.y0 + run.y1) / 2;
    let yOut: number;
    if (next) yOut = boundaryY(run, next);
    else if (k + 1 < seq.length) yOut = clamp((seq[k + 1].run.y0 + seq[k + 1].run.y1) / 2, run.y0, run.y1);
    else yOut = yIn;
    points.push({ x: x - 0.5, y: yIn });
    const covLo = Math.min(yIn, yOut);
    const covHi = Math.max(yIn, yOut);
    const peaks: number[] = [];
    const topFree = covLo - run.y0;
    const bottomFree = run.y1 - covHi;
    const topOwner = (!prev || run.y0 < prev.y0) && (!next || run.y0 <= next.y0) && (!claim || claim.top);
    const bottomOwner = (!prev || run.y1 > prev.y1) && (!next || run.y1 >= next.y1) && (!claim || claim.bottom);
    if (topFree >= PEAK_MIN && topOwner) peaks.push(run.y0);
    if (bottomFree >= PEAK_MIN && bottomOwner) peaks.push(run.y1);
    if (peaks.length === 2 && Math.abs(peaks[0] - yIn) > Math.abs(peaks[1] - yIn)) peaks.reverse();
    for (const y of peaks) points.push({ x, y });
    // Exit only when the next run is not a steep neighbor (otherwise it adds the entry point at the boundary itself).
    if (!next || isFlat(next)) points.push({ x: x + 0.5, y: yOut });
    lastY = yOut;
  }
  return points;
}
