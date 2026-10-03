/**
 * Renders the document `docs/normy-ekg.md` from the reference data (`data.ts`, `sources.ts`).
 * The document is a file snapshot of the `doc.test.ts` test; to update: `npx vitest run src/analysis/norms -u`.
 */
import {
  EXTRA_CHANGES,
  NORM_ENTRIES,
  NORM_PROFILES,
  NORMS_CHECK_DATE,
  RHYTHM_THRESHOLDS,
  UNCONFIRMED,
  type NormEntry,
  type ProfileId,
} from './data';
import { SIGNED_KEYS, num, rangeText } from './format';
import { NORM_SOURCES } from './sources';
import { BORDER_FRACTION } from './index';

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function profileIds(): ProfileId[] {
  return NORM_PROFILES.map((p) => p.id);
}

function normCell(entry: NormEntry, profile: ProfileId): string {
  const range = entry.ranges[profile];
  const text = rangeText(range, SIGNED_KEYS.has(entry.key));
  return range?.note ? `${text}; ${range.note}` : text;
}

function sourcesCell(entry: NormEntry): string {
  const seen = new Map<string, string[]>();
  for (const profile of NORM_PROFILES) {
    const range = entry.ranges[profile.id];
    if (!range) continue;
    // The borderline-zone source is listed separately from the norm source (task 13): project conventions are marked «ПРОЕКТ».
    const source = range.borderSource ? `${range.source}; пограничная зона — ${range.borderSource}` : range.source;
    const list = seen.get(source) ?? [];
    list.push(profile.label.toLowerCase());
    seen.set(source, list);
  }
  if (seen.size === 0) return '—';
  if (seen.size === 1) return [...seen.keys()][0];
  return [...seen.entries()].map(([source, labels]) => `${labels.join(', ')}: ${source}`).join('; ');
}

function normsTable(): string {
  const head = `| Параметр | ${NORM_PROFILES.map((p) => p.label).join(' | ')} | Источник |`;
  const sep = `|---|${NORM_PROFILES.map(() => '---').join('|')}|---|`;
  const rows = NORM_ENTRIES.map((entry) => {
    const cells = profileIds().map((id) => cell(normCell(entry, id)));
    return `| ${entry.label}, ${entry.unit} | ${cells.join(' | ')} | ${cell(sourcesCell(entry))} |`;
  });
  return [head, sep, ...rows].join('\n');
}

