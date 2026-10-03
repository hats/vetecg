/**
 * Norms reference data — the single source of truth: both the `getNorms` tables and the document
 * `docs/normy-ekg.md` (see `doc.ts`) are built from it. All values are for lead II, right lateral
 * recumbency, at rest. Source codes live in `sources.ts`; check date — 2026-10-01 (`research-norms.md`).
 *
 * Signs and units expected from the `measure` module: intervals — seconds; amplitudes — mV relative
 * to the baseline (Q and S negative, classified by absolute value); ST — signed mV
 * (negative = depression, positive = elevation); T — signed mV; HR — bpm; axis — degrees.
 */
import type { DogSize, NormKey, NormRange, RhythmThresholds, Species } from '../../types/contracts';

export const NORMS_CHECK_DATE = '2026-10-01';

export type ProfileId = 'dog-small' | 'dog-large' | 'cat';

export interface NormProfile {
  id: ProfileId;
  species: Species;
  dogSize?: DogSize;
  /** Document column heading. */
  label: string;
  /** What it corresponds to in Tilley & Smith. */
  mapping: string;
}

export const NORM_PROFILES: readonly NormProfile[] = [
  { id: 'dog-small', species: 'dog', dogSize: 'small', label: 'Собака мелкая', mapping: 'той и мелкие породы' },
  {
    id: 'dog-large',
    species: 'dog',
    dogSize: 'large',
    label: 'Собака крупная',
    mapping: 'стандартные породы; гигантские — пограничные зоны',
  },
  { id: 'cat', species: 'cat', label: 'Кошка', mapping: 'кошка' },
];

/** Reference row: one norm per profile; `null` — "norm not defined" («норма не задана»). */
export interface NormEntry {
  key: NormKey;
  label: string;
  unit: string;
  ranges: Record<ProfileId, NormRange | null>;
  /** What the project's former references had (`reference-ranges.ts` small / large / cat; FEATURES.md). */
  previous: string;
  /** What was changed and why. */
  change: string;
  /** Remark on the document row. */
  remark?: string;
}

function range(unit: string, source: string, fields: Omit<NormRange, 'unit' | 'source'>): NormRange {
  return { unit, source, ...fields };
}

const S = 'с';
const MV = 'мВ';
const BPM = 'уд/мин';
const DEG = '°';

