/**
 * Beats of one sheet for merging into a case — the chain tasks 06–07 were calibrated against
 * (`test/analysis-fixtures.test.ts`): `detectBeats` on raw signals → cross-check against the printed HR row
 * (`checkPrintedHr` always with `page.calib`: the 50/10 default inside the function gives a silent x mismatch with
 * manual calibration) → `filterSignal(II)` only for delineation → `delineate` with the sheet precision ceiling and neighbors.
 * Empty or missing II — `no_signal` delineation for every beat (lengths of `beats` and `delineations` always match).
 */
import type { LeadSignal, PageBeats, PageResult, Species } from '../../types/contracts';
import { checkPrintedHr, delineate, detectBeats } from '../beats';
import { filterSignal } from '../filter';

function emptyLeadII(page: PageResult): LeadSignal {
  const baseline = page.leads.find((l) => l.id === 'II')?.baselineY ?? 0;
  return { id: 'II', fs: 500, t0: 0, mv: new Float32Array(0), baselineY: baseline, confidence: 0, unreliable: [] };
}

/** Beats, cross-check against the device HR and complex delineation of sheet `pageNo` with offset `offsetMs` on the case time scale. */
export function pageBeats(page: PageResult, pageNo: number, offsetMs: number, species: Species): PageBeats {
  const detected = detectBeats(page.signals, species);
  const beats = checkPrintedHr(detected, page.meta, page.layout, page.calib).beats ?? detected;
  const rawII = page.signals.find((s) => s.id === 'II');
  const ii = rawII && rawII.mv.length > 0 ? filterSignal(rawII, species) : emptyLeadII(page);
  const delineations = beats.map((beat, k) =>
    delineate(beat, ii, species, { precision: page.precision, prevTMs: beats[k - 1]?.tMs, nextTMs: beats[k + 1]?.tMs }),
  );
  return { page: pageNo, offsetMs, beats, delineations, signals: page.signals, precision: page.precision };
}
