/**
 * On-image edits — pure helpers without Konva/DOM (stories 17, 19, 20, 20а).
 *
 * The overlay draws the edited sheet (`CaseResult.perPage[i]`), where lead slots are already rearranged by
 * `leadLabel` edits. Per the task 09 review agreement, `baseline`/`leadLabel` edits address a trace by its *automatic*
 * label (before reassignment), so an overlay slot is mapped back by the mirror of `relabelLeads` (`autoLabelOf`).
 */
import { LEAD_IDS, type Edit, type LeadId, type Point, type TraceHint } from '../../types/contracts';

type LeadLabelEdit = Extract<Edit, { kind: 'leadLabel' }>;

/**
 * Automatic label of the trace sitting in slot `slot` after this sheet's `leadLabel` edits (list order is edit
 * order; the last edit of a lead wins). Empty slot ("no lead" or the trace moved to another slot) — `undefined`.
 * On conflict, as in `relabelLeads`, the trace with the later edit wins; a trace without an edit loses to any edit.
 */
export function autoLabelOf(slot: LeadId, pageEdits: readonly Edit[]): LeadId | undefined {
  const target = new Map<LeadId, LeadId | null>();
  const rank = new Map<LeadId, number>();
  pageEdits.forEach((edit, k) => {
    if (edit.kind !== 'leadLabel') return;
    target.set(edit.lead, edit.as);
    rank.set(edit.lead, k);
  });
  const labelOf = (id: LeadId): LeadId | null => (target.has(id) ? (target.get(id) as LeadId | null) : id);
  const sources = LEAD_IDS.filter((id) => labelOf(id) === slot);
  if (sources.length === 0) return undefined;
  sources.sort((a, b) => (rank.get(a) ?? -1) - (rank.get(b) ?? -1));
  return sources.at(-1);
}

export interface LeadBaseline {
  id: LeadId;
  baselineY: number;
}

/**
 * Lead separator from the two ends of a line (story 20а): a horizontal line at the `y` of the first end between
 * neighbouring baselines — everything above belongs to the upper lead, below — to the lower one. A line outside the
 * band between the first and last baseline or shorter than 1 px in x — no separator.
 */
export function separatorHint(a: Point, b: Point, baselines: readonly LeadBaseline[]): TraceHint | undefined {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  if (!(x1 - x0 >= 1)) return undefined;
  const y = a.y;
  const sorted = [...baselines].sort((p, q) => p.baselineY - q.baselineY);
  let above: LeadBaseline | undefined;
  let below: LeadBaseline | undefined;
  for (const lead of sorted) {
    if (lead.baselineY <= y) above = lead;
    else if (!below) below = lead;
  }
  if (!above || !below) return undefined;
  return { x0, x1, y, above: above.id, below: below.id };
}

/** px/mm from two clicks at a known distance `mm` (50 mm between neighbouring «+», 5 mm between dotted-grid nodes). */
export function pxPerMmFromClicks(a: Point, b: Point, mm: number): number {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return mm > 0 ? dist / mm : 0;
}

/** Two edits are equal by value (objects in `CaseState.edits` are copies, reference comparison won't work). */
export function sameEdit(a: Edit, b: Edit): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Label swap of two overlay slots (IMAGE-02.1, «Поменять с …»): two `leadLabel` edits — slot A's trace gets label B,
 * slot B's trace gets label A; both curves are kept, the displaced one stays addressable via `autoLabelOf`.
 * Empty slot — a single edit (move); identity edits (trace already at its automatic place) are not created,
 * so swapping the same slots again restores the automatic layout.
 */
export function swapLabelEdits(slotA: LeadId, slotB: LeadId, pageEdits: readonly Edit[], page: number): Edit[] {
  if (slotA === slotB) return [];
  const a = autoLabelOf(slotA, pageEdits);
  const b = autoLabelOf(slotB, pageEdits);
  const out: Edit[] = [];
  if (a && a !== slotB) out.push({ kind: 'leadLabel', page, lead: a, as: slotB });
  if (b && b !== slotA) out.push({ kind: 'leadLabel', page, lead: b, as: slotA });
  return out;
}

/** The sheet's `leadLabel` edits — for showing «переназначено» (reassigned) in the label. */
export const leadLabelEdits = (pageEdits: readonly Edit[]): LeadLabelEdit[] => pageEdits.filter((e): e is LeadLabelEdit => e.kind === 'leadLabel');
