/**
 * Module `digitize`: trace → signal in physical units. Exposes `digitize(trace, layout, calib) -> LeadSignal`;
 * hides extreme-preserving resampling and the transfer of unreliable spans to samples.
 *
 * The time axis is shared by the sheet's six leads: t = 0 at the left edge of the plot area (`layout.zones.plot`, or
 * the frame without it), samples every 2 ms (500 Hz) up to the area's right edge: x = plot.x + t · (px/mm X · mm/s) / 1000.
 * Samples before the first and after the last trace point hold its end values (there is no data there, but nothing is invented either).
 * U = −(y − baseline) / (px/mm Y · mm/mV). The baseline is `trace.baselineY` (mode of trace y over 1 s windows, task 04);
 * a manual baseline is `digitize({ ...trace, baselineY }, layout, calib)`. Drift is not subtracted: that is a signal filter
 * (SIGNAL-02), not digitization.
 *
 * Resampling: a sample's value is the trace polyline point at the sample's x; a polyline apex between two samples
 * that is more extreme than both is written to the nearest sample, so the peak is not lost; apex time is ±1 ms.
 * An apex on a monotonic slope lies between neighboring samples in value and changes nothing. Two apexes
 * of one column (R and S of a narrow complex in one run) claim the same sample: the later one along the polyline
 * moves to the adjacent sample (±2 ms; a sheet column is 4.6 ms anyway), both are kept.
 *
 * Unreliable trace spans (`trace.unreliable`, columns) become sample intervals (`unreliable`, indices):
 * `gap`: samples along the polyline between the gap edges (interpolation), marked; `ambiguous`: marked only;
 * `clipped`: the polyline segment across the clipping is not a signal: samples are overwritten with the level of the frame
 * border the curve went to (device saturation: amplitude "at least this"), and marked. Not `NaN`: the sum of the six
 * leads and the filters of later steps must stay numeric.
 *
 * No grid (px/mm = 0), calibration or points: an empty signal with confidence 0.
 */
import type { Calibration, LeadSignal, LeadTrace, PageLayout, UnreliableSamples } from '../../types/contracts';

export const SAMPLE_RATE = 500;
const SAMPLE_MS = 1000 / SAMPLE_RATE;

interface Override {
  value: number;
  deviation: number;
  /** Apex position on the sheet: for ordering when two apexes compete for one sample. */
  x: number;
}

export function digitize(trace: LeadTrace, layout: PageLayout, calib: Calibration): LeadSignal {
  const { pxPerMmX, pxPerMmY } = layout.grid;
  const head = { id: trace.id, fs: SAMPLE_RATE as 500, t0: 0 as const, baselineY: trace.baselineY };
  const pts = trace.points;
  if (!(pxPerMmX > 0) || !(pxPerMmY > 0) || !(calib.mmPerS > 0) || !(calib.mmPerMv > 0) || pts.length === 0) {
    return { ...head, mv: new Float32Array(0), confidence: 0, unreliable: [] };
  }

  const pxPerSample = (pxPerMmX * calib.mmPerS * SAMPLE_MS) / 1000;
  const mvPerPx = 1 / (pxPerMmY * calib.mmPerMv);
  const area = layout.zones.plot ?? layout.frame;
  const x0 = area.x;
  const n = Math.floor((area.width - 1) / pxPerSample) + 1;
  const xAt = (i: number): number => x0 + i * pxPerSample;
  const indexAt = (x: number): number => (x - x0) / pxPerSample;
  const toMv = (y: number): number => (trace.baselineY - y) * mvPerPx;

  // 1. Polyline at sample x; beyond the trace ends, the end values.
  const mv = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const x = xAt(i);
    while (k + 1 < pts.length && pts[k + 1].x <= x) k++;
    let y: number;
    if (x <= pts[0].x) y = pts[0].y;
    else if (k + 1 >= pts.length) y = pts[k].y;
    else {
      const a = pts[k];
      const b = pts[k + 1];
      y = b.x > a.x ? a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) : b.y;
    }
    mv[i] = toMv(y);
  }

  // 2. Polyline extremes between samples → nearest sample. Decisions are made on the interpolated
  //    values and applied at once. Two apexes competing for one sample: the later one along the polyline moves
  //    to the adjacent free sample on its side; if none is free, the more extreme deviation stays.
  const overrides = new Map<number, Override>();
  const propose = (j: number, value: number, x: number): void => {
    if (j < 0 || j >= n) return;
    const current = overrides.get(j);
    if (current && current.value !== value) {
      const alt = j + (x >= current.x ? 1 : -1);
      if (alt >= 0 && alt < n && !overrides.has(alt)) {
        overrides.set(alt, { value, deviation: Math.abs(value - mv[alt]), x });
        return;
      }
    }
    const deviation = Math.abs(value - mv[j]);
    if (!current || deviation > current.deviation) overrides.set(j, { value, deviation, x });
  };
  let p = 0;
  while (p < pts.length) {
    const i = Math.floor(indexAt(pts[p].x));
    let q = p;
    let hi = -Infinity;
    let hiAt = p;
    let lo = Infinity;
    let loAt = p;
    while (q < pts.length && Math.floor(indexAt(pts[q].x)) === i) {
      const v = toMv(pts[q].y);
      if (v > hi) {
        hi = v;
        hiAt = q;
      }
      if (v < lo) {
        lo = v;
        loAt = q;
      }
      q++;
    }
    if (i >= 0 && i + 1 < n) {
      const a = mv[i];
      const b = mv[i + 1];
      // In polyline order: the earlier apex takes the nearest sample first.
      const claims: [number, number][] = [];
      if (hi > Math.max(a, b)) claims.push([hiAt, hi]);
      if (lo < Math.min(a, b)) claims.push([loAt, lo]);
      claims.sort((c, d) => c[0] - d[0]);
      for (const [at, value] of claims) propose(Math.round(indexAt(pts[at].x)), value, pts[at].x);
    }
    p = q;
  }
  for (const [j, o] of overrides) mv[j] = o.value;

  // 3. Unreliable spans: column x occupies [x − 0.5, x + 0.5]; clipping is saturation at the level of the frame border
  //    on the side where the points at the span edges went.
  const unreliable: UnreliableSamples[] = [];
  const frameTop = layout.frame.y;
  const frameBottom = layout.frame.y + layout.frame.height - 1;
  for (const span of trace.unreliable) {
    const i0 = Math.max(0, Math.ceil(indexAt(span.x0 - 0.5)));
    const i1 = Math.min(n - 1, Math.floor(indexAt(span.x1 + 0.5)));
    if (i0 > i1) continue;
    if (span.kind === 'clipped') {
      const edgeYs = pts
        .filter((pt) => (pt.x >= span.x0 - 2 && pt.x < span.x0) || (pt.x > span.x1 && pt.x <= span.x1 + 2))
        .map((pt) => pt.y);
      if (edgeYs.length > 0) {
        // The border that the points at the span edges come closest to (0–3 px for clipping).
        const toBottom = Math.min(...edgeYs.map((y) => Math.abs(y - frameBottom)));
        const toTop = Math.min(...edgeYs.map((y) => Math.abs(y - frameTop)));
        mv.fill(toMv(toBottom <= toTop ? frameBottom : frameTop), i0, i1 + 1);
      }
    }
    unreliable.push({ i0, i1, kind: span.kind });
  }
  unreliable.sort((a, b) => a.i0 - b.i0);

  return { ...head, mv, confidence: trace.confidence, unreliable };
}
