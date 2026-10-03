/**
 * On-image edits (stories 17, 19, 20а): reverse mapping "overlay slot → automatic label" for
 * `Edit.baseline`/`Edit.leadLabel`, lead separator, two-click manual calibration.
 */
import { describe, expect, it } from 'vitest';
import { analyzeCase } from '../../analysis/case';
import { analyzePage } from '../../core/page';
import { POLYSPECTRUM } from '../../core/profile';
import type { CaseSettings, Edit, LeadId } from '../../types/contracts';
import { loadFixture } from '../../../test/fixtures';
import { autoLabelOf, pxPerMmFromClicks, separatorHint, swapLabelEdits } from './edits';

const relabel = (lead: LeadId, as: LeadId | null): Edit => ({ kind: 'leadLabel', page: 0, lead, as });

describe('edits: automatic label of the trace in an overlay slot (review 09 agreement: `lead` is the label before reassignment)', () => {
  it('without edits a slot carries its own lead; on an I↔II swap the trace in slot I is automatic II and vice versa', () => {
    expect(autoLabelOf('III', [])).toBe('III');
    const swap = [relabel('I', 'II'), relabel('II', 'I')];
    expect(autoLabelOf('I', swap)).toBe('II');
    expect(autoLabelOf('II', swap)).toBe('I');
    expect(autoLabelOf('III', swap)).toBe('III');
  });

  it('"no lead" frees the slot; on conflict the reassigned trace wins (as in relabelLeads)', () => {
    expect(autoLabelOf('aVF', [relabel('aVF', null)])).toBeUndefined();
    const conflict = [relabel('I', 'II')];
    expect(autoLabelOf('II', conflict)).toBe('I');
    expect(autoLabelOf('I', conflict)).toBeUndefined();
  });

  it('edits of other sheets and other kinds have no effect', () => {
    const foreign: Edit[] = [{ kind: 'leadLabel', page: 1, lead: 'I', as: 'II' }, { kind: 'baseline', page: 0, lead: 'I', y: 100 }];
    expect(autoLabelOf('I', foreign.filter((e) => e.page === 0))).toBe('I');
  });
});

describe('edits: label swap via the UI (IMAGE-02.1 — both curves are kept, the displaced one stays addressable)', () => {
  const settings: CaseSettings = { species: 'dog', drugs: '', analyzeTogether: false };

  it('"Swap with II" on slot I yields two leadLabel edits [I→II, II→I]; analyzeCase keeps both curves without conflict', () => {
    const page = analyzePage(loadFixture('a-01'), POLYSPECTRUM);
    const edits = swapLabelEdits('I', 'II', [], 0);
    expect(edits).toEqual([
      { kind: 'leadLabel', page: 0, lead: 'I', as: 'II' },
      { kind: 'leadLabel', page: 0, lead: 'II', as: 'I' },
    ]);
    const out = analyzeCase([page], settings, edits).perPage[0];
    // Slot I holds the automatic II curve and vice versa; other slots untouched; no curve is lost.
    expect(out.leads[0].points).toEqual(page.leads[1].points);
    expect(out.leads[1].points).toEqual(page.leads[0].points);
    expect(out.leads.slice(2).map((l) => l.points.length)).toEqual(page.leads.slice(2).map((l) => l.points.length));
    expect(out.leads.every((l) => l.points.length > 0)).toBe(true);
    expect(analyzeCase([page], settings, edits).issues ?? []).not.toContainEqual(expect.stringMatching(/^lead_label_conflict/));
    // The displaced curve is addressable: slot I is now "automatic II", and it can be reassigned further.
    expect(autoLabelOf('I', edits)).toBe('II');
    const further: Edit[] = [...edits.filter((e) => e.kind === 'leadLabel' && e.lead !== 'II'), { kind: 'leadLabel', page: 0, lead: 'II', as: 'III' }];
    const next = analyzeCase([page], settings, further).perPage[0];
    expect(next.leads[2].points).toEqual(page.leads[1].points);
    expect(next.leads[0].points).toEqual([]);
  });

  it('swap with an empty slot is one edit (a move); swapping the same slots again undoes the swap (no edits)', () => {
    const moved = swapLabelEdits('aVF', 'I', [{ kind: 'leadLabel', page: 0, lead: 'I', as: null }], 0);
    expect(moved).toEqual([{ kind: 'leadLabel', page: 0, lead: 'aVF', as: 'I' }]);
    const swapped = swapLabelEdits('I', 'II', [], 0);
    expect(swapLabelEdits('I', 'II', swapped, 0)).toEqual([]);
  });
});

describe('edits: lead separator (story 20а — a line with two ends between neighbouring leads)', () => {
  const baselines = [
    { id: 'I' as const, baselineY: 194 },
    { id: 'II' as const, baselineY: 323 },
    { id: 'III' as const, baselineY: 452 },
    { id: 'aVR' as const, baselineY: 581 },
  ];

  it('a line between baselines II and III: above — II, below — III; ends ordered by x', () => {
    expect(separatorHint({ x: 700, y: 400 }, { x: 650, y: 400 }, baselines)).toEqual({ x0: 650, x1: 700, y: 400, above: 'II', below: 'III' });
  });

  it('a line above the first baseline, below the last, or without x extent — no separator', () => {
    expect(separatorHint({ x: 100, y: 100 }, { x: 200, y: 100 }, baselines)).toBeUndefined();
    expect(separatorHint({ x: 100, y: 700 }, { x: 200, y: 700 }, baselines)).toBeUndefined();
    expect(separatorHint({ x: 100, y: 400 }, { x: 100.5, y: 400 }, baselines)).toBeUndefined();
  });
});

describe('edits: two-click manual calibration (story 17)', () => {
  it('two neighbouring «+» marks 215.25 px apart = 50 mm give 4.305 px/mm; the distance is Euclidean', () => {
    expect(pxPerMmFromClicks({ x: 100, y: 200 }, { x: 315.25, y: 200 }, 50)).toBeCloseTo(4.305, 9);
    expect(pxPerMmFromClicks({ x: 0, y: 0 }, { x: 30, y: 40 }, 5)).toBe(10);
  });
});
