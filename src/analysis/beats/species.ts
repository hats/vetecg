/**
 * Species profile for the beat detector and wave delineation — data, not branches in the algorithms.
 * Durations that have a norm in the reference (PQ, QT, QRS, P) are taken from `getNorms(species)` with a margin;
 * the detector's own constants (Pan-Tompkins band, integration window, refractory period) live here.
 */
import { getNorms } from '../norms';
import type { Species } from '../../types/contracts';

export interface BeatSpeciesProfile {
  species: Species;
  /** Pan-Tompkins band, Hz (2nd-order high-pass and low-pass, zero phase). */
  bandpassHz: [number, number];
  /** Moving-average integration window, ms (≈ the widest QRS of the species). */
  integrationMs: number;
  /** Detector refractory period, ms (specification §3: dog 150, cat 100). */
  refractoryMs: number;
  /** Half-width of the window around the merged peak for refining R and QRS bounds, ms (specification: ±80 ms). */
  qrsWindowMs: number;
  /** Plausible HR, bpm; intervals outside — `hr_implausible` (SIGNAL-03.1). */
  hrPlausible: { min: number; max: number };
  /** P peak search window before the QRS onset: from `qOn − maxMs` to `qOn − minMs`. */
  pSearch: { minMs: number; maxMs: number };
  /** Allowed P duration (species range), ms. */
  pDuration: { minMs: number; maxMs: number };
  /** T peak search: from `sOff + minAfterQrsMs` to `qOn + maxFromQOnMs` (bounded by the next beat). */
  tSearch: { minAfterQrsMs: number; maxFromQOnMs: number };
  /** QRS longer than this — bounds are doubtful (delineation confidence is reduced), ms. */
  qrsMaxPlausibleMs: number;
  /** Slope-based QRS region wider than this — the slope threshold is raised until the region narrows (T or P captured), ms. */
  qrsRegionMaxMs: number;
}

/** The detector's own constants per species. */
const DETECTOR: Record<Species, Pick<BeatSpeciesProfile, 'bandpassHz' | 'integrationMs' | 'refractoryMs' | 'qrsWindowMs'>> = {
  dog: { bandpassHz: [5, 25], integrationMs: 80, refractoryMs: 150, qrsWindowMs: 80 },
  cat: { bandpassHz: [8, 35], integrationMs: 50, refractoryMs: 100, qrsWindowMs: 60 },
};

/** Beat detector range, separate from the clinical norm (specification §4). */
export const HR_PLAUSIBLE = { min: 30, max: 320 } as const;

/**
 * Margins over the reference norms: P window from 1.25·PQ_max to 0.25·PQ_min before the QRS (P may end almost at the
 * QRS, and the QRS onset on the printed curve is blurred by ~10 ms), P duration up to 1.8 × the bound, T up to 1.25 QT.
 */
const P_SEARCH_MAX_FACTOR = 1.25;
const P_SEARCH_MIN_FACTOR = 0.25;
const P_DURATION_MAX_FACTOR = 1.8;
const P_DURATION_MIN_MS = 12;
const T_SEARCH_MAX_FACTOR = 1.25;
const T_MIN_AFTER_QRS_MS = 20;
const QRS_PLAUSIBLE_FACTOR = 2;
/** 35 Hz printing widens the QRS by 10–20 ms; norm bound × 1.5 — limit of the slope-based region before threshold escalation. */
const QRS_REGION_FACTOR = 1.5;

const cache = new Map<Species, BeatSpeciesProfile>();

export function beatProfileFor(species: Species): BeatSpeciesProfile {
  const cached = cache.get(species);
  if (cached) return cached;
  const params = getNorms(species).params;
  const pq = params.pq ?? { min: 0.06, max: 0.13, unit: 's', source: 'fallback' };
  const qt = params.qt ?? { min: 0.12, max: 0.25, unit: 's', source: 'fallback' };
  const qrs = params.qrs ?? { max: 0.06, unit: 's', source: 'fallback' };
  const p = params.pDuration ?? { max: 0.04, unit: 's', source: 'fallback' };
  const pMax = (p.borderMax ?? p.max ?? 0.04) * 1000;
  const profile: BeatSpeciesProfile = {
    species,
    ...DETECTOR[species],
    hrPlausible: { ...HR_PLAUSIBLE },
    pSearch: { minMs: Math.round((pq.min ?? 0.05) * 1000 * P_SEARCH_MIN_FACTOR), maxMs: Math.round((pq.max ?? 0.13) * 1000 * P_SEARCH_MAX_FACTOR) },
    pDuration: { minMs: P_DURATION_MIN_MS, maxMs: Math.round(pMax * P_DURATION_MAX_FACTOR) },
    tSearch: { minAfterQrsMs: T_MIN_AFTER_QRS_MS, maxFromQOnMs: Math.round((qt.max ?? 0.25) * 1000 * T_SEARCH_MAX_FACTOR) },
    qrsMaxPlausibleMs: Math.round((qrs.borderMax ?? qrs.max ?? 0.06) * 1000 * QRS_PLAUSIBLE_FACTOR),
    qrsRegionMaxMs: Math.round((qrs.borderMax ?? qrs.max ?? 0.06) * 1000 * QRS_REGION_FACTOR),
  };
  cache.set(species, profile);
  return profile;
}

/** Tolerance for QRS time agreement between leads: ±2 sheet columns ≈ ±9.3 ms at 50 mm/s and 4.3 px/mm. */
export const LEAD_AGREEMENT_MS = 10;