function thresholdsSection(): string {
  const dog = RHYTHM_THRESHOLDS.dog;
  const cat = RHYTHM_THRESHOLDS.cat;
  const pct = (x: number) => `${num(x * 100)} %`;
  return [
    '### Синусовая аритмия',
    '',
    `Критерий: вариация длины синусового цикла больше ${pct(dog.sinusArrhythmia.rrVariation)} или разброс соседних RR не меньше ${num(dog.sinusArrhythmia.rrDeltaS)} с у собак и ${num(cat.sinusArrhythmia.rrDeltaS)} с у кошек при P перед каждым QRS, положительном P в I, II, III, aVF и относительно постоянном PR.`,
    '',
    `- Собаки — ${dog.sinusArrhythmia.normalForSpecies ? 'вариант нормы (дыхательная)' : 'отклонение'}. Источники: ${dog.sinusArrhythmia.source}.`,
    `- Кошки — ${cat.sinusArrhythmia.normalForSpecies ? 'вариант нормы' : 'классифицируется как отклонение (AXIS-03) с формулировкой «для кошки в клинике нехарактерна, требует внимания»'}. Источники: ${cat.sinusArrhythmia.source}.`,
    '',
    'Формулировка заключения: «Синусовая аритмия. У собак — вариант нормы (дыхательная). У кошек в условиях клиники встречается редко и может указывать на повышенный парасимпатический тонус или заболевание (дыхательные пути, ЖКТ, ЦНС) — рекомендуется клиническая оценка; при домашней записи у здоровых кошек встречается часто». Жёсткая формулировка «патология у кошек» источниками в абсолютном виде не поддерживается.',
    '',
    '### Экстрасистолы',
    '',
    '| Признак | Наджелудочковая (НЖЭ, APC/SVPC) | Желудочковая (ЖЭ, VPC) | Источники |',
    '|---|---|---|---|',
    '| Преждевременность | есть | есть | ETT04, SLE-CVMA, KIT-MVM |',
    '| Зубец P | есть, преждевременный, изменённой формы (P′), может лежать на предыдущем T | отсутствует перед комплексом или диссоциирован от QRS | MIL13, ETT04, 5MVC-VPC, KIT-MVM |',
    '| QRS | узкий, морфология доминирующего (кроме аберрантного проведения) | широкий и «причудливый», морфология иная | MIL13, ETT04, 5MVC-VPC, KIT-MVM |',
    `| Порог «широкого» QRS | — | собака > ${num(dog.wideQrs.s)} с (≥ ${num(dog.wideQrs.confidentS)} — уверенно); кошка > ${num(cat.wideQrs.s)} с (≥ ${num(cat.wideQrs.confidentS)} — уверенно); сравнивать с собственным доминирующим QRS животного | ${dog.wideQrs.source}; ${cat.wideQrs.source} |`,
    '| Зубец T экстрасистолы | как у синусового | крупный, противоположной QRS полярности | KIT-MVM |',
    '| Пауза после | некомпенсаторная (синусовый узел разряжается) | обычно компенсаторная | SLE-CVMA, ETT04, 5MVC-VPC |',
    '| Интервал сцепления | от P′ или предшествующего QRS до эктопического комплекса | RR от предшествующего синусового комплекса до ЖЭ; индекс преждевременности = сцепление / длина синусового цикла | CARV18 |',
    '| Очаг | предсердный / АВ-узловой — по P′ и PQ; всегда «ориентировочно» | левый / правый желудочек — по полярности в I и aVF; всегда «ориентировочно» | правило проекта по спецификации |',
    '| Эпизод | ≥ 3 подряд эктопических удара или участок без P ≥ 3 ударов; НЖТ — > 3 узких комплексов с регулярным RR, ЧСС > 200 (собаки) | ≥ 3 подряд ЖЭ; ЖТ — > 3 широких комплексов, ЧСС > 180 (собаки), АВ-диссоциация; пароксизм < 30 с | CARV18 (пороги для собак; для кошек не найдено) |',
    '',
    `Преждевременность: RR < (1 − ${pct(dog.prematurity.fraction)}) × медианы RR. Источник: ${dog.prematurity.source}.`,
    '',
    'У здоровых кошек дома (HAN09, Холтер 24 ч, n = 23) ЖЭ встречались у 78 %, медиана 3 за сутки: единичные ЖЭ за 1–5-минутную запись сами по себе заключения «патология» не дают.',
  ].join('\n');
}

function changesTable(): string {
  const head = '| Параметр | Было (прежние справочники проекта) | Стало | Почему |';
  const sep = '|---|---|---|---|';
  const rows = NORM_ENTRIES.map((entry) => {
    const now = profileIds()
      .map((id, i) => `${NORM_PROFILES[i].label.toLowerCase()}: ${rangeText(entry.ranges[id], SIGNED_KEYS.has(entry.key))}`)
      .join('; ');
    return `| ${entry.label} | ${cell(entry.previous)} | ${cell(now)} | ${cell(entry.change)} |`;
  });
  const extra = EXTRA_CHANGES.map((c) => `| ${c.topic} | ${cell(c.previous)} | ${cell(c.now)} | ${cell(c.why)} |`);
  return [head, sep, ...rows, ...extra].join('\n');
}

function sourcesTable(): string {
  const head = '| Код | Доверие | Источник | Ссылка |';
  const sep = '|---|---|---|---|';
  const rows = NORM_SOURCES.map((s) => `| ${s.code} | [${s.trust}] | ${cell(s.title)} | ${s.url ? `<${s.url}>` : '—'} |`);
  return [head, sep, ...rows].join('\n');
}

