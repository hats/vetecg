/**
 * Beat detector (SIGNAL-03): Pan-Tompkins adapted for veterinary heart rates, over the normalized sum of reliable
 * leads, with refinement of the R position in II.
 *
 * Input — sheet signals as returned by `analyzePage` (without `filterSignal`): the detector has its own band-pass
 * filter, while the 40 Hz low-pass of the common filter shifts the peak of a narrow QRS by a column. Filtered signals
 * are accepted too: on 10 fixtures the printed-HR cross-check chain converges with both inputs, beat positions differ
 * by ≤ 6 ms (1–1.3 columns); raw input is preferred for precision (peak by pixels, not by a smoothed curve).
 *
 * Pipeline for each reliable lead (confidence ≥ `UNRELIABLE_BELOW`, non-empty signal): band-pass filter of the
 * species profile (zero phase) → five-point derivative → square → centered moving average with the profile window
 * (the window is centered, so the feature peak sits on the QRS instead of lagging behind it). The lead feature
 * is divided by its own mean over reliable samples so that low-amplitude leads (cats) weigh as much as large ones;
 * within `clipped`/`gap` spans (with a half-window margin) the lead's contribution is zero — beats are not searched
 * there and amplitudes are not taken. The sum of contributions is the input of the adaptive thresholds.
 *
 * Thresholds are classic: signal and noise levels SPKI/NPKI, threshold T1 = NPKI + 0.25·(SPKI − NPKI), search-back
 * with T2 = 0.5·T1 when a pause is longer than 1.66 mean RR (over the last eight), refractory period from the species
 * profile (dog 150 ms, cat 100 ms): within it the larger peak wins. Two passes: the first learns on the sheet, the
 * second starts from the learned levels — a 5-second strip has no time to warm up from scratch.
 *
 * A beat whose complex runs into the edge of the plot area (the feature lobe at 0.5 of the peak touches the first or
 * last sample) is not counted — on the device it is also clipped by the frame (SIGNAL-03).
 *
 * `perLead[id].tMs` — peak of the lead's dominant wave within the QRS region of its feature (majority polarity of
 * the lead, see `fiducial`); `perLead.II.tMs` — the R (or S) peak in II. The beat's `tMs` is the median of peaks over
 * reliable leads: a cross-check with positions recovered from the printed HR digits gives a spread ≤ 1.3 px on all
 * fixtures, whereas II alone gives up to 2 px and a systematic −2 px in cats. II unreliable at this point — reason
 * `lead_ii_unreliable`. `perLead[id].confidence` — agreement of the lead's QRS energy center with the merged peak
 * (1 within ±`LEAD_AGREEMENT_MS`, then decreasing).
 *
 * Beat confidence (specification §6) and reasons (snake_case): share of agreeing leads (`lead_disagreement` if
 * less than half), peak strength relative to the signal level (`weak_peak` — peak below 0.5·SPKI, usually found by
 * search-back), correlation of the QRS in II with the sheet's median morphology (`morphology_outlier` at ρ < 0.7),
 * interval to a neighbor outside 30…320 bpm (`hr_implausible`; the beat stays — SIGNAL-03.1). Agreement with the
 * printed HR is added by `checkPrintedHr`.
 */
import { UNRELIABLE_BELOW, type Beat, type BeatLeadInfo, type LeadId, type LeadSignal, type Species } from '../../types/contracts';
import { designHighpass, designLowpass, filtfilt } from '../filter';
import { beatProfileFor, LEAD_AGREEMENT_MS, type BeatSpeciesProfile } from './species';

