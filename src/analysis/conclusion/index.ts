/**
 * `conclusion` module: the row table and the Russian conclusion text built from the phrase dictionary (`phrases.ts`).
 * Rules: unreliable values (`confidence < UNRELIABLE_BELOW` or `value === null`) never appear in the text as
 * numbers; no reliable measurement at all — «Автоматический анализ невозможен: <причина>» (automatic analysis
 * impossible: <reason>); the last line is always the verification note.
 */
import type {
  CaseResult,
  Conclusion,
  ConclusionInputs,
  ConclusionRow,
  Ectopic,
  Episode,
  MeasuredValue,
  MeasurementKey,
  NormClass,
  NormKey,
  NormRange,
  NormTable,
  Species,
} from '../../types/contracts';
import { UNRELIABLE_BELOW } from '../../types/contracts';
import { classify, coreRangeText, entryFor, formatMeasured, getNorms, num, plainNum, roundForUnit, significant, SIGNED_KEYS, type ClassifyContext } from '../norms';
import * as P from './phrases';

export { VERIFICATION } from './phrases';

/** Order of table rows between HR and axis; QTc — dogs only. */
const PARAM_ORDER: readonly MeasurementKey[] = ['pDuration', 'pAmplitude', 'pq', 'q', 'qrs', 'r', 's', 'qt', 'qtc', 't', 'st'];

type Side = 'above' | 'below' | 'deep' | 'sign' | 'inside';

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export function plural(n: number, forms: readonly [string, string, string]): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}

function isAvailable(m: MeasuredValue | undefined): m is MeasuredValue & { value: number } {
  return !!m && m.value !== null && Number.isFinite(m.value) && m.confidence >= UNRELIABLE_BELOW;
}

function withUnit(text: string, unit: string): string {
  return unit === '°' ? `${text}°` : `${text} ${unit}`;
}

function reasonText(code: string | undefined): string {
  if (!code) return P.REASON_FALLBACK;
  const base = code.split(':')[0];
  return P.REASONS[code] ?? P.REASONS[base] ?? P.REASON_FALLBACK;
}

function knownReasons(codes: readonly string[]): string[] {
  return codes.map((c) => P.REASONS[c] ?? P.REASONS[c.split(':')[0]]).filter((t): t is string => !!t);
}

function unitOf(key: NormKey, norms: NormTable, fallback: string): string {
  return norms.params[key]?.unit ?? entryFor(key)?.unit ?? fallback;
}

function normText(range: NormRange | undefined, key: NormKey, unit: string): string {
  if (!range) return P.TABLE.noNorm;
  return withUnit(coreRangeText(range, SIGNED_KEYS.has(key)), unit);
}

function unreliableNote(m: MeasuredValue | undefined): string {
  if (m?.reason) return reasonText(m.reason);
  return fill(P.TABLE.confidenceNote, { confidence: num(roundForUnit(m?.confidence ?? 0, '')) });
}

/** Side of the deviation — used to pick the direction phrase. */
function sideOf(value: number, range: NormRange, ctx: ClassifyContext): Side {
  const v = range.abs ? Math.abs(value) : value;
  // Absolute-value norm and a negative value: exceeding the limit is "deeper than norm", not "above" (T, Q below baseline).
  const beyond: Side = range.abs && value < 0 ? 'deep' : 'above';
  if (range.max !== undefined && v > range.max) return beyond;
  if (range.min !== undefined && v < range.min) return 'below';
  const r = ctx.r;
  if (range.maxFractionOfR !== undefined && typeof r === 'number' && r > 0 && Math.abs(value) > range.maxFractionOfR * r) {
    return beyond;
  }
  if (range.negativeIsBorder && value < 0) return 'sign';
  return 'inside';
}

function directionText(key: NormKey, verdict: NormClass, side: Side): string {
  const code = `${verdict}_${side}`;
  return P.DIRECTION[key]?.[code] ?? P.DIRECTION.default[code] ?? P.DIRECTION.default[`${verdict}_inside`] ?? verdict;
}

