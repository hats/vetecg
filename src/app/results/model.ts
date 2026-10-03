/**
 * Case results model for the table, conclusion, copying and printing (stories 14, 26–27, 58, 67–72) — pure
 * functions over case state, no DOM. Parameter rows come from `compose` (`CaseResult.conclusion.table`), and so does
 * the conclusion text (the store already rebuilds it with the right minutes and flags); this module adds the notes
 * `compose` does not render: «ненадёжно, проверьте разметку» ("unreliable, check the markup") with a reason,
 * «по всем отведениям» ("across all leads") for any value with `MeasuredValue.source === 'all_leads'`, «Q/S не выражен»
 * for annotated zero amplitudes, rows for rhythm, ectopics, episodes (beat unreliability — `beatsUnreliableReason` from
 * `conclusion`), drugs and minutes, and case flag notes. The precision ceiling is only the `precisionSentence` line in
 * the conclusion text, with no second copy.
 */
import type { Ectopic, Episode, MeasuredValue, MeasurementKey, NormClass, RhythmReport, Species } from '../../types/contracts';
import { UNRELIABLE_BELOW } from '../../types/contracts';
import { beatsUnreliableReason, fill, plural } from '../../analysis/conclusion';
import * as P from '../../analysis/conclusion/phrases';
import { formatMeasured } from '../../analysis/norms';
import type { CaseState } from '../state/case-store';

/** Row colour: green / yellow / red / grey ("norm not set", service rows) / unreliable. */
export type RowTone = 'norm' | 'border' | 'abnormal' | 'none' | 'unreliable';

export interface ResultRow {
  key: string;
  label: string;
  value: string;
  /** Norm for the species and size; empty for service rows. */
  norm: string;
  verdict: NormClass;
  tone: RowTone;
  /** Note: unreliability reason, source notes, norm explanation; empty string — none. */
  note: string;
}

export type ResultsStatus = 'empty' | 'pending' | 'failed' | 'ready';

export interface ResultsView {
  /** `empty` — no sheets; `pending` — sheets still being recognized; `failed` — no sheet recognized; `ready` — result available. */
  status: ResultsStatus;
  /** Parameter rows (`compose`): HR … axis. */
  rows: ResultRow[];
  /** Rhythm, ectopics, episodes, drugs, monitoring minutes. */
  extra: ResultRow[];
  /** Case notes: manual correction, "analyze together"; the precision ceiling is in `text`, not here. */
  notes: string[];
  /** Conclusion text from `compose`; the last line is about verification. */
  text: string;
  /** The text starts with «Автоматический анализ невозможен» ("automatic analysis is impossible"). */
  impossible: boolean;
}

export const UNRELIABLE_VALUE = 'ненадёжно, проверьте разметку';
export const NOT_FOUND = 'не выявлено';
export const NOT_SPECIFIED = 'не указано';

const RHYTHM_LABEL: Readonly<Record<string, string>> = { sinus: 'синусовый', non_sinus: 'несинусовый', undetermined: 'не определён' };
const RHYTHM_TONE: Readonly<Record<string, RowTone>> = { sinus: 'norm', non_sinus: 'abnormal', undetermined: 'unreliable' };
/** Species-specific reading of sinus arrhythmia in the table row (AXIS-03) — short; the full dictionary phrase is in the text. */
const SINUS_ARRHYTHMIA_SHORT: Readonly<Record<Species, string>> = {
  dog: 'синусовая аритмия (вариант нормы)',
  cat: 'синусовая аритмия (патология)',
};
const EPISODE_FORMS: readonly [string, string, string] = ['эпизод', 'эпизода', 'эпизодов'];

/** Known reason codes as dictionary words; unknown ones are dropped (same rule as in the compose text). */
function reasonTexts(codes: readonly string[]): string[] {
  return codes.map((c) => P.REASONS[c] ?? P.REASONS[c.split(':')[0]]).filter((t): t is string => !!t);
}

function rhythmRow(rhythm: RhythmReport, species: Species): ResultRow {
  const parts: string[] = [];
  const reasons = reasonTexts(rhythm.reasons);
  if (reasons.length) parts.push(reasons.join(', '));
  let tone: RowTone = RHYTHM_TONE[rhythm.type] ?? 'unreliable';
  const pauses = rhythm.pauses ?? [];
  // As in compose: with a pause there is no sinus arrhythmia verdict — the pause needs specialist review (yellow).
  if (rhythm.sinusArrhythmia && pauses.length === 0) {
    parts.push(SINUS_ARRHYTHMIA_SHORT[species]);
    if (species === 'cat' && tone === 'norm') tone = 'abnormal';
  }
  for (const pause of pauses) {
    parts.push(`пауза ${formatMeasured(pause.durationMs, 'мс')} мс (с ${formatMeasured(pause.startMs / 1000, 'с')} с)`);
  }
  if (pauses.length && tone === 'norm') tone = 'border';
  return {
    key: 'rhythm',
    label: 'Ритм',
    value: RHYTHM_LABEL[rhythm.type] ?? RHYTHM_LABEL.undetermined,
    norm: '',
    verdict: 'n/a',
    tone,
    note: parts.join('; '),
  };
}