/** Pan-Tompkins threshold coefficients. */
const THRESHOLD_FRACTION = 0.25;
const SEARCHBACK_THRESHOLD_FRACTION = 0.5;
const SEARCHBACK_RR_FACTOR = 1.66;
const SIGNAL_LEARN = 0.125;
const SEARCHBACK_LEARN = 0.25;
const RR_HISTORY = 8;
/** Feature lobe level at which edge contact is decided. */
const EDGE_LOBE_LEVEL = 0.5;
const EDGE_MARGIN_SAMPLES = 2;
/** Candidates below this fraction of the feature maximum are not considered (saves work and guards against zero noise). */
const CANDIDATE_FLOOR = 0.02;
/** Quantile of the lead feature taken as the QRS peak level for normalization. */
const NORMALIZATION_QUANTILE = 0.99;
/** Within the refractory period: a peak this many times larger than the last beat replaces it unconditionally… */
const REFRACTORY_REPLACE_RATIO = 1.25;
/** …and with a smaller difference the one closer to the position expected from the typical RR wins. */
const REFRACTORY_TIE_RATIO = 0.8;
/** Prematurity gate: fraction of the typical RR, minimum RR history and minimum fraction of the signal level. */
const PREMATURE_RR_FRACTION = 0.9;
const PREMATURE_MIN_HISTORY = 3;
const PREMATURE_MIN_SIGNAL_FRACTION = 0.5;
/** Lead feature level (fraction of its maximum in the window) bounding the QRS region for the peak search. */
const QRS_REGION_LEVEL = 0.3;
/** A wave of the polarity opposite to the majority is taken as the peak only if it is this many times larger. */
const POLARITY_OVERRIDE_RATIO = 2;
/** Confidence: thresholds and factors. */
const WEAK_PEAK_FRACTION = 0.5;
const WEAK_PEAK_FACTOR = 0.8;
const MORPHOLOGY_MIN_CORRELATION = 0.7;
const MORPHOLOGY_FACTOR = 0.8;
const IMPLAUSIBLE_HR_FACTOR = 0.8;
const MIN_BEATS_FOR_TEMPLATE = 3;

interface LeadFeature {
  signal: LeadSignal;
  feature: Float32Array;
  valid: Uint8Array;
}

interface RawBeat {
  idx: number;
  amp: number;
  searchback: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Mask of reliable samples: zeros within clipped/gap expanded by `pad` samples. */
function validMask(signal: LeadSignal, pad: number): Uint8Array {
  const n = signal.mv.length;
  const mask = new Uint8Array(n).fill(1);
  for (const span of signal.unreliable) {
    if (span.kind === 'ambiguous') continue;
    const i0 = Math.max(0, span.i0 - pad);
    const i1 = Math.min(n - 1, span.i1 + pad);
    for (let i = i0; i <= i1; i++) mask[i] = 0;
  }
  return mask;
}

/** Centered moving average with a window of `w` samples (zeros beyond the edges). */
function movingAverage(x: Float32Array, w: number): Float32Array {
  const n = x.length;
  const half = Math.floor(w / 2);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = (prefix[b] - prefix[a]) / w;
  }
  return out;
}

/** Pan-Tompkins feature of one lead: band-pass → derivative → square → integration. */
export function panTompkinsFeature(mv: Float32Array, fs: number, profile: BeatSpeciesProfile): Float32Array {
  const n = mv.length;
  const [lo, hi] = profile.bandpassHz;
  let band = filtfilt(mv, designHighpass(lo, fs));
  band = filtfilt(band, designLowpass(hi, fs));
  const sq = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m2 = band[Math.max(0, i - 2)];
    const m1 = band[Math.max(0, i - 1)];
    const p1 = band[Math.min(n - 1, i + 1)];
    const p2 = band[Math.min(n - 1, i + 2)];
    const d = (-m2 - 2 * m1 + 2 * p1 + p2) / 8;
    sq[i] = d * d;
  }
  const w = Math.max(3, Math.round((profile.integrationMs * fs) / 1000) | 1);
  return movingAverage(sq, w);
}

/**
 * Lead feature normalized to its own 99th percentile over reliable samples (the QRS peak level: even with seven
 * beats on a sheet this is ≈ 4 samples per beat); zero on unreliable ones. Normalizing to the mean inflated glitches
 * of flat leads to the level of real complexes.
 */