interface RowInfo {
  row: ConclusionRow;
  side: Side;
  /** Value for the text (for T — with the fraction of R). */
  textValue: string;
}

function paramRow(key: MeasurementKey, m: MeasuredValue | undefined, norms: NormTable, ctx: ClassifyContext): RowInfo {
  const range = norms.params[key];
  const unit = unitOf(key, norms, m?.unit ?? '');
  const label = P.ROW_LABEL[key] ?? key;
  const norm = normText(range, key, unit);
  if (!isAvailable(m)) {
    return { row: { key, label, value: P.TABLE.unreliable, norm, verdict: 'n/a', note: unreliableNote(m) }, side: 'inside', textValue: '' };
  }
  const signed = SIGNED_KEYS.has(key);
  // The raw value is classified (a borderline zone within rounding is not lost), the rounded one is printed:
  // «0.04 с — пограничное, норма ≤ 0.04» is acceptable (follow-up request from the task 13 review).
  const value = withUnit(formatMeasured(m.value, unit, signed), unit);
  const verdict = classify(key, m.value, norms, ctx);
  const row: ConclusionRow = { key, label, value, norm, verdict };
  let textValue = value;
  if (range?.maxFractionOfR !== undefined && typeof ctx.r === 'number' && ctx.r > 0) {
    const pct = fill(P.TABLE.fractionOfR, { pct: Math.round((Math.abs(m.value) / ctx.r) * 100) });
    row.note = pct;
    textValue = `${value} (${pct})`;
  }
  if (range?.note && !row.note) row.note = range.note;
  return { row, side: range ? sideOf(m.value, range, ctx) : 'inside', textValue };
}

function hrRow(ms: CaseResult['measurements'], norms: NormTable): { row: ConclusionRow; sentence: string } {
  const range = norms.params.hrMean;
  const unit = unitOf('hrMean', norms, 'уд/мин');
  const norm = normText(range, 'hrMean', unit);
  const mean = ms.hrMean;
  if (!isAvailable(mean)) {
    return {
      row: { key: 'hr', label: P.ROW_LABEL.hr, value: P.TABLE.unreliable, norm, verdict: 'n/a', note: unreliableNote(mean) },
      sentence: P.HR.unreliable,
    };
  }
  const hasRange = isAvailable(ms.hrMin) && isAvailable(ms.hrMax);
  // HR is whole bpm (story 26): mean and range are printed rounded, the raw mean is classified.
  const meanShown = roundForUnit(mean.value, unit);
  const minText = hasRange ? formatMeasured(ms.hrMin.value as number, unit) : '';
  const maxText = hasRange ? formatMeasured(ms.hrMax.value as number, unit) : '';
  const rangeText = hasRange ? `${minText}–${maxText}` : '';
  const value = withUnit(hasRange ? `${num(meanShown)} (${rangeText})` : num(meanShown), unit);
  const verdict = classify('hrMean', mean.value, norms);
  const row: ConclusionRow = { key: 'hr', label: P.ROW_LABEL.hr, value, norm, verdict };
  if (range?.note) row.note = range.note;

  let sentence: string;
  if (!range) {
    sentence = fill(P.HR.noNorm, { mean: num(meanShown), range: hasRange ? ` (${rangeText})` : '' });
  } else {
    const side = sideOf(mean.value, range, {});
    const verdictKey = verdict === 'abnormal' ? `abnormal_${side}` : verdict;
    const vars = {
      mean: num(meanShown),
      min: minText,
      max: maxText,
      norm,
      verdict: P.HR.verdict[verdictKey] ?? '',
    };
    sentence = fill(hasRange ? P.HR.withRange : P.HR.meanOnly, vars);
  }
  return { row, sentence };
}

