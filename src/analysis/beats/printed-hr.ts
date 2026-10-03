/**
 * Cross-check of detected beats against the HR digits printed by the device above lead I (step 10 of the sheet
 * self-check, stories 29 and 35).
 *
 * Placement rule (`PRINTED_HR_RULE`) — format data, verified on fixtures `a-01` (17-55-23) and `a-02`:
 * the k-th digit equals round(60000 / RR_k), where RR_k is the interval between the k-th and (k+1)-th beats, and sits
 * above the middle of that interval (offset of the digit center from the middle on the sheets ≤ 2 px). Hence digits
 * are matched to intervals by x, not by count: on `a-02` the first digit sits left of the first visible complex (its
 * interval starts beyond the sheet's left edge), on `a-01` the last one is above the interval to a complex clipped by
 * the right frame. Such digits are `unmatched` (no interval under them), not mismatches.
 *
 * A beat's x is computed the same way `digitize` computes time: x = plot.x + tMs · px/mm X · mm/s / 1000 — hence
 * the sheet calibration is passed explicitly (`calib`, default 50/10); `grid.pxPerSecond` is not used — with manual
 * calibration it diverges from the signal's time axis.
 *
 * x tolerance — `min(xTolerancePx, 0.3 · RR_px)`: a missed beat shifts the middle of the merged interval by
 * a quarter period, and the digit is left without an interval even at high HR.
 *
 * HR tolerance — `max(hrToleranceBpm, rrTolerancePx · ∂HR/∂px)`, where ∂HR/∂px = 60000 · ms/px / RR²: the position
 * of each beat is known to within one plotter column, so RR to within two columns (the sheet's precision ceiling,
 * specification §6). At 150 bpm this is 2 bpm (the ±3 from the specification applies), at 230 — 8, at 360 — 20:
 * the device computes HR from its internal signal, not from the printed curve. A missed or extra beat gives
 * a 50–100 % error and is still visible; an R↔S peak jump (4 columns) too. Deviation above tolerance → `mismatches`.
 * The result's `beats` is a copy of the beats: the ends of a mismatching interval get the reason `printed_hr_mismatch`
 * (confidence × 0.7), beats not confirmed by any digit — `printed_hr_unverified` (× 0.9).
 */
import { DEFAULT_CALIBRATION, type Beat, type Calibration, type PageLayout, type PageMeta, type RhythmCheck } from '../../types/contracts';

/** Format profile constant: how the device places HR digits relative to beats. */
export const PRINTED_HR_RULE = {
  /** The digit sits above the middle of the interval between adjacent beats. */
  placement: 'interval_middle',
  /** Maximum x distance between the digit center and the interval middle, px. */
  xTolerancePx: 12,
  /** Fraction of the interval that bounds the x tolerance for short intervals. */
  xToleranceFraction: 0.3,
  /** HR tolerance, bpm (specification: a deviation > 3 lowers rhythm confidence). */
  hrToleranceBpm: 3,
  /** RR uncertainty in plotter columns (one column for each of the two beats) — the sheet's precision ceiling. */
  rrTolerancePx: 2,
} as const;

const MISMATCH_FACTOR = 0.7;
const UNVERIFIED_FACTOR = 0.9;

export function checkPrintedHr(beats: Beat[], meta: PageMeta, layout: PageLayout, calib: Calibration = DEFAULT_CALIBRATION): RhythmCheck {
  const plotX = layout.zones.plot?.x ?? layout.frame.x;
  const pxPerMs = (layout.grid.pxPerMmX * calib.mmPerS) / 1000;
  const msPerPx = pxPerMs > 0 ? 1 / pxPerMs : 0;
  const ordered = [...beats].sort((a, b) => a.tMs - b.tMs);
  const xs = ordered.map((b) => plotX + b.tMs * pxPerMs);

  const intervals = ordered.slice(0, -1).map((b, i) => {
    const rrMs = ordered[i + 1].tMs - b.tMs;
    const hr = rrMs > 0 ? 60000 / rrMs : Infinity;
    // HR sensitivity to one column on this interval.
    const hrPerPx = rrMs > 0 ? (60000 * msPerPx) / (rrMs * rrMs) : Infinity;
    const toleranceBpm = Math.max(PRINTED_HR_RULE.hrToleranceBpm, PRINTED_HR_RULE.rrTolerancePx * hrPerPx);
    return { i, mid: (xs[i] + xs[i + 1]) / 2, widthPx: xs[i + 1] - xs[i], hr, toleranceBpm };
  });

  let matched = 0;
  const mismatches: RhythmCheck['mismatches'] = [];
  const unmatched: number[] = [];
  const verdict = new Map<number, 'ok' | 'bad'>();
  meta.hrRow.forEach((digit, k) => {
    let best: (typeof intervals)[number] | undefined;
    for (const iv of intervals) if (!best || Math.abs(iv.mid - digit.x) < Math.abs(best.mid - digit.x)) best = iv;
    if (!(pxPerMs > 0) || !best) {
      unmatched.push(k);
      return;
    }
    const tolerance = Math.min(PRINTED_HR_RULE.xTolerancePx, PRINTED_HR_RULE.xToleranceFraction * best.widthPx);
    if (Math.abs(best.mid - digit.x) > tolerance) {
      unmatched.push(k);
      return;
    }
    const measured = Math.round(best.hr * 10) / 10;
    if (Math.abs(measured - digit.value) <= best.toleranceBpm) {
      matched++;
      if (!verdict.has(best.i)) verdict.set(best.i, 'ok');
    } else {
      mismatches.push({ k, printed: digit.value, measured });
      verdict.set(best.i, 'bad');
    }
  });

  const annotated = ordered.map((beat, i) => {
    const around = [verdict.get(i - 1), verdict.get(i)];
    const copy: Beat = { ...beat, perLead: { ...beat.perLead }, reasons: [...beat.reasons] };
    if (around.includes('bad')) {
      copy.reasons.push('printed_hr_mismatch');
      copy.confidence = Math.max(0, Math.min(1, copy.confidence * MISMATCH_FACTOR));
    } else if (meta.hrRow.length > 0 && !around.includes('ok')) {
      copy.reasons.push('printed_hr_unverified');
      copy.confidence = Math.max(0, Math.min(1, copy.confidence * UNVERIFIED_FACTOR));
    }
    return copy;
  });

  return { matched, mismatches, unmatched, beats: annotated };
}
