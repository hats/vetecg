/** Large batch threshold (stories 1–5, "Growth" elaboration: >30 — warn and continue). */
export const MANY_SHEETS = 30;

/** Large batch notice; an empty string means there is nothing to report. */
export function batchNotice(count: number): string {
  return count > MANY_SHEETS ? `Листов больше ${MANY_SHEETS} — анализ большой партии займёт больше времени` : '';
}