function axisRow(axisDeg: number | null, norms: NormTable): { row: ConclusionRow; sentence: string } {
  const range = norms.params.axis;
  const norm = normText(range, 'axis', unitOf('axis', norms, '°'));
  if (axisDeg === null || !Number.isFinite(axisDeg)) {
    return {
      row: { key: 'axis', label: P.ROW_LABEL.axis, value: P.TABLE.unreliable, norm, verdict: 'n/a', note: P.TABLE.axisUndefined },
      sentence: P.AXIS.undefined,
    };
  }
  const shown = roundForUnit(axisDeg, '°');
  const value = `${num(shown, true)}°`;
  const verdict = classify('axis', axisDeg, norms);
  const side = range ? sideOf(axisDeg, range, {}) : 'inside';
  const key = verdict === 'abnormal' ? `abnormal_${side}` : verdict;
  return {
    row: { key: 'axis', label: P.ROW_LABEL.axis, value, norm, verdict },
    sentence: fill(P.AXIS[key] ?? P.AXIS['n/a'], { value, norm }),
  };
}

function focusName(code: string): string {
  return P.FOCUS[code] ?? P.FOCUS_FALLBACK;
}

function couplingText(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ms = (v: number) => formatMeasured(v, 'мс');
  if (min === max) return fill(P.ECTOPICS.couplingSingle, { value: ms(min) });
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return fill(P.ECTOPICS.couplingRange, { min: ms(min), max: ms(max), mean: ms(mean) });
}

function ectopicsSentence(ectopics: readonly Ectopic[]): string {
  if (ectopics.length === 0) return P.ECTOPICS.none;
  const kinds = [...new Set<string>(['SVE', 'VE', ...ectopics.map((e) => e.kind)])].filter((k) => ectopics.some((e) => e.kind === k));
  const items = kinds.map((kind) => {
    const list = ectopics.filter((e) => e.kind === kind);
    const forms = P.ECTOPIC_KIND[kind] ?? P.ECTOPIC_KIND_FALLBACK;
    const fociCount = new Map<string, number>();
    for (const e of list) fociCount.set(focusName(e.focus), (fociCount.get(focusName(e.focus)) ?? 0) + 1);
    const foci =
      fociCount.size === 1
        ? [...fociCount.keys()][0]
        : [...fociCount.entries()].map(([focus, count]) => fill(P.ECTOPICS.fociCounted, { focus, count })).join(', ');
    const couplings = list.map((e) => e.couplingMs).filter((c) => Number.isFinite(c));
    const coupling = couplings.length ? couplingText(couplings) : P.REASON_FALLBACK;
    return fill(P.ECTOPICS.item, { count: list.length, kind: plural(list.length, forms), foci, coupling });
  });
  return fill(P.ECTOPICS.list, { items: items.join('; ') });
}

function episodesSentence(episodes: readonly Episode[]): string {
  if (episodes.length === 0) return P.EPISODES.none;
  const items = episodes.map((ep) =>
    fill(P.EPISODES.item, {
      kind: P.EPISODE_KIND[ep.kind] ?? P.EPISODE_KIND_FALLBACK,
      start: formatMeasured(ep.startMs / 1000, 'с'),
      duration: formatMeasured(ep.durationMs / 1000, 'с'),
      beats: `${ep.beats.length} ${plural(ep.beats.length, P.PLURALS.beats)}`,
      focus: focusName(ep.focus),
      coupling: formatMeasured(ep.couplingMs, 'мс'),
    }),
  );
  return fill(P.EPISODES.list, { count: episodes.length, items: items.join('; ') });
}

/**
 * Reason why the absence of extrasystoles and episodes cannot be treated as a finding: no beats found, no signals,
 * or all leads of the counted sheets are unreliable (`confidence < UNRELIABLE_BELOW` or no samples). Without case
 * beats (`beats` not passed) we judge by rhythm reasons only. `null` — beats are reliable. Exported for the UI.
 */
export function beatsUnreliableReason(caseResult: Pick<CaseResult, 'rhythm' | 'beats'>): string | null {
  const own = caseResult.rhythm.reasons.find((c) => c === 'no_beats' || c === 'no_signals');
  if (own) return own;
  const pages = caseResult.beats;
  if (!pages) return null;
  if (pages.reduce((n, p) => n + p.beats.length, 0) === 0) return 'no_beats';
  const signals = pages.flatMap((p) => p.signals);
  if (signals.length === 0) return 'no_signals';
  if (signals.every((s) => s.mv.length === 0 || s.confidence < UNRELIABLE_BELOW)) return 'all_leads_unreliable';
  return null;
}