function leadFeature(signal: LeadSignal, profile: BeatSpeciesProfile): LeadFeature | undefined {
  const n = signal.mv.length;
  if (n < 8) return undefined;
  const fs = signal.fs;
  const pad = Math.ceil((profile.integrationMs * fs) / 2000);
  const valid = validMask(signal, pad);
  const raw = panTompkinsFeature(signal.mv, fs, profile);
  const values: number[] = [];
  for (let i = 0; i < n; i++) if (valid[i]) values.push(raw[i]);
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  const scale = values[Math.min(values.length - 1, Math.floor(values.length * NORMALIZATION_QUANTILE))];
  if (!(scale > 0)) return undefined;
  const feature = new Float32Array(n);
  for (let i = 0; i < n; i++) feature[i] = valid[i] ? raw[i] / scale : 0;
  return { signal, feature, valid };
}

/** Local maxima of the feature above the floor. */
function candidates(f: Float32Array): number[] {
  const n = f.length;
  let max = 0;
  for (let i = 0; i < n; i++) if (f[i] > max) max = f[i];
  const floor = max * CANDIDATE_FLOOR;
  const out: number[] = [];
  for (let i = 1; i < n - 1; i++) if (f[i] > floor && f[i] > f[i - 1] && f[i] >= f[i + 1]) out.push(i);
  return out;
}

interface DetectState {
  spki: number;
  npki: number;
}

/** One pass of adaptive thresholds over the candidates; returns accepted beats and final levels. */
function adaptivePass(f: Float32Array, cands: number[], refractory: number, init: DetectState): { beats: RawBeat[]; state: DetectState; rejected: number[] } {
  let { spki, npki } = init;
  const beats: RawBeat[] = [];
  const rejected: number[] = [];
  const rr: number[] = [];
  const threshold = (): number => npki + THRESHOLD_FRACTION * (spki - npki);
  /** Typical RR — median of the last eight: robust to a couple of false or replaced beats. */
  const rrTypical = (): number => median(rr);
  const push = (idx: number, amp: number, searchback: boolean): void => {
    const last = beats[beats.length - 1];
    if (last) {
      rr.push(idx - last.idx);
      if (rr.length > RR_HISTORY) rr.shift();
    }
    beats.push({ idx, amp, searchback });
  };
  /** Beat replaced within the refractory period — its RR is recomputed. */
  const relocateLast = (idx: number, amp: number): void => {
    const last = beats[beats.length - 1];
    if (beats.length >= 2 && rr.length) rr[rr.length - 1] = idx - beats[beats.length - 2].idx;
    last.idx = idx;
    last.amp = amp;
  };
  const searchBack = (upTo: number): void => {
    const last = beats[beats.length - 1];
    const avg = rrTypical();
    if (!last || avg <= 0 || upTo - last.idx <= SEARCHBACK_RR_FACTOR * avg) return;
    const t2 = SEARCHBACK_THRESHOLD_FRACTION * threshold();
    let best = -1;
    for (const c of cands) {
      if (c <= last.idx + refractory || c > upTo - refractory) continue;
      if (f[c] > t2 && (best < 0 || f[c] > f[best])) best = c;
    }
    if (best >= 0) {
      spki = SEARCHBACK_LEARN * f[best] + (1 - SEARCHBACK_LEARN) * spki;
      push(best, f[best], true);
    }
  };

  for (const c of cands) {
    const amp = f[c];
    const last = beats[beats.length - 1];
    if (last && c - last.idx < refractory) {
      // Within the refractory period: a noticeably larger peak of the same complex wins; with close amplitudes —
      // the one closer to the position expected from the rhythm (an artifact before the complex vs the complex itself).
      let replace = amp > REFRACTORY_REPLACE_RATIO * last.amp;
      if (!replace && amp > REFRACTORY_TIE_RATIO * last.amp && beats.length >= 2 && rr.length > 0) {
        const expected = beats[beats.length - 2].idx + rrTypical();
        replace = Math.abs(c - expected) < Math.abs(last.idx - expected);
      }
      if (replace) {
        relocateLast(c, amp);
        spki = SIGNAL_LEARN * amp + (1 - SIGNAL_LEARN) * spki;
      }
      continue;
    }
    searchBack(c);
    const lastNow = beats[beats.length - 1];
    if (lastNow && c - lastNow.idx < refractory) continue;
    // Prematurity gate: a candidate earlier than PREMATURE_RR_FRACTION of the typical RR is a beat only if it is not
    // weaker than half the signal level (ectopy keeps the QRS energy; a glitch between beats does not).
    const premature = lastNow && rr.length >= PREMATURE_MIN_HISTORY && c - lastNow.idx < PREMATURE_RR_FRACTION * rrTypical();
    if (premature && amp < PREMATURE_MIN_SIGNAL_FRACTION * spki) {
      npki = SIGNAL_LEARN * amp + (1 - SIGNAL_LEARN) * npki;
      rejected.push(c);
      continue;
    }
    if (amp > threshold()) {
      spki = SIGNAL_LEARN * amp + (1 - SIGNAL_LEARN) * spki;
      push(c, amp, false);
    } else {
      npki = SIGNAL_LEARN * amp + (1 - SIGNAL_LEARN) * npki;
      rejected.push(c);
    }
  }
  searchBack(f.length - 1 + refractory);
  return { beats, state: { spki, npki }, rejected };
}