export const NORM_ENTRIES: readonly NormEntry[] = [
  {
    key: 'hrMean',
    label: 'ЧСС в покое',
    unit: BPM,
    ranges: {
      'dog-small': range(BPM, 'T&S-M (той 70–180)', {
        min: 70,
        max: 180,
        borderMin: 60,
        borderSource: 'FOX03 (брадикардия <60)',
        note: 'той до 180; стандартные породы 70–160',
      }),
      'dog-large': range(BPM, 'T&S-M (стандартные 70–160)', {
        min: 70,
        max: 160,
        borderMin: 60,
        borderSource: 'T&S-M (гигантские 60–140)',
        note: 'гигантские породы 60–140 — пограничная зона 60–70',
      }),
      cat: range(BPM, 'VAR-C, DUR22 (140–220)', {
        min: 140,
        max: 220,
        borderMin: 120,
        borderMax: 240,
        borderSource: 'T&S-M (120–240)',
        note: 'в клинике стресс-зависима; консенсуса между источниками нет',
      }),
    },
    previous:
      'диапазон детектора `SPECIES_CONFIGS` показывался как норма: собака 60–180, кошка 120–240; FEATURES.md: 60–170 / 140–220',
    change:
      'клиническая норма отделена от диапазона детектора ударов (40–320); мелкие 70–180, крупные 70–160 (гиганты 60–140 — пограничная зона 60–70), щенки до 220 — только в документе (возраст приложение не знает); кошки 140–220 с серой зоной 120–240 (Tilley). Решение спецификации §4 называет 140–220 «по опорному источнику», но у Tilley & Smith для кошек стоит 120–240 — 140–220 дают Varshney и Durham',
    remark: 'Домашняя ЧСС кошки (Холтер, HAN09): медиана 165, диапазон 70–303 — клинические таблицы завышены стрессом.',
  },
  {
    key: 'pDuration',
    label: 'Длительность P',
    unit: S,
    ranges: {
      'dog-small': range(S, 'T&S-M; T92 (через CAR19)', { max: 0.04 }),
      'dog-large': range(S, 'T&S-M (≤0.04); T92 (через CAR19)', {
        max: 0.04,
        borderMax: 0.05,
        borderSource: 'T&S-M (гигантские ≤0.05)',
        note: 'пограничная зона — гигантские породы',
      }),
      cat: range(S, 'T&S-M; CHE17', { max: 0.04 }),
    },
    previous: '0.03–0.05 / 0.04–0.06 / 0.02–0.04; FEATURES.md 0.02–0.04',
    change:
      'верх 0.04 у всех трёх профилей (0.06 у крупных пропускал расширенный P — признак увеличения левого предсердия); 0.05 — только гигантские, как пограничная зона крупных; нижние границы убраны — учебники их не задают',
    remark: 'У кошек вторичный источник KAT22 даёт <0.035 с (первоисточник не назван) — в норму не взято.',
  },
  {
    key: 'pAmplitude',
    label: 'Амплитуда P',
    unit: MV,
    ranges: {
      'dog-small': range(MV, 'T&S-M; T92 (через CAR19); CHE17', { max: 0.4 }),
      'dog-large': range(MV, 'T&S-M; T92 (через CAR19); CHE17', { max: 0.4 }),
      cat: range(MV, 'T&S-M; CHE17', { max: 0.2 }),
    },
    previous: '0.08–0.40 / 0.08–0.30 / 0.04–0.20; FEATURES.md 0.15–0.40 / 0.1–0.2 (Varshney)',
    change:
      'крупные ≤0.40 (0.30 давало ложное превышение); деления по размеру ни в одном источнике нет; нижние границы убраны — низкий P норма, порог обнаружимости P живёт в профиле вида, не в норме',
  },
  {
    key: 'pq',
    label: 'Интервал PQ (PR)',
    unit: S,
    ranges: {
      'dog-small': range(S, 'T&S-M; T92 (через CAR19); KAT22; CHE17', { min: 0.06, max: 0.13 }),
      'dog-large': range(S, 'T&S-M; T92 (через CAR19); KAT22; CHE17', { min: 0.06, max: 0.13 }),
      cat: range(S, 'T&S-M; KAT22; CHE17', { min: 0.05, max: 0.09 }),
    },
    previous: '0.05–0.11 / 0.06–0.13 / 0.04–0.09; FEATURES.md 0.06–0.13 / 0.05–0.09',
    change:
      'мелкие → 0.06–0.13 без деления по размеру (PQ 0.12 у мелкой собаки давал ложное превышение, 0.05 — ложную норму); кошки: нижняя граница 0.05',
  },
  {
    key: 'qrs',
    label: 'Длительность QRS',
    unit: S,
    ranges: {
      'dog-small': range(S, 'T&S-M', { max: 0.05, borderMax: 0.06, borderSource: 'ПРОЕКТ' }),
      'dog-large': range(S, 'T&S-M; T92 (через CAR19)', { max: 0.06, borderMax: 0.07, borderSource: 'ПРОЕКТ' }),
      cat: range(S, 'T&S-M; CHE17', { max: 0.04, borderMax: 0.05, borderSource: 'ПРОЕКТ' }),
    },
    previous: 'в справочнике отсутствовал; лимит детектора `maxQRSms` 60/40; FEATURES.md 0.05 / 0.06 / 0.04',
    change:
      'добавлен по Tilley; пограничная зона +0.01 с вместо ±10 % — конвенция проекта (ПРОЕКТ): потолок точности листа (1 px ≈ 5 мс при 50 мм/с) делает зону в 4–6 мс бессмысленной; источники зоны не задают (вторичные KAT22, BRS дают лишь «<0.07 с у собак» — порог широкого QRS, не пограничную зону); лимит детектора должен быть выше нормы, иначе патологически широкий QRS не размечается',
  },
  {
    key: 'r',
    label: 'Амплитуда R',
    unit: MV,
    ranges: {
      'dog-small': range(MV, 'T&S-M; CHE17', { max: 2.5 }),
      'dog-large': range(MV, 'T&S-M; T92 (через CAR19)', { max: 3.0 }),
      cat: range(MV, 'T&S-M; CHE17', { max: 0.9 }),
    },
    previous: 'в справочнике отсутствовала; FEATURES.md мелкие 0.9–2.8, крупные 1.2–2.8 / 0.1–0.9 (Varshney)',
    change:
      'добавлена по Tilley; нижняя граница не задаётся — низкий вольтаж отдельный признак, порога в источниках нет (нижние границы были только у Varshney)',
  },
  {
    key: 's',
    label: 'Амплитуда S',
    unit: MV,
    ranges: { 'dog-small': null, 'dog-large': null, cat: null },
    previous: 'в справочнике отсутствовала',
    change: 'норматива в источниках не найдено — «норма не задана»: значение показывается без оценки и в заключение как отклонение не попадает',
  },
  {
    key: 'q',
    label: 'Амплитуда Q',
    unit: MV,
    ranges: {
      'dog-small': range(MV, 'CAR19 (по Tilley 1992 и Santilli 2018): «глубокий Q» >0.5 мВ; GAR13', {
        max: 0.5,
        abs: true,
        borderOnly: true,
        note: 'глубокий Q породозависим (глубокогрудые породы)',
      }),
      'dog-large': range(MV, 'CAR19 (по Tilley 1992 и Santilli 2018): «глубокий Q» >0.5 мВ; GAR13', {
        max: 0.5,
        abs: true,
        borderOnly: true,
        note: 'глубокий Q породозависим (глубокогрудые породы)',
      }),
      cat: null,
    },
    previous: 'в справочнике отсутствовала',
    change:
      'добавлена как признак, не как норма: |Q| >0.5 мВ — «глубокий Q», пограничное без красного (у 63 % здоровых доберманов, физиологичен у глубокогрудых); у кошек норматива не найдено',
  },
  {
    key: 'qt',
    label: 'Интервал QT',
    unit: S,
    ranges: {
      'dog-small': range(S, 'T&S-M; T92 (через CAR19); CHE17', { min: 0.15, max: 0.25, note: 'при нормальной ЧСС' }),
      'dog-large': range(S, 'T&S-M; T92 (через CAR19); CHE17', { min: 0.15, max: 0.25, note: 'при нормальной ЧСС' }),
      cat: range(S, 'T&S-M; CHE17', {
        min: 0.12,
        max: 0.18,
        borderMin: 0.09,
        borderMax: 0.2,
        borderSource: 'VAR-C (0.09–0.16), KAT22 (0.07–0.20)',
        note: 'при нормальной ЧСС',
      }),
    },
    previous: '0.12–0.24 / 0.14–0.26 / 0.10–0.20; FEATURES.md 0.15–0.25 / 0.09–0.18 и «коррекция 1/5»',
    change:
      'собаки обе группы 0.15–0.25 (деления по размеру нет); кошки 0.12–0.18 с серой зоной 0.09–0.20 (источники расходятся); QT укорачивается с ростом ЧСС — диапазон применим при ЧСС в норме; «коррекция 1/5» ни в одном источнике не найдена',
  },
  {
    key: 'qtc',
    label: 'QTc (Van de Water)',
    unit: S,
    ranges: { 'dog-small': null, 'dog-large': null, cat: null },
    previous: 'FEATURES.md: формула не названа («коррекция 1/5»)',
    change:
      'для собак показывается QTc = QT − 0.087·(RR − 1) (Van de Water — наименьшая зависимость от RR у здоровых собак: LIM14, SUL25, GON19); нормы QTc в источниках нет — без оценки; для кошек стандарта коррекции нет — только QT',
  },
  {
    key: 't',
    label: 'Амплитуда T',
    unit: MV,
    ranges: {
      'dog-small': range(MV, 'T&S-M (±0.05–1.0, любой знак); правило ≤25 % R — Tilley 1992 через ALM23, CHE17', {
        max: 1.0,
        abs: true,
        maxFractionOfR: 0.25,
        note: 'любой знак',
      }),
      'dog-large': range(MV, 'T&S-M (±0.05–1.0, любой знак); правило ≤25 % R — Tilley 1992 через ALM23, CHE17', {
        max: 1.0,
        abs: true,
        maxFractionOfR: 0.25,
        note: 'любой знак',
      }),
      cat: range(MV, 'T&S-M («обычно положительный, <0.3»); VAR-C (+/−/двухфазный допустим)', {
        max: 0.3,
        abs: true,
        negativeIsBorder: true,
        note: 'обычно положительный; отрицательный — пограничное',
      }),
    },
    previous: '0.05–0.35 / 0.05–0.30 / 0.03–0.25 абсолютные; FEATURES.md 0.15–0.50 / 0.0–0.2',
    change:
      'абсолютный потолок заменён правилом |T| ≤ 0.25·R плюс потолок 1.0 мВ (T = 0.5 при R = 2.5 — норма, прежний справочник давал превышение); отрицательный и двухфазный T у собак — не отклонение; нижняя граница убрана — плоский T у кошки норма',
  },
  {
    key: 'st',
    label: 'Сегмент ST',
    unit: MV,
    ranges: {
      'dog-small': range(MV, 'T&S-M (депрессия ≤0.2, элевация ≤0.15); CHE17', {
        min: -0.1,
        max: 0.1,
        borderMin: -0.2,
        borderMax: 0.15,
        borderSource: 'ПРОЕКТ',
        note: 'отрицательное — депрессия, положительное — элевация',
      }),
      'dog-large': range(MV, 'T&S-M (депрессия ≤0.2, элевация ≤0.15); CHE17', {
        min: -0.1,
        max: 0.1,
        borderMin: -0.2,
        borderMax: 0.15,
        borderSource: 'ПРОЕКТ',
        note: 'отрицательное — депрессия, положительное — элевация',
      }),
      cat: range(MV, 'T&S-M («отклонений быть не должно»); допуск 0.05 — ПРОЕКТ (потолок точности листа)', {
        min: -0.05,
        max: 0.05,
        borderMin: -0.1,
        borderMax: 0.1,
        borderSource: 'ПРОЕКТ',
        note: 'технический допуск листа ±0.05',
      }),
    },
    previous: '`st-analyzer.ts`: симметрично ±0.1 (собака) / ±0.08 (кошка); FEATURES.md: элевация >0.15, депрессия >0.2',
    change:
      'собаки асимметрично: депрессия >0.2 и элевация >0.15 — отклонение, 0.1–0.2 / 0.1–0.15 — пограничное (у 24 % здоровых собак есть девиация ST, медиана депрессии 0.1 — ROM22; серая зона внутри нормы Tilley — конвенция проекта, источник зоны — ПРОЕКТ); кошки: отклонение сверх допуска 0.05 мВ (≈2 px при 4.3 px/мм и 10 мм/мВ), 0.05–0.10 — пограничное, а не патология, из-за потолка точности',
  },
  {
    key: 'axis',
    label: 'Электрическая ось QRS',
    unit: DEG,
    ranges: {
      'dog-small': range(DEG, 'T&S-M; T92 (через CAR19); VAR-D; CHE17', {
        min: 40,
        max: 100,
        borderMin: 30,
        borderMax: 110,
        borderSource: 'ПРОЕКТ',
        note: '<+40 — отклонение влево, >+100 — вправо',
      }),
      'dog-large': range(DEG, 'T&S-M; T92 (через CAR19); VAR-D; CHE17', {
        min: 40,
        max: 100,
        borderMin: 30,
        borderMax: 110,
        borderSource: 'ПРОЕКТ',
        note: '<+40 — отклонение влево, >+100 — вправо',
      }),
      cat: range(DEG, 'T&S-M; VAR-C; CHE17', {
        min: 0,
        max: 160,
        borderMin: -10,
        borderMax: 170,
        borderSource: 'ПРОЕКТ',
        note: '<0 — отклонение влево, >+160 — вправо',
      }),
    },
    previous: 'REF-03: собаки +40…+100, кошки 0…+160',
    change:
      'без изменений — подтверждено четырьмя источниками; пограничная зона ±10° — инженерный допуск (точность оси по синтетике ±5°); у здоровых доберманов медиана +45 (−45…+90), левое отклонение у 39 % — породная особенность (CAR19)',
  },
];