function recordSentence(caseResult: CaseResult, minutes: number | undefined): string {
  const pages = `${caseResult.span.pages} ${plural(caseResult.span.pages, P.PLURALS.pages)}`;
  const seconds = formatMeasured(caseResult.span.durationMs / 1000, 'с');
  return minutes !== undefined && Number.isFinite(minutes)
    ? fill(P.RECORD.withMinutes, { pages, seconds, minutes: formatMeasured(minutes, 'мин') })
    : fill(P.RECORD.noMinutes, { pages, seconds });
}

/** Case flags in dictionary wording; the precision ceiling is a separate `precisionSentence` line (always). */
function flagsSentence(flags: readonly string[]): string | null {
  const items = flags.map((flag) => P.FLAGS.items[flag]).filter((t): t is string => !!t);
  return items.length ? fill(P.FLAGS.list, { items: items.join('; ') }) : null;
}

/**
 * Precision-ceiling note (story 26, §3) — in every conclusion, from the `precision` of the counted sheets (the coarsest),
 * not from the `precision_ceiling` flag (agreed in the task 09 review). Pixel size — two significant digits
 * (0.023 mV / 4.6 ms; rounding to 0.01 would understate the ceiling), ±2 px — exactly twice the printed value.
 * Exported for the UI (`app/results`) — one phrase for the whole app.
 */
export function precisionSentence(caseResult: Pick<CaseResult, 'perPage' | 'analyzed'>): string {
  const pages = (caseResult.analyzed ?? caseResult.perPage.map((_, i) => i)).map((i) => caseResult.perPage[i]).filter((p) => !!p);
  const precision = pages.map((p) => p.precision).filter((p) => p && p.mvPerPx > 0 && p.msPerPx > 0);
  if (precision.length === 0) return P.PRECISION.unknown;
  const mv = significant(Math.max(...precision.map((p) => p.mvPerPx)));
  const ms = significant(Math.max(...precision.map((p) => p.msPerPx)));
  // Doubling a two-digit number yields at most three significant digits — toPrecision(3) only strips the float tail.
  const twice = (v: number) => plainNum(Number((2 * v).toPrecision(3)));
  return fill(P.PRECISION.known, { mv: plainNum(mv), ms: plainNum(ms), mv2: twice(mv), ms2: twice(ms) });
}

function firstReason(caseResult: CaseResult): string {
  const ms = caseResult.measurements;
  const fromMeasurements = (Object.keys(ms) as MeasurementKey[]).map((k) => ms[k]?.reason).find((r) => !!r);
  if (fromMeasurements) return reasonText(fromMeasurements);
  const fromRhythm = knownReasons(caseResult.rhythm.reasons)[0];
  if (fromRhythm) return fromRhythm;
  const fromPages = caseResult.perPage.flatMap((p) => knownReasons(p.issues ?? []))[0];
  return fromPages ?? P.REASON_FALLBACK;
}

function rhythmSentence(caseResult: CaseResult): string {
  const base = P.RHYTHM[caseResult.rhythm.type] ?? P.RHYTHM_FALLBACK;
  if (caseResult.rhythm.type === 'sinus') return base;
  const reasons = caseResult.rhythm.reasons
    .map((code) => {
      // «P найден перед N из M комплексов» (P found before N of M complexes) — with numbers so the output matches the overlay P marks.
      const counted = /^p_not_all:(\d+)\/(\d+)$/.exec(code);
      return counted ? fill(P.P_NOT_ALL_COUNTED, { found: counted[1], total: counted[2] }) : knownReasons([code])[0];
    })
    .filter((t): t is string => !!t);
  return reasons.length ? base + fill(P.RHYTHM_REASONS, { reasons: reasons.join(', ') }) : base;
}

