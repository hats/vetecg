/**
 * Conclusion phrase dictionary — data, not logic. `{name}` placeholders are filled by `fill()` from `index.ts`.
 * Keys are by parameter (`NormKey` plus `hr`) and by class (`norm` / `border` / `abnormal` / `n/a`).
 * Every rhythm, focus, episode and reason code has a Russian fallback: an English code never reaches the text.
 */
import type { Species } from '../../types/contracts';

/** Mandatory last line of every conclusion (RESULT-04). */
export const VERIFICATION = 'Заключение требует верификации специалистом.';

export const ANALYSIS_IMPOSSIBLE = 'Автоматический анализ невозможен: {reason}.';

/** Parameter names inside a sentence (lowercase, except abbreviations). */
export const PARAM_TEXT: Readonly<Record<string, string>> = {
  hr: 'ЧСС',
  pDuration: 'длительность P',
  pAmplitude: 'амплитуда P',
  pq: 'интервал PQ',
  q: 'амплитуда Q',
  qrs: 'длительность QRS',
  r: 'амплитуда R',
  s: 'амплитуда S',
  qt: 'интервал QT',
  qtc: 'QTc (Van de Water)',
  t: 'амплитуда T',
  st: 'сегмент ST',
  axis: 'электрическая ось',
};

/** Row headings of the result table. */
export const ROW_LABEL: Readonly<Record<string, string>> = {
  hr: 'ЧСС',
  pDuration: 'Длительность P',
  pAmplitude: 'Амплитуда P',
  pq: 'Интервал PQ',
  q: 'Амплитуда Q',
  qrs: 'Длительность QRS',
  r: 'Амплитуда R',
  s: 'Амплитуда S',
  qt: 'Интервал QT',
  qtc: 'QTc (Van de Water)',
  t: 'Амплитуда T',
  st: 'Сегмент ST',
  axis: 'Электрическая ось',
};

export const TABLE = {
  unreliable: 'ненадёжно',
  noNorm: 'норма не задана',
  axisUndefined: 'ось не определена',
  confidenceNote: 'уверенность {confidence}',
  fractionOfR: '{pct} % R',
};

/** Rhythm type (`RhythmReport.type`); unknown code → `rhythmFallback`. */
export const RHYTHM: Readonly<Record<string, string>> = {
  sinus: 'Ритм синусовый',
  non_sinus: 'Ритм несинусовый',
  undetermined: 'Ритм не определён',
};
export const RHYTHM_FALLBACK = 'Ритм не определён';
export const RHYTHM_REASONS = ' ({reasons})';
/** Reason `p_not_all:<with P>/<evaluated>` in the conclusion text; without numbers — `REASONS.p_not_all`. */
export const P_NOT_ALL_COUNTED = 'зубец P найден перед {found} из {total} комплексов';

export const HR = {
  withRange: 'ЧСС {mean} уд/мин ({min}–{max}), норма {norm}{verdict}.',
  meanOnly: 'ЧСС {mean} уд/мин, норма {norm}{verdict}.',
  noNorm: 'ЧСС {mean} уд/мин{range} (норма для вида не задана).',
  unreliable: 'ЧСС не определена надёжно.',
  verdict: {
    norm: '',
    border: ' — пограничное значение',
    abnormal_above: ' — выше нормы (тахикардия)',
    abnormal_below: ' — ниже нормы (брадикардия)',
  } as Readonly<Record<string, string>>,
};

/** Species-specific interpretation of sinus arrhythmia (AXIS-03, §4 decisions). */
export const SINUS_ARRHYTHMIA: Readonly<Record<Species, string>> = {
  dog: 'Синусовая аритмия — у собак вариант нормы (дыхательная).',
  cat: 'Синусовая аритмия — для кошки в клинике нехарактерна, требует внимания: возможен повышенный парасимпатический тонус или заболевание (дыхательные пути, ЖКТ, ЦНС); при домашней записи у здоровых кошек встречается часто.',
};

/** Rhythm pause (RR ≥ 2 × median, `RhythmReport.pauses`) — one phrase per pause; suppresses the sinus-arrhythmia statement. */
export const PAUSE = 'Пауза {duration} мс (с {start} с) — требует проверки специалистом.';

export const AXIS: Readonly<Record<string, string>> = {
  undefined: 'Электрическая ось не определена.',
  norm: 'Электрическая ось {value} — в пределах нормы ({norm}).',
  border: 'Электрическая ось {value} — пограничное значение (норма {norm}).',
  abnormal_below: 'Электрическая ось {value} — отклонение влево (норма {norm}).',
  abnormal_above: 'Электрическая ось {value} — отклонение вправо (норма {norm}).',
  'n/a': 'Электрическая ось {value} (норма для вида не задана).',
};

export const DEVIATIONS = {
  none: 'Отклонений от нормы по измеренным параметрам не выявлено.',
  list: 'Отклонения от нормы: {items}.',
  borderList: 'Пограничные значения: {items}.',
  item: '{label} {value} — {direction}, норма {norm}',
};

/**
 * Deviation direction by parameter and key `<class>_<side>`; side — `above` / `below` /
 * `deep` (absolute-value norm, value below baseline — deeper than norm) / `sign` (sign, with magnitude in norm) /
 * `inside` (borderline by rule, not by limit). No entry for the parameter — `default` is used.
 */