/** Rhythm thresholds per species (specification §4; criteria — research-norms.md §4). */
export const RHYTHM_THRESHOLDS: Record<Species, RhythmThresholds> = {
  dog: {
    sinusArrhythmia: {
      rrVariation: 0.1,
      rrDeltaS: 0.12,
      normalForSpecies: true,
      source: '5MVC-SA (>10 % или ≥0.12 с между соседними P при P перед каждым QRS и стабильном PR); T&S-M, KIT-MVM, FOX03, DUR22 — вариант нормы у собак',
    },
    prematurity: {
      fraction: 0.2,
      source: 'ПРОЕКТ: RR < 80 % медианы RR; CARV18 задаёт индекс преждевременности (сцепление / длина синусового цикла) без порога',
    },
    wideQrs: {
      s: 0.07,
      confidentS: 0.08,
      source: 'T&S-M (верх нормы крупных 0.06); KAT22, BRS (>70 мс); PER25 (≥80 мс — широкий)',
    },
  },
  cat: {
    sinusArrhythmia: {
      rrVariation: 0.1,
      rrDeltaS: 0.1,
      normalForSpecies: false,
      source: '5MVC-SA (>10 % или ≥0.10 с); в клинике нехарактерна — 5MVC-SA, KIT-MVM, MIL13, HIL24; дома встречается часто — HAN09',
    },
    prematurity: {
      fraction: 0.2,
      source: 'ПРОЕКТ: RR < 80 % медианы RR; порога для кошек в источниках не найдено',
    },
    wideQrs: {
      s: 0.04,
      confidentS: 0.05,
      source: 'T&S-M (норма ≤0.04); KAT22, BRS (>40 мс); собачьи пороги 70–80 мс к кошкам неприменимы',
    },
  },
};

