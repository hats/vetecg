/** Formatting of numbers and norm ranges — shared by the norms document and the conclusion table. */
import type { NormKey, NormRange } from '../../types/contracts';

/** Parameters whose sign is meaningful: shown with a "+" sign. */
export const SIGNED_KEYS: ReadonlySet<NormKey> = new Set<NormKey>(['axis', 'st']);

/** Number without trailing zeros (up to 3 decimals), with a typographic minus; `signed` — "+" on positives. */
export function num(n: number, signed = false): string {
  const text = Number(n.toFixed(3)).toString().replace('-', '−');
  return signed && n > 0 ? `+${text}` : text;
}

/**
 * Decimals for a measured value by unit (task 13, story 26 — numbers no finer than the sheet: 1 px ≈ 4.6 ms
 * and 0.023 mV): HR, ms and degrees — integers; seconds and millivolts — no finer than 0.01. Unknown unit — 2 decimals.
 */
export function decimalsFor(unit: string): number {
  return unit === 'уд/мин' || unit === 'мс' || unit === '°' ? 0 : 2;
}

/** Value rounded to the display precision of its unit; this is the value that gets classified and printed. */
export function roundForUnit(value: number, unit: string): number {
  const k = 10 ** decimalsFor(unit);
  const rounded = Math.round(value * k) / k;
  return rounded === 0 ? 0 : rounded;
}

/** Measured value for the table and text: rounded per unit, no trailing zeros, with a typographic minus. */
export function formatMeasured(value: number, unit: string, signed = false): string {
  return num(roundForUnit(value, unit), signed);
}

/**
 * Number with `digits` significant digits (precision ceiling, story 26): 0.0232 → "0.023", 4.646 → "4.6", 0.0046 → "0.0046" —
 * never "0". Returns the rounded number itself so that derived values (±2 px) are computed from the printed one.
 */
export function significant(value: number, digits = 2): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return Number(value.toPrecision(digits));
}

/** Number text without a limit on decimals (unlike `num`), with a typographic minus. */
export function plainNum(value: number): string {
  return String(value).replace('-', '−');
}

/** Core norm range: «70–160», «≤ 0.04», «+40…+100», «по модулю ≤ 0.5» (absolute value), «≤ 25 % R и по модулю ≤ 1». */
export function coreRangeText(range: NormRange, signed = false): string {
  const f = (n: number) => num(n, signed);
  let core: string;
  if (range.min !== undefined && range.max !== undefined) core = `${f(range.min)}${signed ? '…' : '–'}${f(range.max)}`;
  else if (range.max !== undefined) core = `≤ ${f(range.max)}`;
  else if (range.min !== undefined) core = `≥ ${f(range.min)}`;
  else core = 'без границ';
  if (range.abs) core = `по модулю ${core}`;
  if (range.maxFractionOfR !== undefined) core = `≤ ${num(range.maxFractionOfR * 100)} % R и ${core}`;
  return core;
}

/** Explicit borderline zone: «пограничное от 120 и до 240» (borderline from 120 to 240), or an empty string. */
export function borderText(range: NormRange, signed = false): string {
  const f = (n: number) => num(n, signed);
  const border: string[] = [];
  if (range.borderMin !== undefined) border.push(`от ${f(range.borderMin)}`);
  if (range.borderMax !== undefined) border.push(`до ${f(range.borderMax)}`);
  let text = border.length ? `пограничное ${border.join(' и ')}` : '';
  if (range.borderOnly) text = text ? `${text}; выше — только пограничное` : 'выше — только пограничное';
  return text;
}

/** Full norm text for the document: range; borderline zone. `null` — «норма не задана» (norm not defined). */
export function rangeText(range: NormRange | null | undefined, signed = false): string {
  if (!range) return 'норма не задана';
  const border = borderText(range, signed);
  return border ? `${coreRangeText(range, signed)}; ${border}` : coreRangeText(range, signed);
}
