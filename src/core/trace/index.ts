/**
 * Module `trace`: lead traces. Exposes `traceLeads(ink, layout, profile, hints?) -> LeadTrace[]`
 * (always exactly 6 traces in `LEAD_IDS` order); hides the run graph, DP over runs, and contact resolution.
 *
 * A lead's anchor is the layout's expected baseline (`expectedBaselines`), confirmed by the label glyph group
 * on the left; the actual baseline (`baselineY`) is the mode of y of the trace itself. Leads whose seed runs
 * lie in the same run-graph component (contact) are traced by a pair DP, the rest by a single DP.
 * Runs not chosen by any path are assigned to leads by adjacency (explained ink); the remaining ones are
 * unexplained ink of the lead nearest in y.
 *
 * Definitions for consumers: plotter columns run from the first to the last column with ink of wide
 * components (≥ 50 % of the frame width); `coverage` is the fraction of plotter columns with a primary trace run;
 * `explainedInk` is the fraction of ink assigned to the trace among ink attributed to the lead (assigned +
 * unexplained nearest in y). A skip > 3 columns is a `gap` span (the polyline joins the edges directly);
 * at the frame border it is `clipped` (no points inside: the value is unknown); a long run shared with another
 * lead is `ambiguous`.
 */
import {
  LEAD_IDS,
  type FormatProfile,
  type InkMask,
  type LeadTrace,
  type PageLayout,
  type Point,
  type TraceHint,
  type UnreliableSpan,
} from '../../types/contracts';
import { DEFAULT_COSTS, traceSingle, tracePair, type DpCosts, type Forbid, type Path } from './dp';
import { boundaryY, buildPoints, PEAK_MIN, type PathRun, type PeakClaim } from './points';
import { buildRunGraph, gapBetween, type Column, type Run, type RunGraph } from './runs';

/** A gap longer than this (columns) is marked as an unreliable span. */
const GAP_MARK = 3;
/** A shared run at least this tall: the lead's position inside it is undetermined. */
const AMBIGUOUS_RUN_HEIGHT = 6;
/** Seed run search: the first columns and the y tolerance from the anchor. */
const SEED_COLUMNS = 40;
const SEED_TOLERANCE = 25;
/** A label confirms the anchor if its glyph group is no farther than this from the anchor, px. */
const LABEL_TOLERANCE = 8;

const codes = {
  coverage: 'coverage',
  unexplained: 'unexplained_ink',
  gap: 'gap',
  ambiguous: 'ambiguous',
  clipped: 'clipped',
  anchorWeak: 'anchor_weak',
};

interface LeadState {
  k: number;
  anchorY: number;
  anchorWeak: boolean;
  path: Path;
}

function emptyTrace(k: number, baselineY: number, reasons: string[]): LeadTrace {
  return { id: LEAD_IDS[k], points: [], baselineY, coverage: 0, explainedInk: 0, unreliable: [], confidence: 0, reasons };
}

/** Label glyph groups by y: cluster centers (a gap > 6 px starts a new cluster). */
function labelGroups(ink: InkMask, layout: PageLayout): number[] {
  const zone = layout.zones.leadLabels;
  if (!zone) return [];
  const centers = ink.textComponents
    .filter((c) => c.bbox.x >= zone.x - 2 && c.bbox.x + c.bbox.width <= zone.x + zone.width + 2)
    .map((c) => c.bbox.y + (c.bbox.height - 1) / 2)
    .sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const y of centers) {
    const last = groups[groups.length - 1];
    if (last && y - last[last.length - 1] <= 6) last.push(y);
    else groups.push([y]);
  }
  return groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
}

/** A lead's seed run: the first run in the first columns within tolerance of the anchor. */
function seedRun(graph: RunGraph, anchorY: number): Run | null {
  const limit = Math.min(graph.columns.length, SEED_COLUMNS);
  for (let c = 0; c < limit; c++) {
    let best: Run | null = null;
    let bestD = SEED_TOLERANCE + 1;
    for (const run of graph.columns[c].runs) {
      const d = anchorY < run.y0 ? run.y0 - anchorY : anchorY > run.y1 ? anchorY - run.y1 : 0;
      if (d < bestD) {
        bestD = d;
        best = run;
      }
    }
    if (best) return best;
  }
  return null;
}

function forbidFor(hints: TraceHint[], id: string): Forbid | undefined {
  const own = hints.filter((h) => h.above === id || h.below === id);
  if (own.length === 0) return undefined;
  return (run) =>
    own.some((h) => run.x >= h.x0 && run.x <= h.x1 && (h.above === id ? run.y0 > h.y : run.y1 < h.y));
}