/** Discrepancies with the former documentation that are not tied to a table row. */
export interface ExtraChange {
  topic: string;
  previous: string;
  now: string;
  why: string;
}

export const EXTRA_CHANGES: readonly ExtraChange[] = [
  {
    topic: 'Обозначения экстрасистол',
    previous: 'FEATURES.md D-2: «VPC (НЖЭ…)», «APC (ЖЭ…)»',
    now: 'VPC = ventricular = желудочковая (ЖЭ); APC = atrial = наджелудочковая (НЖЭ)',
    why: 'расшифровки были перепутаны; в код не копировались',
  },
  {
    topic: 'Ширина QRS экстрасистолы',
    previous: 'FEATURES.md: ЖЭ «>80 мс», НЖЭ «<70 мс» без деления по видам (DUR22)',
    now: 'собака >70 мс (≥80 — уверенно), кошка >40 мс (≥50 — уверенно); сравнение с собственным доминирующим QRS животного',
    why: 'нормальный QRS кошки ≤40 мс — собачьи пороги к кошкам неприменимы; потолок точности ±10 мс требует пограничной зоны',
  },
  {
    topic: 'Синусовая аритмия у кошек',
    previous: 'AXIS-03: «патология у кошек»',
    now: '«для кошки в клинике нехарактерна, требует внимания» — классифицируется как отклонение, но не как безусловная патология',
    why: 'источники (5MVC-SA, KIT-MVM, MIL13, HAN09) описывают её как редкую в клинике и частую дома/во сне, а не как патологию в абсолютном виде',
  },
  {
    topic: 'Калибровка по умолчанию',
    previous: '`types/ecg.ts`: «стандарт 50 мм/с, 10 мм/мВ»; FEATURES.md: «стандарт 25 мм/с + 10 мм/мВ»',
    now: 'умолчание 50 мм/с и 10 мм/мВ; фактические значения читаются из футера листа; 25 мм/с и 5/20 мм/мВ равноправны',
    why: '10 мм/мВ — единый стандарт; 50 мм/с предпочтительна для промеров и кошек, 25 мм/с в ветеринарии равноправна (T&S-M, FRE08, AIS, DUR22, CHE17)',
  },
  {
    topic: 'Источник норм',
    previous: '`reference-ranges.ts`: «Консолидированный рабочий диапазон…» — не ссылка',
    now: 'у каждой строки — коды источников с пометкой доверия и датой проверки',
    why: 'откуда взяты прежние min/max, в проекте зафиксировано не было',
  },
  {
    topic: 'Пограничные дельты',
    previous: '`borderlineDelta` подобраны вручную (0.004–0.018 с, 0.02–0.04 мВ)',
    now: '±10 % от границы нормы наружу, если справочник не задаёт явную серую зону; явные зоны — QRS (+0.01 с), ST, ось (±10°), ЧСС и QT кошек',
    why: 'источники пограничных зон не дают; правило единое и документированное',
  },
];

/** What remains an assumption (research-norms.md §4.3). */
export const UNCONFIRMED: readonly string[] = [
  'Пороги «>70 мс / >40 мс» для широкого QRS и «P <35 мс у кошек» встречены только во вторичных источниках (KAT22, BRS) без ссылки на первоисточник; их принадлежность Santilli et al. 2018 — гипотеза.',
  'Порог преждевременности 20 % медианы RR — допущение проекта; дыхательная синусовая аритмия у собак может давать близкую вариацию RR, поэтому преждевременность оценивается вместе с морфологией и наличием P.',
  'Формула полной компенсаторной паузы «= 2 RR» — только по учебным конспектам.',
  'Нормы Q как «нормы» нет — есть определение глубокого Q (>0.5 мВ) и данные о его физиологичности у части пород.',
  'Нормы T и QT для кошек существенно расходятся между источниками; стандарта QTc для кошек нет.',
  'Santilli 2018, Côté «Feline Cardiology», Kittleson & Kienle, Мартин, Илларионова напрямую не открывались — их числа только через цитирующие источники.',
];

export function entryFor(key: NormKey): NormEntry | undefined {
  return NORM_ENTRIES.find((e) => e.key === key);
}
