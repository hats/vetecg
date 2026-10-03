/**
 * Dynamic programming over runs: a lead's path from left to right, one run (or a skip) per column.
 * Costs: soft distance from the run's range to the lead's anchor (a tall wave is not penalized more than a
 * false jump to the neighbor), a linear penalty for the white vertical gap on a transition, a column skip,
 * re-entry after a skip; in the pair DP, a run shared by two leads.
 * There is no limit on jump size: the vertical is already inside the run.
 */
import { gapBetween, type Column, type Run } from './runs';

export interface DpCosts {
  /** Weight of the distance to the anchor per column (reached at a distance of one lead step). */
  baseline: number;
  /** Lead step, px: the scale of the distance to the anchor. */
  leadStep: number;
  /** Penalty per pixel of white gap on a transition between runs of adjacent columns. */
  gap: number;
  /** Penalty for a skipped column and for returning to ink after a skip. */
  skip: number;
  reentry: number;
  /** Penalty per column where two leads share one run (pair DP). */
  share: number;
  /**
   * Penalty for a transition where the run overlap lies strictly inside one of them with a margin of
   * `nestedMargin` on both sides: the path turns inside a stroke or goes to an antialiasing fragment.
   */
  nested: number;
  nestedMargin: number;
}

/**
 * A column skip with re-entry (4.5) costs more than a jump over a gap of up to 4 px: small stroke breaks are
 * jumped over. The nesting penalty (0.5) exceeds the difference in anchor distance between a fragment and the
 * stroke's trough (≈ 0.06 over 14 px) plus the shared-run penalty (0.1): an S wave that ran into the neighboring
 * baseline stays with its own lead.
 */
export const DEFAULT_COSTS: DpCosts = { baseline: 0.5, leadStep: 129, gap: 1, skip: 1.5, reentry: 3, share: 0.1, nested: 0.5, nestedMargin: 3 };

/** Cost of a transition between runs of adjacent columns: white gap and overlap nesting. */
export function transitionCost(a: Run, b: Run, costs: DpCosts): number {
  const gap = gapBetween(a, b);
  if (gap > 0) return costs.gap * gap;
  const lo = Math.max(a.y0, b.y0);
  const hi = Math.min(a.y1, b.y1);
  const m = costs.nestedMargin;
  const insideA = lo - a.y0 >= m && a.y1 - hi >= m;
  const insideB = lo - b.y0 >= m && b.y1 - hi >= m;
  return insideA || insideB ? costs.nested : 0;
}

/** Run prohibition for a lead (manual separators): `true` means the run is unavailable. */
export type Forbid = (run: Run) => boolean;

const INF = Number.POSITIVE_INFINITY;

/** Distance from the run's range to the anchor: 0 if the run covers the anchor. */
export function anchorDistance(run: Run, anchorY: number): number {
  if (anchorY < run.y0) return run.y0 - anchorY;
  if (anchorY > run.y1) return anchorY - run.y1;
  return 0;
}

export function unaryCost(run: Run, anchorY: number, costs: DpCosts): number {
  const d = anchorDistance(run, anchorY) / costs.leadStep;
  // Linear up to one lead step; steeper beyond: a lead two steps away is implausible.
  return costs.baseline * (d <= 1 ? d : 1 + 3 * (d - 1));
}

/** Path: run index in the column (`slot`) or −1 for a skip. */
export type Path = Int32Array;

/** Height memory step in the skip state, px. */
const SKIP_BIN = 8;

/** Vertical distance from height `y` to the run's range. */
function distanceToRun(y: number, run: Run): number {
  return y < run.y0 ? run.y0 - y : y > run.y1 ? y - run.y1 : 0;
}

/**
 * Single DP. Column states: runs 0..m−1 and skips m..m+B−1 that remember the height (binned by
 * `SKIP_BIN` px) at which the lead left the ink: returning to ink costs `reentry` plus the gap penalty
 * for the vertical from the remembered height; otherwise "skip a column and come back anywhere" would be
 * cheaper than jumping to the neighbor. In the first column only a skip at the anchor is available.
 */