/** The feature lobe at `level · amp` around the peak touches the signal edge. */
function touchesEdge(f: Float32Array, idx: number, amp: number): boolean {
  const n = f.length;
  const level = EDGE_LOBE_LEVEL * amp;
  let a = idx;
  while (a > 0 && f[a - 1] >= level) a--;
  let b = idx;
  while (b < n - 1 && f[b + 1] >= level) b++;
  return a <= EDGE_MARGIN_SAMPLES || b >= n - 1 - EDGE_MARGIN_SAMPLES;
}

/**
 * QRS region of a lead around the merged peak: the contiguous span where the lead feature is ≥ `QRS_REGION_LEVEL` of its
 * maximum within ±`half`. Wave peaks are searched only inside it — neighboring waves and artifacts in the ±window are not taken.
 */
function qrsRegion(lead: LeadFeature, center: number, half: number): [number, number] {
  const n = lead.feature.length;
  const a = Math.max(0, center - half);
  const b = Math.min(n - 1, center + half);
  let peak = a;
  for (let i = a; i <= b; i++) if (lead.feature[i] > lead.feature[peak]) peak = i;
  const level = QRS_REGION_LEVEL * lead.feature[peak];
  if (!(level > 0)) return [a, b];
  let lo = peak;
  while (lo > a && lead.feature[lo - 1] >= level) lo--;
  let hi = peak;
  while (hi < b && lead.feature[hi + 1] >= level) hi++;
  return [lo, hi];
}

interface Deflections {
  /** Maximum and minimum relative to the local baseline: indices and amplitudes (minimum as a positive depth). */
  maxIdx: number;
  maxAmp: number;
  minIdx: number;
  minAmp: number;
}

/** Extreme deviations of the signal from the local baseline (median over ±2 windows) within the region `[lo, hi]`. */
function deflections(mv: Float32Array, lo: number, hi: number, center: number, half: number): Deflections {
  const n = mv.length;
  const wide: number[] = [];
  for (let i = Math.max(0, center - 2 * half); i <= Math.min(n - 1, center + 2 * half); i++) wide.push(mv[i]);
  const base = median(wide);
  let maxIdx = lo;
  let minIdx = lo;
  for (let i = lo; i <= hi; i++) {
    if (mv[i] > mv[maxIdx]) maxIdx = i;
    if (mv[i] < mv[minIdx]) minIdx = i;
  }
  return { maxIdx, maxAmp: Math.max(0, mv[maxIdx] - base), minIdx, minAmp: Math.max(0, base - mv[minIdx]) };
}

/**
 * Peak of the dominant wave with stable polarity: the lead's majority polarity (`positive`) wins unless the opposite
 * wave is more than `POLARITY_OVERRIDE_RATIO` times larger (ectopy with a deep S amid an R rhythm switches polarity —
 * the device marks the beat the same way; noise with R ≈ S does not).
 */
