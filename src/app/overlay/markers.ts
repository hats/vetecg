/**
 * Wave markers on the overlay — pure functions without Konva/DOM (stories 60–61, task 09 review agreements).
 *
 * Marker time is the sheet time scale (like `Delineation` and `Edit.marker.tMs`). Dragging is bounded by the
 * neighbouring markers of its complex and the R of neighbouring beats: impossible positions are rejected
 * («Неверный ввод» elaboration). After a species/calibration/baseline change beats are re-detected and
 * `Edit.marker.beat` indices may become stale — markers are matched by time (`staleMarkerEdits`) and those not found
 * are reset with a warning.
 */
import type { Delineation, Ectopic, EctopicKind, Edit, MarkerField, PageBeats } from '../../types/contracts';
import { mergeBeats } from '../../analysis/measure';

type MarkerEdit = Extract<Edit, { kind: 'marker' }>;

export interface EctopicPosition {
  page: number;
  /** Beat position in `PageBeats.beats` (index for `Edit.marker.beat`), not `Beat.index`. */
  beat: number;
  kind: EctopicKind;
}

/**
 * Ectopic beats of the rhythm report — in sheet coordinates. `Ectopic.beat` is a global index into the merged array
 * (`mergeBeats`: sheets in order, within a sheet by time); mapped back via the beat position in the sheet's array.
 */
export function ectopicPositions(beats: readonly PageBeats[], ectopics: readonly Ectopic[]): EctopicPosition[] {
  const merged = mergeBeats(beats);
  const out: EctopicPosition[] = [];
  for (const e of ectopics) {
    const m = merged[e.beat];
    if (!m) continue;
    const pb = beats[m.pageIndex];
    const position = pb.beats.indexOf(m.beat);
    if (position >= 0) out.push({ page: pb.page, beat: position, kind: e.kind });
  }
  return out;
}

/**
 * The marker still belongs to its beat: a beat with that index exists, and the marker time lies strictly between the
 * R of the sheet's neighbouring beats (interval midpoints won't do: T end at 250 bpm in a cat lies past the RR midpoint).
 */
export function markerFits(edit: MarkerEdit, pb: PageBeats): boolean {
  const beat = pb.beats[edit.beat];
  if (!beat || !Number.isFinite(edit.tMs)) return false;
  const prev = pb.beats[edit.beat - 1];
  const next = pb.beats[edit.beat + 1];
  return (!prev || edit.tMs > prev.tMs) && (!next || edit.tMs < next.tMs);
}

/**
 * Marker edits that no longer find their complex after beats are recomputed — they must be reset with a warning.
 * A sheet without beats in the result (excluded, different animal) is unknown — its markers are left alone.
 */
export function staleMarkerEdits(edits: readonly Edit[], beats: readonly PageBeats[]): Edit[] {
  return edits.filter((e): e is MarkerEdit => {
    if (e.kind !== 'marker') return false;
    const pb = beats.find((b) => b.page === e.page);
    return pb !== undefined && !markerFits(e, pb);
  });
}

/** Minimum gap between neighbouring boundaries — one sample at 500 Hz. */
export const MARKER_MIN_GAP_MS = 2;

/** Order of boundaries within a complex; `rPeak`/`sPeak`/`tPeak` are not draggable but bound their neighbours. */
const ORDER = ['pOn', 'pOff', 'qOn', 'rPeak', 'sPeak', 'sOff', 'tPeak', 'tOff'] as const;

export interface MarkerNeighbours {
  /** R of the sheet's previous beat, ms; absent — recording edge. */
  prevTMs?: number;
  /** R of the sheet's next beat, ms; absent — recording edge. */
  nextTMs?: number;
}

export interface MarkerBounds {
  minMs: number;
  maxMs: number;
}

/** Allowed range for boundary `field` of complex `d`: between the nearest found neighbours with a one-sample gap. */
export function markerBounds(field: MarkerField, d: Delineation, neighbours: MarkerNeighbours): MarkerBounds {
  const i = ORDER.indexOf(field);
  let lower = neighbours.prevTMs ?? -Infinity;
  for (let k = 0; k < i; k++) {
    const v = d[ORDER[k]];
    if (v !== null && v > lower) lower = v;
  }
  let upper = neighbours.nextTMs ?? Infinity;
  for (let k = i + 1; k < ORDER.length; k++) {
    const v = d[ORDER[k]];
    if (v !== null && v < upper) upper = v;
  }
  return { minMs: lower + MARKER_MIN_GAP_MS, maxMs: upper - MARKER_MIN_GAP_MS };
}