export function traceSingle(columns: Column[], anchorY: number, costs: DpCosts, forbid?: Forbid, yRange: [number, number] = [0, 2000]): Path {
  const n = columns.length;
  const B = Math.max(1, Math.ceil((yRange[1] - yRange[0] + 1) / SKIP_BIN));
  const binOf = (y: number) => Math.max(0, Math.min(B - 1, Math.floor((y - yRange[0]) / SKIP_BIN)));
  const binCenter = (b: number) => yRange[0] + (b + 0.5) * SKIP_BIN;
  const cost: Float64Array[] = [];
  const back: Int32Array[] = [];
  for (let c = 0; c < n; c++) {
    const runs = columns[c].runs;
    const m = runs.length;
    const cur = new Float64Array(m + B).fill(INF);
    const bk = new Int32Array(m + B).fill(-1);
    const prevRuns = c > 0 ? columns[c - 1].runs : [];
    const pm = prevRuns.length;
    const prevCost = c > 0 ? cost[c - 1] : null;
    for (let i = 0; i < m; i++) {
      const run = runs[i];
      if (forbid && forbid(run)) continue;
      let best = INF;
      let from = -1;
      if (!prevCost) {
        best = 0;
      } else {
        for (let j = 0; j < pm; j++) {
          const v = prevCost[j] + transitionCost(prevRuns[j], run, costs);
          if (v < best) {
            best = v;
            from = j;
          }
        }
        for (let b = 0; b < B; b++) {
          const base = prevCost[pm + b];
          if (base === INF) continue;
          const v = base + costs.reentry + costs.gap * distanceToRun(binCenter(b), run);
          if (v < best) {
            best = v;
            from = pm + b;
          }
        }
      }
      cur[i] = best + unaryCost(run, anchorY, costs);
      bk[i] = from;
    }
    if (!prevCost) {
      cur[m + binOf(anchorY)] = costs.skip;
    } else {
      // Skip with memory: from a run into the bin of its center, from a skip into the same bin.
      for (let j = 0; j < pm; j++) {
        if (prevCost[j] === INF) continue;
        const b = binOf((prevRuns[j].y0 + prevRuns[j].y1) / 2);
        const v = prevCost[j] + costs.skip;
        if (v < cur[m + b]) {
          cur[m + b] = v;
          bk[m + b] = j;
        }
      }
      for (let b = 0; b < B; b++) {
        const v = prevCost[pm + b] + costs.skip;
        if (v < cur[m + b]) {
          cur[m + b] = v;
          bk[m + b] = pm + b;
        }
      }
    }
    cost.push(cur);
    back.push(bk);
  }
  const path = new Int32Array(n).fill(-1);
  let state = -1;
  let bestEnd = INF;
  const last = cost[n - 1];
  for (let i = 0; i < last.length; i++) {
    if (last[i] < bestEnd) {
      bestEnd = last[i];
      state = i;
    }
  }
  for (let c = n - 1; c >= 0 && state >= 0; c--) {
    const m = columns[c].runs.length;
    path[c] = state < m ? state : -1;
    state = back[c][state];
  }
  return path;
}

/**
 * Pair DP for two leads sharing an ink component (contact): the state is a pair (run|skip,
 * run|skip); a shared run is allowed with a small penalty; transitions are minimized over the two
 * coordinates separately (decomposition over the first lead, then the second). Skips have no height memory
 * here (there would be too many states): returning to ink costs `reentry` plus half the gap penalty
 * for the distance from the run to the lead's anchor.
 */