function fiducial(d: Deflections, positive: boolean): { idx: number; amplitude: number } {
  const major = positive ? { idx: d.maxIdx, amplitude: d.maxAmp } : { idx: d.minIdx, amplitude: d.minAmp };
  const minor = positive ? { idx: d.minIdx, amplitude: d.minAmp } : { idx: d.maxIdx, amplitude: d.maxAmp };
  return minor.amplitude > POLARITY_OVERRIDE_RATIO * major.amplitude ? minor : major;
}

/** QRS energy center of a lead — maximum of its feature within ±`half` of `center`; `undefined` if there are no reliable samples. */
function energyCenter(lead: LeadFeature, center: number, half: number): number | undefined {
  const n = lead.feature.length;
  let best = -1;
  let bestVal = 0;
  for (let i = Math.max(0, center - half); i <= Math.min(n - 1, center + half); i++) {
    if (lead.valid[i] && lead.feature[i] > bestVal) {
      bestVal = lead.feature[i];
      best = i;
    }
  }
  return best >= 0 ? best : undefined;
}

function agreementConfidence(deltaSamples: number, toleranceSamples: number): number {
  if (deltaSamples <= toleranceSamples) return 1;
  return Math.max(0.2, 1 - (deltaSamples - toleranceSamples) / (3 * toleranceSamples));
}

