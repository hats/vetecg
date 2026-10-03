/**
 * Wave markers on the overlay (stories 60–61, «Неверный ввод» elaboration): dragging is bounded by neighbouring
 * markers and neighbouring complexes; after beats are recomputed, markers are matched by time.
 */
import { describe, expect, it } from 'vitest';
import type { Beat, Delineation, Edit, PageBeats } from '../../types/contracts';
import { ectopicPositions, markerBounds, staleMarkerEdits } from './markers';

const full: Delineation = { pOn: 100, pOff: 140, pFound: true, qOn: 180, rPeak: 200, sPeak: 215, sOff: 230, tPeak: 300, tOff: 340, confidence: 1 };

describe('markers: drag bounds', () => {
  it('a marker does not pass neighbouring markers of its complex (2 ms gap = one sample) or the R of neighbouring beats', () => {
    const neighbours = { prevTMs: 0, nextTMs: 600 };
    expect(markerBounds('pOn', full, neighbours)).toEqual({ minMs: 2, maxMs: 138 });
    expect(markerBounds('pOff', full, neighbours)).toEqual({ minMs: 102, maxMs: 178 });
    expect(markerBounds('qOn', full, neighbours)).toEqual({ minMs: 142, maxMs: 198 });
    expect(markerBounds('sOff', full, neighbours)).toEqual({ minMs: 217, maxMs: 298 });
    expect(markerBounds('tOff', full, neighbours)).toEqual({ minMs: 302, maxMs: 598 });
  });

  it('waves not found do not act as bounds; without a neighbouring beat the bound is the recording edge', () => {
    const sparse: Delineation = { ...full, pOn: null, pOff: null, pFound: false, sPeak: null, tPeak: null, tOff: null };
    expect(markerBounds('qOn', sparse, { prevTMs: 0 })).toEqual({ minMs: 2, maxMs: 198 });
    expect(markerBounds('sOff', sparse, { nextTMs: 600 })).toEqual({ minMs: 202, maxMs: 598 });
    expect(markerBounds('sOff', sparse, {})).toEqual({ minMs: 202, maxMs: Infinity });
    expect(markerBounds('pOn', sparse, {})).toEqual({ minMs: -Infinity, maxMs: 178 });
  });
});

const beatAt = (index: number, tMs: number): Beat => ({ index, tMs, perLead: {}, confidence: 1, reasons: [] });
const pageBeatsOf = (page: number, times: number[]): PageBeats => ({
  page,
  offsetMs: 0,
  beats: times.map((t, k) => beatAt(k, t)),
  delineations: times.map(() => ({ ...full })),
  signals: [],
});
const marker = (page: number, beat: number, tMs: number): Edit => ({ kind: 'marker', page, beat, field: 'sOff', tMs });

describe('markers: matching edits after beats are recomputed', () => {
  it('a marker stays valid if it lies between the R of neighbouring beats; otherwise or without such a beat it is stale', () => {
    const beats = [pageBeatsOf(0, [200, 700, 1200])];
    const ok1 = marker(0, 1, 650);
    const ok0 = marker(0, 0, 100);
    const ok2 = marker(0, 2, 1300);
    const beforePrev = marker(0, 1, 150);
    const noBeat = marker(0, 5, 900);
    const baseline: Edit = { kind: 'baseline', page: 0, lead: 'II', y: 300 };
    expect(staleMarkerEdits([ok1, ok0, ok2, beforePrev, noBeat, baseline], beats)).toEqual([beforePrev, noBeat]);
  });

  it('a sheet absent from the result beats (excluded) does not reset its markers', () => {
    const beats = [pageBeatsOf(0, [200, 700])];
    const other = marker(1, 0, 300);
    expect(staleMarkerEdits([other], beats)).toEqual([]);
  });
});

describe('markers: ectopic beats (story 60 — "ectopic beats with a separate tag")', () => {
  it('a global beat index from the rhythm report maps to a sheet and a position in its beats array (time order)', () => {
    // Sheet 0 beats are not stored in time order: global order is 100 (position 1), 500 (position 0), then sheet 1: 300.
    const beats = [pageBeatsOf(0, [500, 100]), pageBeatsOf(1, [300])];
    const ectopics = [
      { beat: 0, kind: 'SVE' as const, focus: 'atrial', couplingMs: 400 },
      { beat: 2, kind: 'VE' as const, focus: 'left_ventricle', couplingMs: 350 },
    ];
    expect(ectopicPositions(beats, ectopics)).toEqual([
      { page: 0, beat: 1, kind: 'SVE' },
      { page: 1, beat: 0, kind: 'VE' },
    ]);
  });
});