export function tracePair(columns: Column[], anchors: [number, number], costs: DpCosts, forbid?: [Forbid | undefined, Forbid | undefined]): [Path, Path] {
  const n = columns.length;
  const cost: Float64Array[] = [];
  const back: Int32Array[] = [];
  const sizes: number[] = [];
  for (let c = 0; c < n; c++) {
    const runs = columns[c].runs;
    const m = runs.length;
    const S = m + 1;
    sizes.push(S);
    const cur = new Float64Array(S * S).fill(INF);
    const bk = new Int32Array(S * S).fill(-1);
    const unaryA = new Float64Array(S);
    const unaryB = new Float64Array(S);
    for (let i = 0; i < m; i++) {
      unaryA[i] = forbid?.[0]?.(runs[i]) ? INF : unaryCost(runs[i], anchors[0], costs);
      unaryB[i] = forbid?.[1]?.(runs[i]) ? INF : unaryCost(runs[i], anchors[1], costs);
    }
    unaryA[m] = costs.skip;
    unaryB[m] = costs.skip;
    if (c === 0) {
      for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) cur[i * S + j] = unaryA[i] + unaryB[j] + (i === j && i < m ? costs.share : 0);
    } else {
      const prevRuns = columns[c - 1].runs;
      const pm = prevRuns.length;
      const PS = pm + 1;
      const prevCost = cost[c - 1];
      // Transitions along one coordinate: trans[p][i] is the cost of a transition from state p to state i
      // (each lead has its own, because re-entry after a skip depends on the anchor).
      const transFor = (anchorY: number) => {
        const trans = new Float64Array(PS * S);
        for (let p = 0; p < PS; p++) {
          for (let i = 0; i < S; i++) {
            let v: number;
            if (i === m) v = 0;
            else if (p === pm) v = costs.reentry + 0.5 * costs.gap * anchorDistance(runs[i], anchorY);
            else v = transitionCost(prevRuns[p], runs[i], costs);
            trans[p * S + i] = v;
          }
        }
        return trans;
      };
      const transA = transFor(anchors[0]);
      const transB = transFor(anchors[1]);
      // Step 1: over the second coordinate. inner[pa][j] = min_pb prevCost[pa][pb] + transB[pb][j].
      const inner = new Float64Array(PS * S).fill(INF);
      const innerFrom = new Int32Array(PS * S).fill(-1);
      for (let pa = 0; pa < PS; pa++) {
        for (let pb = 0; pb < PS; pb++) {
          const base = prevCost[pa * PS + pb];
          if (base === INF) continue;
          for (let j = 0; j < S; j++) {
            const v = base + transB[pb * S + j];
            if (v < inner[pa * S + j]) {
              inner[pa * S + j] = v;
              innerFrom[pa * S + j] = pb;
            }
          }
        }
      }
      // Step 2: over the first coordinate.
      for (let i = 0; i < S; i++) {
        if (unaryA[i] === INF) continue;
        for (let j = 0; j < S; j++) {
          if (unaryB[j] === INF) continue;
          let best = INF;
          let from = -1;
          for (let pa = 0; pa < PS; pa++) {
            const v = inner[pa * S + j] + transA[pa * S + i];
            if (v < best) {
              best = v;
              from = pa * PS + innerFrom[pa * S + j];
            }
          }
          if (best === INF) continue;
          cur[i * S + j] = best + unaryA[i] + unaryB[j] + (i === j && i < m ? costs.share : 0);
          bk[i * S + j] = from;
        }
      }
    }
    cost.push(cur);
    back.push(bk);
  }
  const pathA = new Int32Array(n).fill(-1);
  const pathB = new Int32Array(n).fill(-1);
  let state = -1;
  let bestEnd = INF;
  const last = cost[n - 1];
  for (let s = 0; s < last.length; s++) {
    if (last[s] < bestEnd) {
      bestEnd = last[s];
      state = s;
    }
  }
  for (let c = n - 1; c >= 0 && state >= 0; c--) {
    const S = sizes[c];
    const m = S - 1;
    const i = Math.floor(state / S);
    const j = state % S;
    pathA[c] = i < m ? i : -1;
    pathB[c] = j < m ? j : -1;
    state = back[c][state];
  }
  return [pathA, pathB];
}