function pearson(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
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

/** Signal window around a sample (edge values beyond the edges). */
function window(mv: Float32Array, center: number, half: number): Float32Array {
  const out = new Float32Array(2 * half + 1);
  for (let k = -half; k <= half; k++) out[k + half] = mv[Math.min(mv.length - 1, Math.max(0, center + k))];
  return out;
}

export function detectBeats(signals: LeadSignal[], species: Species): Beat[] {
  const profile = beatProfileFor(species);
  const usable = signals.filter((s) => s.mv.length > 0);
  if (usable.length === 0) return [];
  const reliable = usable.filter((s) => s.confidence >= UNRELIABLE_BELOW);
  const pool = reliable.length ? reliable : usable;
  const fs = pool[0].fs;
  const n = Math.min(...pool.map((s) => s.mv.length));
  const leads = pool.map((s) => leadFeature(s, profile)).filter((l): l is LeadFeature => l !== undefined);
  if (leads.length === 0) return [];

  // Merged feature — sum of normalized contributions of reliable leads.
  const fused = new Float32Array(n);
  for (const lead of leads) for (let i = 0; i < n; i++) fused[i] += lead.feature[i];
  const cands = candidates(fused);
  if (cands.length === 0) return [];
  const refractory = Math.round((profile.refractoryMs * fs) / 1000);

  // Pass 1: learn on the first two seconds; pass 2 — from the learned levels.
  const learn = Math.min(n, Math.round(2 * fs));
  let maxLearn = 0;
  const learnVals: number[] = [];
  for (let i = 0; i < learn; i++) {
    if (fused[i] > maxLearn) maxLearn = fused[i];
    learnVals.push(fused[i]);
  }
  const first = adaptivePass(fused, cands, refractory, { spki: maxLearn, npki: median(learnVals) });
  const spki0 = first.beats.length ? median(first.beats.map((b) => b.amp)) : first.state.spki;
  const npki0 = first.rejected.length ? median(first.rejected.map((c) => fused[c])) : first.state.npki;
  const second = adaptivePass(fused, cands, refractory, { spki: spki0, npki: npki0 });
  const spkiFinal = second.state.spki;

  // Edge complexes are not counted.
  const kept = second.beats.filter((b) => !touchesEdge(fused, b.idx, b.amp));

  const half = Math.round((profile.qrsWindowMs * fs) / 1000);
  const tolerance = Math.round((LEAD_AGREEMENT_MS * fs) / 1000);
  const sampleMs = 1000 / fs;
  const leadII = leads.find((l) => l.signal.id === 'II');

  // Deviations of each lead within its QRS region for each beat; the lead's majority polarity.
  const perLeadDeflections = leads.map((lead) =>
    kept.map((raw) => {
      const center = energyCenter(lead, raw.idx, half);
      if (center === undefined) return undefined;
      const [lo, hi] = qrsRegion(lead, raw.idx, half);
      return { center, d: deflections(lead.signal.mv, lo, hi, raw.idx, half) };
    }),
  );
  const positiveMajority = perLeadDeflections.map((list) => {
    let votes = 0;
    for (const item of list) if (item) votes += item.d.maxAmp >= item.d.minAmp ? 1 : -1;
    return votes >= 0;
  });

  interface Draft {
    raw: RawBeat;
    tIdx: number;
    perLead: Partial<Record<LeadId, BeatLeadInfo>>;
    reasons: string[];
    factor: number;
    refIdx: number;
  }
  const drafts: Draft[] = kept.map((raw, b) => {
    const perLead: Partial<Record<LeadId, BeatLeadInfo>> = {};
    const reasons: string[] = [];
    let agree = 0;
    let contributing = 0;
    let iiIdx: number | undefined;
    const fiducials: number[] = [];
    leads.forEach((lead, l) => {
      const item = perLeadDeflections[l][b];
      if (!item) return;
      contributing++;
      const delta = Math.abs(item.center - raw.idx);
      if (delta <= tolerance) agree++;
      const peak = fiducial(item.d, positiveMajority[l]);
      perLead[lead.signal.id] = { tMs: peak.idx * sampleMs, confidence: agreementConfidence(delta, tolerance) };
      fiducials.push(peak.idx);
      if (lead.signal.id === 'II') iiIdx = peak.idx;
    });
    let factor = contributing > 0 ? 0.5 + 0.5 * (agree / contributing) : 0.5;
    if (contributing > 0 && agree / contributing < 0.5) reasons.push('lead_disagreement');
    if (raw.amp < WEAK_PEAK_FRACTION * spkiFinal) {
      reasons.push('weak_peak');
      factor *= WEAK_PEAK_FACTOR;
    }
    // Beat time — consensus of reliable leads (median of their peaks): this is how the device marks beats (spread ≤ 1.3 px
    // on 10 sheets vs 2 px and a systematic −2 px for II alone); the R peak in II stays in perLead.II.
    if (iiIdx === undefined) reasons.push('lead_ii_unreliable');
    const tIdx = fiducials.length ? Math.round(median(fiducials)) : raw.idx;
    return { raw, tIdx, perLead, reasons, factor, refIdx: iiIdx ?? tIdx };
  });

  // Morphology: correlation of the QRS in II with the sheet's median template.
  if (leadII && drafts.length >= MIN_BEATS_FOR_TEMPLATE) {
    const windows = drafts.map((d) => window(leadII.signal.mv, d.refIdx, half));
    const template = new Float32Array(2 * half + 1);
    for (let k = 0; k < template.length; k++) template[k] = median(windows.map((w) => w[k]));
    drafts.forEach((d, i) => {
      if (pearson(windows[i], template) < MORPHOLOGY_MIN_CORRELATION) {
        d.reasons.push('morphology_outlier');
        d.factor *= MORPHOLOGY_FACTOR;
      }
    });
  }

  // Implausible intervals: both neighbors are flagged, the beats stay.
  const minRr = (60000 / profile.hrPlausible.max) / sampleMs;
  const maxRr = (60000 / profile.hrPlausible.min) / sampleMs;
  for (let i = 0; i + 1 < drafts.length; i++) {
    const rr = drafts[i + 1].tIdx - drafts[i].tIdx;
    if (rr < minRr || rr > maxRr) {
      for (const d of [drafts[i], drafts[i + 1]]) {
        if (!d.reasons.includes('hr_implausible')) {
          d.reasons.push('hr_implausible');
          d.factor *= IMPLAUSIBLE_HR_FACTOR;
        }
      }
    }
  }

  return drafts.map((d, index) => ({
    index,
    tMs: d.tIdx * sampleMs,
    perLead: d.perLead,
    confidence: Math.max(0, Math.min(1, d.factor)),
    reasons: d.reasons,
  }));
}