function couplingText(values: readonly number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ms = (v: number) => formatMeasured(v, 'мс');
  if (min === max) return fill(P.ECTOPICS.couplingSingle, { value: ms(min) });
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return fill(P.ECTOPICS.couplingRange, { min: ms(min), max: ms(max), mean: ms(mean) });
}

/** Row «ненадёжно, проверьте разметку» with the reason in dictionary words — instead of a false «не выявлено» ("not found"). */
function unreliableRow(key: string, label: string, reasonCode: string): ResultRow {
  return { key, label, value: UNRELIABLE_VALUE, norm: '', verdict: 'n/a', tone: 'unreliable', note: reasonTexts([reasonCode])[0] ?? P.REASON_FALLBACK };
}

/** Ectopics: count, type, focus "approximate", coupling — from dictionary templates (as in the compose text). */
function ectopicsRow(ectopics: readonly Ectopic[]): ResultRow {
  const base = { key: 'ectopics', label: 'Экстрасистолы', norm: '', verdict: 'n/a' as NormClass, note: '' };
  if (ectopics.length === 0) return { ...base, value: NOT_FOUND, tone: 'norm' };
  const kinds = [...new Set<string>(['SVE', 'VE', ...ectopics.map((e) => e.kind)])].filter((k) => ectopics.some((e) => e.kind === k));
  const items = kinds.map((kind) => {
    const list = ectopics.filter((e) => e.kind === kind);
    const foci = new Map<string, number>();
    for (const e of list) {
      const name = P.FOCUS[e.focus] ?? P.FOCUS_FALLBACK;
      foci.set(name, (foci.get(name) ?? 0) + 1);
    }
    const fociText = foci.size === 1 ? [...foci.keys()][0] : [...foci.entries()].map(([focus, count]) => fill(P.ECTOPICS.fociCounted, { focus, count })).join(', ');
    const couplings = list.map((e) => e.couplingMs).filter((ms) => Number.isFinite(ms));
    const coupling = couplings.length ? couplingText(couplings) : P.REASON_FALLBACK;
    return fill(P.ECTOPICS.item, { count: list.length, kind: plural(list.length, P.ECTOPIC_KIND[kind] ?? P.ECTOPIC_KIND_FALLBACK), foci: fociText, coupling });
  });
  return { ...base, value: items.join('; '), tone: 'abnormal' };
}

/** Non-sinus rhythm episodes: count in the value, list (start time, duration, focus, coupling) in the note. */
function episodesRow(episodes: readonly Episode[]): ResultRow {
  const base = { key: 'episodes', label: 'Эпизоды несинусового ритма', norm: '', verdict: 'n/a' as NormClass };
  if (episodes.length === 0) return { ...base, value: NOT_FOUND, tone: 'norm', note: '' };
  const items = episodes.map((ep) =>
    fill(P.EPISODES.item, {
      kind: P.EPISODE_KIND[ep.kind] ?? P.EPISODE_KIND_FALLBACK,
      start: formatMeasured(ep.startMs / 1000, 'с'),
      duration: formatMeasured(ep.durationMs / 1000, 'с'),
      beats: `${ep.beats.length} ${plural(ep.beats.length, P.PLURALS.beats)}`,
      focus: P.FOCUS[ep.focus] ?? P.FOCUS_FALLBACK,
      coupling: formatMeasured(ep.couplingMs, 'мс'),
    }),
  );
  return { ...base, value: `${episodes.length} ${plural(episodes.length, EPISODE_FORMS)}`, tone: 'abnormal', note: items.join('; ') };
}

/** Note «по всем отведениям» ("across all leads") for any value with `source === 'all_leads'` (task 07 review, acceptance results). */
export const ALL_LEADS_NOTE = 'по всем отведениям';
/** `measure` annotations for zero amplitudes: wave below the 2 px threshold (stories 44, 46а). */
const ABSENT_NOTE: Readonly<Record<string, string>> = { q_absent: 'Q не выражен', s_absent: 'S не выражен', r_absent: 'R не выражен' };

const toneOf = (verdict: NormClass): RowTone => (verdict === 'n/a' ? 'none' : verdict);

const joinNotes = (...parts: (string | undefined)[]): string => parts.filter((p): p is string => !!p).join('; ');

/** Notes for a reliable value that `compose` does not render. */
function valueNotes(m: MeasuredValue | undefined): string[] {
  const out: string[] = [];
  if (!m) return out;
  if (m.source === 'all_leads') out.push(ALL_LEADS_NOTE);
  if (m.value === 0 && m.reason && ABSENT_NOTE[m.reason]) out.push(ABSENT_NOTE[m.reason]);
  return out;
}