type RunFor = (k: number, c: number) => Run | null;
type IsShared = (a: number, b: number, c: number) => boolean;

/**
 * A shared run with an internal bridged gap is split between two leads at that gap: a white row
 * between the tips of two curves is evidence that they have not merged. It is split if the gap lies
 * between the leads' entry points into the run (the upper one enters higher, the lower one lower) from their own
 * runs in the adjacent column; the split propagates along the shared stretch as long as there are gaps.
 */
function splitSharedRuns(leads: LeadState[], columns: Column[]): Map<string, Run> {
  const splits = new Map<string, Run>();
  const n = columns.length;
  const key = (k: number, c: number) => `${k}:${c}`;
  const primary = (k: number, c: number): Run | null => (c >= 0 && c < n && leads[k].path[c] >= 0 ? columns[c].runs[leads[k].path[c]] : null);
  const own = (k: number, c: number): Run | null => splits.get(key(k, c)) ?? primary(k, c);
  const shared = (a: number, b: number, c: number) =>
    c >= 0 && c < n && leads[a].path[c] >= 0 && leads[a].path[c] === leads[b].path[c] && !splits.has(key(a, c));
  let changed = true;
  while (changed) {
    changed = false;
    for (let a = 0; a < leads.length; a++) {
      for (let b = a + 1; b < leads.length; b++) {
        const [upper, lower] = leads[a].anchorY <= leads[b].anchorY ? [a, b] : [b, a];
        for (let c = 0; c < n; c++) {
          if (!shared(a, b, c)) continue;
          const run = primary(a, c)!;
          if (run.breaks.length === 0) continue;
          let side = 0;
          if (c > 0 && !shared(a, b, c - 1) && own(upper, c - 1) && own(lower, c - 1)) side = -1;
          else if (c + 1 < n && !shared(a, b, c + 1) && own(upper, c + 1) && own(lower, c + 1)) side = 1;
          if (side === 0) continue;
          const u = own(upper, c + side)!;
          const l = own(lower, c + side)!;
          const yu = boundaryY(u, run);
          const yl = boundaryY(l, run);
          if (!(yu < yl)) continue;
          const mid = (yu + yl) / 2;
          let brk: [number, number] | null = null;
          for (const g of run.breaks) {
            if (!(yu < g[0] && g[1] < yl)) continue;
            if (!brk || Math.abs((g[0] + g[1]) / 2 - mid) < Math.abs((brk[0] + brk[1]) / 2 - mid)) brk = g;
          }
          if (!brk) continue;
          const [g0, g1] = brk;
          const len = run.y1 - run.y0 + 1;
          splits.set(key(upper, c), { ...run, y1: g0 - 1, pixels: Math.round((run.pixels * (g0 - run.y0)) / len), breaks: run.breaks.filter((g) => g[0] < g0) });
          splits.set(key(lower, c), { ...run, y0: g1 + 1, pixels: Math.round((run.pixels * (run.y1 - g1)) / len), breaks: run.breaks.filter((g) => g[0] > g1) });
          changed = true;
        }
      }
    }
  }
  return splits;
}

/**
 * Shared stretches of two paths (consecutive columns with the same primary run) and rights to their
 * extremes. A stretch extreme (top/bottom) belongs to nobody if it is continued by an own run of either
 * lead before or after the stretch (it is a stroke, not a turn); otherwise it goes to the lead for
 * which it lies farther from that lead's entry into and exit from the stretch (a stroke with a turn: an S wave of III
 * that ran into the aVR baseline, not a 15-px "dip" of a flat aVR). Other extremes of shared runs are not declared.
 */