export function renderNormsDoc(): string {
  const remarks = NORM_ENTRIES.filter((e) => e.remark).map((e) => `- **${e.label}.** ${e.remark}`);
  return [
    '# Нормы ЭКГ собак и кошек (II отведение)',
    '',
    '> Файл собирается из данных `src/analysis/norms/data.ts` и `sources.ts` тестом-снимком `src/analysis/norms/doc.test.ts` — те же данные отдаёт `getNorms`. Не править руками: изменить данные и выполнить `npx vitest run src/analysis/norms -u`.',
    '',
    `Дата независимой проверки источников: ${NORMS_CHECK_DATE} (\`research-norms.md\` в папке прогона автопилота). Значения — для II отведения, правое боковое положение, покой. Опорный источник — таблица 3-1 Tilley & Smith (T&S-M) и Tilley 1992 (T92); остальные приведены там, где уточняют или расходятся. Пометки доверия у источников: [О] — открыт, число процитировано дословно; [В] — через вторичный источник, который его цитирует; [Н] — подтвердить не удалось.`,
    '',
    '## Профили',
    '',
    '| Профиль | Соответствие у Tilley & Smith |',
    '|---|---|',
    ...NORM_PROFILES.map((p) => `| ${p.label} | ${p.mapping} |`),
    '',
    'Собака без указанного размера получает таблицу крупной (стандартные породы). Щенки (ЧСС до 220) и гигантские породы (ЧСС 60–140, P до 0.05 с) отдельного профиля не имеют: их значения отражены пограничными зонами крупной собаки.',
    '',
    '## Таблица норм',
    '',
    normsTable(),
    '',
    ...(remarks.length ? [...remarks, ''] : []),
    '## Правила классификации',
    '',
    '- **Норма** (зелёный) — значение внутри диапазона, границы включительно.',
    `- **Пограничное** (жёлтый) — явная серая зона справочника (в таблице — «пограничное от/до», её источник — в столбце «Источник» после слов «пограничная зона») или, если её нет, ±${num(BORDER_FRACTION * 100)} % от границы нормы наружу (конвенция проекта, источник «ПРОЕКТ»). Зоны, которых источники не называют (QRS +0.01 с, ST, ось ±10°), помечены «ПРОЕКТ».`,
    '- **Отклонение** (красный) — за пределами пограничной зоны.',
    '- **Норма не задана** (серый) — S, QTc, ЧСС мин/макс, Q у кошек: значение показывается, в заключение как отклонение не попадает.',
    '- Ненадёжные измерения (уверенность ниже 0.6) не классифицируются и в тексте заключения числом не фигурируют — только названием параметра.',
    '- **T у собак**: |T| ≤ 25 % R при любом знаке (отрицательный и двухфазный — не отклонение) и ≤ 1.0 мВ; без надёжного R действует только потолок. **T у кошек**: обычно положительный, < 0.3 мВ; отрицательный — пограничное.',
    '- **ST**: отрицательное значение — депрессия, положительное — элевация. У собак асимметрично: депрессия > 0.2 и элевация > 0.15 мВ — отклонение, от 0.1 — пограничное. У кошек отклонений быть не должно; технический допуск листа 0.05 мВ (≈ 2 px при 4.3 px/мм и 10 мм/мВ), 0.05–0.10 — пограничное.',
    '- **Глубокий Q** (|Q| > 0.5 мВ у собак) — пограничное, никогда не красный: породозависимая находка (глубокогрудые породы).',
    '- **Ось**: ниже нижней границы — отклонение влево, выше верхней — вправо; ±10° — пограничное. Ось не определена, если I или aVF ненадёжны.',
    '- **QT** оценивается при ЧСС в норме (QT укорачивается с ростом ЧСС). **QTc** по Van de Water (QT − 0.087·(RR − 1)) показывается у собак без оценки; у кошек стандарта коррекции нет.',
    '',
    '## Ритм и аритмии',
    '',
    thresholdsSection(),
    '',
    '## Расхождения с прежними справочниками и что изменено',
    '',
    'Прежние справочники (`reference-ranges.ts`, `species-profiles.ts`, `st-analyzer.ts`, `FEATURES.md` TS-2) удалены вместе со старым `src/`; их значения приведены по `research-norms.md`. Нижние границы P (0.15), R (0.9/1.2), T (0.15) и ЧСС «70–170/80–170» прежней документации взяты из главы Varshney (Springer 2020) с внутренними несоответствиями — для нормативов опора на Tilley & Smith, Varshney только как второе мнение.',
    '',
    changesTable(),
    '',
    '## Не подтверждено и остаётся допущением',
    '',
    ...UNCONFIRMED.map((u) => `- ${u}`),
    '',
    '## Источники',
    '',
    sourcesTable(),
    '',
  ].join('\n');
}