export function compose(caseResult: CaseResult, inputs: ConclusionInputs): Conclusion {
  const species: Species = inputs.species;
  const norms = getNorms(species, inputs.dogSize);
  const ms = caseResult.measurements;
  const ctx: ClassifyContext = { r: isAvailable(ms.r) ? ms.r.value : null };

  const hr = hrRow(ms, norms);
  const params = PARAM_ORDER.filter((key) => !(key === 'qtc' && species === 'cat')).map((key) => paramRow(key, ms[key], norms, ctx));
  const axis = axisRow(caseResult.rhythm.axisDeg, norms);
  const table: ConclusionRow[] = [hr.row, ...params.map((p) => p.row), axis.row];

  const anyMeasured = (Object.keys(ms) as MeasurementKey[]).some((k) => isAvailable(ms[k]));
  if (!anyMeasured) {
    // The "impossible" branch keeps what the vet entered and the mandatory §3 notes (task 13).
    const text = [fill(P.ANALYSIS_IMPOSSIBLE, { reason: firstReason(caseResult) }), ...caseTail(caseResult, inputs)];
    return { table, text: text.join('\n') };
  }

  const lines: string[] = [];
  lines.push(`${rhythmSentence(caseResult)}. ${hr.sentence}`);
  const pauses = caseResult.rhythm.pauses ?? [];
  // A pause is a finding for the specialist: with one, no sinus-arrhythmia statement is made even if the rhythm report has it.
  if (caseResult.rhythm.sinusArrhythmia && pauses.length === 0) lines.push(P.SINUS_ARRHYTHMIA[species]);
  for (const pause of pauses) {
    lines.push(fill(P.PAUSE, { duration: formatMeasured(pause.durationMs, 'мс'), start: formatMeasured(pause.startMs / 1000, 'с') }));
  }
  lines.push(axis.sentence);

  const deviation = (info: RowInfo) =>
    fill(P.DEVIATIONS.item, {
      label: P.PARAM_TEXT[info.row.key] ?? info.row.label,
      value: info.textValue,
      direction: directionText(info.row.key as NormKey, info.row.verdict, info.side),
      norm: info.row.norm,
    });
  const abnormal = params.filter((p) => p.row.verdict === 'abnormal').map(deviation);
  const border = params.filter((p) => p.row.verdict === 'border').map(deviation);
  lines.push(abnormal.length ? fill(P.DEVIATIONS.list, { items: abnormal.join('; ') }) : P.DEVIATIONS.none);
  if (border.length) lines.push(fill(P.DEVIATIONS.borderList, { items: border.join('; ') }));

  const beatsUnreliable = beatsUnreliableReason(caseResult);
  if (beatsUnreliable) {
    // No reliable beats — «не выявлено» (not detected) would be a false normal (blind acceptance: a foreign image).
    const reason = reasonText(beatsUnreliable);
    lines.push(fill(P.ECTOPICS.unreliable, { reason }), fill(P.EPISODES.unreliable, { reason }));
  } else {
    lines.push(ectopicsSentence(caseResult.rhythm.ectopics));
    lines.push(episodesSentence(caseResult.rhythm.episodes));
  }

  const unreliable = [
    ...(isAvailable(ms.hrMean) ? [] : [P.PARAM_TEXT.hr]),
    ...params.filter((p) => p.row.value === P.TABLE.unreliable).map((p) => P.PARAM_TEXT[p.row.key] ?? p.row.label),
  ];
  if (unreliable.length) lines.push(fill(P.UNRELIABLE_LIST, { items: unreliable.join(', ') }));

  lines.push(...caseTail(caseResult, inputs));
  return { table, text: lines.join('\n') };
}

/** Lines mandatory in every conclusion (§3): drugs, recording and minutes, flags, precision ceiling, verification. */
function caseTail(caseResult: CaseResult, inputs: ConclusionInputs): string[] {
  const lines: string[] = [];
  const drugs = inputs.drugs.trim();
  lines.push(drugs ? fill(P.DRUGS.given, { drugs }) : P.DRUGS.none);
  lines.push(recordSentence(caseResult, inputs.monitoringMinutes));
  const flags = flagsSentence(inputs.flags);
  if (flags) lines.push(flags);
  lines.push(precisionSentence(caseResult));
  lines.push(P.VERIFICATION);
  return lines;
}