function sharedClaims(leads: LeadState[], columns: Column[], runFor: RunFor, isShared: IsShared): Map<number, PeakClaim>[] {
  const n = columns.length;
  const claims = leads.map(() => new Map<number, PeakClaim>());
  const deny = (k: number, x: number) => {
    if (!claims[k].has(x)) claims[k].set(x, { top: false, bottom: false });
  };
  const runAt = runFor;
  for (let a = 0; a < leads.length; a++) {
    for (let b = a + 1; b < leads.length; b++) {
      let c = 0;
      while (c < n) {
        if (!isShared(a, b, c)) {
          c++;
          continue;
        }
        const c0 = c;
        while (c + 1 < n && isShared(a, b, c + 1)) c++;
        const c1 = c;
        c = c1 + 1;
        let top = Infinity;
        let topX = 0;
        let bottom = -Infinity;
        let bottomX = 0;
        for (let i = c0; i <= c1; i++) {
          const run = runAt(a, i)!;
          deny(a, run.x);
          deny(b, run.x);
          if (run.y0 < top) {
            top = run.y0;
            topX = run.x;
          }
          if (run.y1 > bottom) {
            bottom = run.y1;
            bottomX = run.x;
          }
        }
        const first = runAt(a, c0)!;
        const last = runAt(a, c1)!;
        const sides = [a, b].map((k) => {
          const before = runAt(k, c0 - 1);
          const after = runAt(k, c1 + 1);
          const entry = before ? boundaryY(before, first) : null;
          const exit = after ? boundaryY(last, after) : null;
          return {
            k,
            entry,
            exit,
            reachTop: Math.min(before?.y0 ?? Infinity, after?.y0 ?? Infinity),
            reachBottom: Math.max(before?.y1 ?? -Infinity, after?.y1 ?? -Infinity),
          };
        });
        const grant = (extreme: number, x: number, which: 'top' | 'bottom') => {
          const sign = which === 'top' ? 1 : -1;
          // Nobody's if some own run reaches the extreme.
          if (sides.some((s) => sign * (which === 'top' ? s.reachTop : s.reachBottom) - sign * extreme < PEAK_MIN)) return;
          let best = -Infinity;
          let who = -1;
          for (const s of sides) {
            const margins = [s.entry, s.exit].filter((v): v is number => v !== null).map((v) => sign * (v - extreme));
            if (margins.length === 0) continue;
            const margin = Math.min(...margins);
            if (margin > best) {
              best = margin;
              who = s.k;
            }
          }
          if (who >= 0 && best >= PEAK_MIN) claims[who].get(x)![which] = true;
        };
        grant(top, topX, 'top');
        grant(bottom, bottomX, 'bottom');
      }
    }
  }
  return claims;
}

/** Spans of consecutive columns from the set `flags` (true) as [x0, x1]. */
function spansOf(flags: Uint8Array, xStart: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let c = 0; c <= flags.length; c++) {
    const on = c < flags.length && flags[c] !== 0;
    if (on && start < 0) start = c;
    if (!on && start >= 0) {
      out.push([xStart + start, xStart + c - 1]);
      start = -1;
    }
  }
  return out;
}

/** Mode of y over integer bins without smoothing (smoothing drifts toward T-wave tails), refined by the mean within ±1 px. */
function modeOf(ys: number[]): number {
  const min = Math.floor(Math.min(...ys));
  const max = Math.ceil(Math.max(...ys));
  const hist = new Float64Array(max - min + 1);
  for (const y of ys) hist[Math.round(y) - min]++;
  let best = 0;
  for (let i = 1; i < hist.length; i++) if (hist[i] > hist[best]) best = i;
  const mode = best + min;
  let sum = 0;
  let n = 0;
  for (const y of ys) {
    if (Math.abs(y - mode) <= 1) {
      sum += y;
      n++;
    }
  }
  return n > 0 ? sum / n : mode;
}

/**
 * Baseline: mode of y of points on flat stretches (points with integer x are centers of mass; edges and apexes
 * of steep runs do not count toward the baseline) in sliding 1 s windows (step: half a window); the result is the
 * median of the window modes: with drift this is the mid-sheet level, without drift the overall mode.
 */
function baselineOf(points: Point[], fallback: number, windowPx: number): number {
  if (points.length === 0) return fallback;
  const flat = points.filter((p) => Number.isInteger(p.x));
  const source = flat.length >= 10 ? flat : points;
  const x0 = source[0].x;
  const x1 = source[source.length - 1].x;
  const modes: number[] = [];
  for (let start = x0; start < x1; start += windowPx / 2) {
    const ys = source.filter((p) => p.x >= start && p.x < start + windowPx).map((p) => p.y);
    if (ys.length >= 10) modes.push(modeOf(ys));
  }
  if (modes.length === 0) return modeOf(source.map((p) => p.y));
  modes.sort((a, b) => a - b);
  const mid = modes.length >> 1;
  return modes.length % 2 ? modes[mid] : (modes[mid - 1] + modes[mid]) / 2;
}