function isAvailable(m: MeasuredValue | undefined): m is MeasuredValue & { value: number } {
  return !!m && m.value !== null && Number.isFinite(m.value) && m.confidence >= UNRELIABLE_BELOW;
}

const FLAG_NOTE: Readonly<Record<string, string>> = {
  manual_correction: 'Разметка скорректирована вручную.',
  analyze_together_forced: 'Листы разных животных проанализированы вместе по решению пользователя.',
};

/**
 * Case notes — flags only. The precision ceiling (story 26) is not shown as a separate note: `compose` always puts
 * `precisionSentence` into the conclusion text, and a second copy would duplicate the line on screen, in the clipboard
 * and in print.
 */
function caseNotes(result: NonNullable<CaseState['result']>): string[] {
  return (result.flags ?? []).map((f) => FLAG_NOTE[f]).filter((t): t is string => !!t);
}

function emptyView(status: ResultsStatus): ResultsView {
  return { status, rows: [], extra: [], notes: [], text: '', impossible: false };
}

export function buildResultsView(c: CaseState): ResultsView {
  if (c.sheets.length === 0) return emptyView('empty');
  const result = c.result;
  if (!result) return emptyView(c.sheets.some((s) => s.status === 'queued' || s.status === 'analyzing') ? 'pending' : 'failed');

  const ms = result.measurements;
  const rows: ResultRow[] = result.conclusion.table.map((r) => {
    const key = r.key;
    const m = key === 'hr' ? ms.hrMean : key === 'axis' ? undefined : ms[key as MeasurementKey];
    const unreliable = key === 'axis' ? result.rhythm.axisDeg === null || r.value === P.TABLE.unreliable : !isAvailable(m) || r.value === P.TABLE.unreliable;
    if (unreliable) return { key, label: r.label, value: UNRELIABLE_VALUE, norm: r.norm, verdict: 'n/a', tone: 'unreliable', note: r.note ?? '' };
    return { key, label: r.label, value: r.value, norm: r.norm, verdict: r.verdict, tone: toneOf(r.verdict), note: joinNotes(...valueNotes(m), r.note) };
  });

  const beatsUnreliable = beatsUnreliableReason(result);
  const extra: ResultRow[] = [
    rhythmRow(result.rhythm, c.settings.species),
    ...(beatsUnreliable
      ? [unreliableRow('ectopics', 'Экстрасистолы', beatsUnreliable), unreliableRow('episodes', 'Эпизоды несинусового ритма', beatsUnreliable)]
      : [ectopicsRow(result.rhythm.ectopics), episodesRow(result.rhythm.episodes)]),
    { key: 'drugs', label: 'Препараты', value: c.settings.drugs.trim() || NOT_SPECIFIED, norm: '', verdict: 'n/a', tone: 'none', note: '' },
    {
      key: 'minutes',
      label: 'Минуты мониторинга',
      value: c.settings.monitoringMinutes === undefined ? NOT_SPECIFIED : `${formatMeasured(c.settings.monitoringMinutes, 'мин')} мин`,
      norm: '',
      verdict: 'n/a',
      tone: 'none',
      note: c.settings.monitoringMinutes !== undefined && c.settings.minutesSource === 'pages' ? 'по листам' : '',
    },
  ];

  const text = result.conclusion.text;
  return { status: 'ready', rows, extra, notes: caseNotes(result), text, impossible: text.startsWith(P.ANALYSIS_IMPOSSIBLE.split('{')[0]) };
}

const TONE_TEXT: Readonly<Record<Exclude<RowTone, 'none' | 'unreliable'>, string>> = {
  norm: 'норма',
  border: 'пограничное',
  abnormal: 'отклонение',
};

/** Verdict in words for the badge and TSV (TECH-02: no English codes); empty for service rows without a norm, «—» when the species has no norm. */
export function verdictText(row: ResultRow): string {
  switch (row.tone) {
    case 'unreliable':
      return 'ненадёжно';
    case 'none':
      return row.norm ? '—' : '';
    default:
      return TONE_TEXT[row.tone];
  }
}

export const TSV_HEADER: readonly string[] = ['Параметр', 'Значение', 'Норма', 'Оценка', 'Примечание'];

const cell = (text: string): string => text.replace(/[\t\r\n]+/g, ' ').trim();

/** Table as TSV (story 71 — for pasting into spreadsheets): header, parameter rows, service rows. */
export function toTsv(view: ResultsView): string {
  const rows = [...view.rows, ...view.extra].map((r) => [r.label, r.value, r.norm, verdictText(r), r.note].map(cell).join('\t'));
  return [TSV_HEADER.join('\t'), ...rows].join('\n');
}

/** Clipboard text: TSV, case notes, conclusion text — the last line is always about verification (story 70). */
export function toClipboardText(view: ResultsView): string {
  return [toTsv(view), view.notes.join('\n'), view.text].filter((part) => part.length > 0).join('\n\n');
}