export const DIRECTION: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  default: {
    abnormal_above: 'выше нормы',
    abnormal_below: 'ниже нормы',
    abnormal_deep: 'глубже нормы',
    border_above: 'пограничное (у верхней границы)',
    border_below: 'пограничное (у нижней границы)',
    border_deep: 'пограничное (по глубине)',
    border_sign: 'пограничное',
    border_inside: 'пограничное',
  },
  q: {
    border_above: 'глубокий Q, пограничное (породозависимо)',
    border_deep: 'глубокий Q, пограничное (породозависимо)',
  },
  st: {
    abnormal_above: 'элевация сверх нормы',
    abnormal_below: 'депрессия сверх нормы',
    border_above: 'пограничная элевация',
    border_below: 'пограничная депрессия',
  },
  t: {
    border_sign: 'отрицательный зубец T, пограничное (у кошек обычно положительный)',
    abnormal_deep: 'отрицательный T, глубже нормы',
    border_deep: 'отрицательный T, пограничное по глубине',
  },
};

export const ECTOPICS = {
  none: 'Экстрасистолы: не выявлено.',
  unreliable: 'Экстрасистолы: ненадёжно, проверьте разметку ({reason}).',
  list: 'Экстрасистолы: {items}.',
  item: '{count} {kind} (очаг ориентировочно {foci}), интервал сцепления {coupling}',
  couplingSingle: '{value} мс',
  couplingRange: '{min}–{max} мс (в среднем {mean} мс)',
  fociCounted: '{focus} — {count}',
};

/** Plural forms of extrasystole names: [1, 2–4, 5+]. Unknown kind — fallback. */
export const ECTOPIC_KIND: Readonly<Record<string, readonly [string, string, string]>> = {
  SVE: ['наджелудочковая', 'наджелудочковые', 'наджелудочковых'],
  VE: ['желудочковая', 'желудочковые', 'желудочковых'],
};
export const ECTOPIC_KIND_FALLBACK: readonly [string, string, string] = [
  'экстрасистола неуточнённого типа',
  'экстрасистолы неуточнённого типа',
  'экстрасистол неуточнённого типа',
];

/** Focus (`Ectopic.focus`, `Episode.focus`); always marked «ориентировочно» (tentatively) in the template. */
export const FOCUS: Readonly<Record<string, string>> = {
  atrial: 'предсердный',
  junctional: 'АВ-узловой',
  av_junction: 'АВ-узловой',
  left_ventricle: 'левый желудочек',
  right_ventricle: 'правый желудочек',
  lv: 'левый желудочек',
  rv: 'правый желудочек',
  unknown: 'не определён',
};
export const FOCUS_FALLBACK = 'не определён';

export const EPISODES = {
  none: 'Эпизоды несинусового ритма: не выявлено.',
  unreliable: 'Эпизоды несинусового ритма: ненадёжно, проверьте разметку ({reason}).',
  list: 'Эпизоды несинусового ритма ({count}): {items}.',
  item: '{kind} с {start} с, длительность {duration} с, {beats}, очаг ориентировочно {focus}, сцепление {coupling} мс',
};

/** Episode kind (`Episode.kind`); unknown code → fallback. */
export const EPISODE_KIND: Readonly<Record<string, string>> = {
  sve_run: 'пробежка наджелудочковых экстрасистол',
  ve_run: 'пробежка желудочковых экстрасистол',
  svt: 'наджелудочковая тахикардия',
  vt: 'желудочковая тахикардия',
  no_p: 'участок без зубцов P',
};
export const EPISODE_KIND_FALLBACK = 'эпизод несинусового ритма';

export const UNRELIABLE_LIST = 'Ненадёжные измерения (в заключении не учитывались): {items}.';

export const DRUGS = {
  none: 'Препараты: не указаны.',
  given: 'Препараты: {drugs}.',
};

export const RECORD = {
  withMinutes: 'Запись: {pages}, {seconds} с; мониторинг {minutes} мин.',
  noMinutes: 'Запись: {pages}, {seconds} с; длительность мониторинга не указана.',
};

export const FLAGS = {
  list: 'Пометки: {items}.',
  items: {
    manual_correction: 'разметка скорректирована вручную',
    analyze_together_forced: 'листы проанализированы вместе по решению пользователя',
  } as Readonly<Record<string, string>>,
};

/**
 * Precision ceiling (story 26) — in every conclusion, from the resolution of the counted sheets (the coarsest sheet);
 * the `precision_ceiling` flag does not produce a separate note.
 */
export const PRECISION = {
  known: 'Потолок точности листа: 1 px = {mv} мВ / {ms} мс; точность измерений не лучше ±2 px (±{mv2} мВ / ±{ms2} мс).',
  unknown: 'Потолок точности не определён: сетка листа не распознана.',
};

/** Reason codes (`MeasuredValue.reason`, `RhythmReport.reasons`, issues); unknown code → fallback. */
export const REASONS: Readonly<Record<string, string>> = {
  lead_ii_unreliable: 'отведение II ненадёжно',
  lead_II_unreliable: 'отведение II ненадёжно',
  no_beats: 'удары не найдены',
  too_few_beats: 'слишком мало комплексов для измерения',
  no_signals: 'сигналы не распознаны',
  no_pages: 'нет листов для анализа',
  not_implemented: 'модуль анализа не реализован',
  exception: 'ошибка анализа',
  low_confidence: 'низкая уверенность распознавания',
  p_not_found: 'зубец P не найден',
  p_not_all: 'зубец P найден не перед всеми комплексами',
  all_leads_unreliable: 'все отведения ненадёжны',
  t_not_found: 'зубец T не найден',
  pq_unstable: 'интервал PQ непостоянен',
  axis_leads_unreliable: 'отведения I или aVF ненадёжны',
};
export const REASON_FALLBACK = 'измерения недоступны';

/** Plural forms of counted nouns: [1, 2–4, 5+]. */
export const PLURALS = {
  pages: ['лист', 'листа', 'листов'] as const,
  beats: ['удар', 'удара', 'ударов'] as const,
};