function trace(ink: InkMask, layout: PageLayout, profile: FormatProfile, hints: TraceHint[]): LeadTrace[] {
  const frame = layout.frame;
  const plotX0 = layout.zones.plot?.x ?? frame.x;
  const plotX1 = frame.x + frame.width - 1;
  const y0 = frame.y;
  const y1 = frame.y + frame.height - 1;
  const graph = buildRunGraph(ink, plotX0, plotX1, y0, y1);
  const columns = graph.columns;
  const n = columns.length;
  const variant = profile.variants[layout.variant];
  const leadStep = layout.grid.pxPerMmY > 0 ? variant.leadStepMm * layout.grid.pxPerMmY : variant.leadStepPx;
  const costs: DpCosts = { ...DEFAULT_COSTS, leadStep };

  // Plotter columns: from the wide ink components.
  const wide = ink.components.filter((c) => c.bbox.width >= 0.5 * frame.width);
  const pool = wide.length ? wide : ink.components;
  let xs = plotX0;
  let xe = plotX1;
  if (pool.length) {
    xs = Math.max(plotX0, Math.min(...pool.map((c) => c.bbox.x)));
    xe = Math.min(plotX1, Math.max(...pool.map((c) => c.bbox.x + c.bbox.width - 1)));
  }
  const plotColumns = Math.max(1, xe - xs + 1);

  // Anchors: expected baselines confirmed by a label on the left or by a seed run right at the anchor.
  const labels = labelGroups(ink, layout);
  const leads: LeadState[] = LEAD_IDS.map((_, k) => {
    const anchorY = layout.expectedBaselines[k];
    const confirmed = labels.some((y) => Math.abs(y - anchorY) <= LABEL_TOLERANCE);
    return { k, anchorY, anchorWeak: !confirmed, path: new Int32Array(n).fill(-1) };
  });

  // Grouping by the seed run's component.
  const seeds = leads.map((lead) => seedRun(graph, lead.anchorY));
  const groups = new Map<number, number[]>();
  const singles: number[] = [];
  leads.forEach((_, k) => {
    const seed = seeds[k];
    if (!seed) {
      singles.push(k);
      return;
    }
    const comp = graph.component[seed.index];
    const g = groups.get(comp);
    if (g) g.push(k);
    else groups.set(comp, [k]);
  });
  for (const members of groups.values()) {
    if (members.length === 1) singles.push(members[0]);
    else if (members.length === 2) {
      const [a, b] = members;
      const [pa, pb] = tracePair(columns, [leads[a].anchorY, leads[b].anchorY], costs, [
        forbidFor(hints, LEAD_IDS[a]),
        forbidFor(hints, LEAD_IDS[b]),
      ]);
      leads[a].path = pa;
      leads[b].path = pb;
    } else {
      // Three or more leads in one component is rare (does not occur in fixtures): single DPs.
      for (const k of members) leads[k].path = traceSingle(columns, leads[k].anchorY, costs, forbidFor(hints, LEAD_IDS[k]), [y0, y1]);
    }
  }
  for (const k of singles) leads[k].path = traceSingle(columns, leads[k].anchorY, costs, forbidFor(hints, LEAD_IDS[k]), [y0, y1]);

  // Run owners: primary ones, then those assigned by adjacency (multi-source graph traversal).
  const owner = new Int8Array(graph.runs.length).fill(-1);
  const queue: number[] = [];
  for (const lead of leads) {
    lead.path.forEach((slot, c) => {
      if (slot < 0) return;
      const run = columns[c].runs[slot];
      if (owner[run.index] < 0) {
        owner[run.index] = lead.k;
        queue.push(run.index);
      }
    });
  }
  for (let head = 0; head < queue.length; head++) {
    const run = graph.runs[queue[head]];
    const k = owner[run.index];
    for (const dc of [-1, 1]) {
      const c = run.x - plotX0 + dc;
      if (c < 0 || c >= n) continue;
      for (const other of columns[c].runs) {
        if (owner[other.index] >= 0 || gapBetween(run, other) !== 0) continue;
        owner[other.index] = k;
        queue.push(other.index);
      }
    }
  }
  const explained = new Float64Array(6);
  const unexplained = new Float64Array(6);
  for (const run of graph.runs) {
    if (run.x < xs || run.x > xe) continue;
    if (owner[run.index] >= 0) {
      explained[owner[run.index]] += run.pixels;
    } else {
      const center = (run.y0 + run.y1) / 2;
      let nearest = 0;
      for (let k = 1; k < 6; k++) if (Math.abs(leads[k].anchorY - center) < Math.abs(leads[nearest].anchorY - center)) nearest = k;
      unexplained[nearest] += run.pixels;
    }
  }

  // Shared runs of two paths (contact): split at an internal gap, rights to extremes of shared stretches.
  const splits = splitSharedRuns(leads, columns);
  const runFor: RunFor = (k, c) =>
    c >= 0 && c < n && leads[k].path[c] >= 0 ? (splits.get(`${k}:${c}`) ?? columns[c].runs[leads[k].path[c]]) : null;
  const isShared: IsShared = (a, b, c) =>
    c >= 0 && c < n && leads[a].path[c] >= 0 && leads[a].path[c] === leads[b].path[c] && !splits.has(`${a}:${c}`);
  const claims = sharedClaims(leads, columns, runFor, isShared);

  return leads.map((lead) => {
    const seq: PathRun[] = [];
    const covered = new Uint8Array(plotColumns);
    const ambiguous = new Uint8Array(plotColumns);
    for (let c = 0; c < n; c++) {
      const run = runFor(lead.k, c);
      if (!run) continue;
      seq.push({ x: run.x, run });
      if (run.x >= xs && run.x <= xe) {
        covered[run.x - xs] = 1;
        const sharedHere = leads.some((other) => other.k !== lead.k && isShared(lead.k, other.k, c));
        if (sharedHere && run.y1 - run.y0 + 1 >= AMBIGUOUS_RUN_HEIGHT) ambiguous[run.x - xs] = 1;
      }
    }
    const points = buildPoints(ink, seq, claims[lead.k]);
    const unreliable: UnreliableSpan[] = [];
    // Gaps inside plotter columns: at the frame border it is clipping by the device (any length), otherwise a gap
    // longer than GAP_MARK; short gaps are silently interpolated by the polyline.
    const missing = new Uint8Array(plotColumns);
    for (let i = 0; i < plotColumns; i++) missing[i] = covered[i] ? 0 : 1;
    for (const [a, b] of spansOf(missing, xs)) {
      const before = a - 1 >= xs ? lead.path[a - 1 - plotX0] : -1;
      const after = b + 1 <= xe ? lead.path[b + 1 - plotX0] : -1;
      const touches = (c: number, slot: number) => {
        if (slot < 0) return false;
        const run = columns[c].runs[slot];
        return run.y1 >= y1 || run.y0 <= y0;
      };
      const clipped = touches(a - 1 - plotX0, before) || touches(b + 1 - plotX0, after);
      if (!clipped && b - a + 1 <= GAP_MARK) continue;
      unreliable.push({ x0: a, x1: b, kind: clipped ? 'clipped' : 'gap' });
    }
    for (const [a, b] of spansOf(ambiguous, xs)) unreliable.push({ x0: a, x1: b, kind: 'ambiguous' });
    unreliable.sort((p, q) => p.x0 - q.x0);

    let coveredCount = 0;
    for (let i = 0; i < plotColumns; i++) coveredCount += covered[i];
    const coverage = coveredCount / plotColumns;
    const inkTotal = explained[lead.k] + unexplained[lead.k];
    const explainedInk = inkTotal > 0 ? explained[lead.k] / inkTotal : 1;

    const reasons: string[] = [];
    let confidence = 1;
    if (coverage < 0.98) {
      reasons.push(codes.coverage);
      confidence *= Math.max(0, coverage);
    }
    if (explainedInk < 0.97) {
      reasons.push(codes.unexplained);
      confidence *= explainedInk;
    }
    // Unreliable spans lower confidence by their column fraction (three times the fraction is subtracted from
    // confidence, not below one half), not by the number of spans: fifteen two-column contacts are not
    // fifteen problems.
    const fractionOf = (kind: UnreliableSpan['kind']) =>
      unreliable.filter((u) => u.kind === kind).reduce((s, u) => s + (u.x1 - u.x0 + 1), 0) / plotColumns;
    for (const [kind, code] of [['gap', codes.gap], ['clipped', codes.clipped], ['ambiguous', codes.ambiguous]] as const) {
      const f = fractionOf(kind);
      if (f > 0) {
        reasons.push(code);
        confidence *= Math.max(0.5, 1 - 3 * f);
      }
    }
    // The anchor is weak if neither a label on the left nor the trace's own baseline confirmed it (within tolerance).
    const baselineY = baselineOf(points, lead.anchorY, layout.grid.pxPerSecond ?? variant.pxPerSecond);
    if (lead.anchorWeak && Math.abs(baselineY - lead.anchorY) > LABEL_TOLERANCE) {
      reasons.push(codes.anchorWeak);
      confidence *= 0.8;
    }
    if (points.length === 0) confidence = 0;
    return {
      id: LEAD_IDS[lead.k],
      points,
      baselineY,
      coverage,
      explainedInk,
      unreliable,
      confidence: Math.max(0, Math.min(1, confidence)),
      reasons,
    };
  });
}

export function traceLeads(ink: InkMask, layout: PageLayout, profile: FormatProfile, hints?: TraceHint[]): LeadTrace[] {
  try {
    return trace(ink, layout, profile, hints ?? []);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return LEAD_IDS.map((_, k) => emptyTrace(k, layout.expectedBaselines[k], [`exception:${message}`]));
  }
}
