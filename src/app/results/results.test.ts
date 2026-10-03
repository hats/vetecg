import { describe, expect, it } from 'vitest';
import { compose, precisionSentence } from '../../analysis/conclusion';
import { analyzePage } from '../../core/page';
import { POLYSPECTRUM } from '../../core/profile';
import type { CaseResult, ConclusionInputs, GrayImage, MeasuredValue, Measurements, PageBeats, PageResult, RhythmReport } from '../../types/contracts';
import { hashBytes } from '../files/hash';
import { activeCase, createCaseStore, type CaseState, type SheetInput } from '../state/case-store';
import { loadFixture, loadFixtureBytes } from '../../../test/fixtures';
import { buildResultsView, toClipboardText, toTsv } from './model';

// Synthetic cases shaped as store state. Expected strings come from the spec (stories 14, 26–27, 58, 67–72)
// and the conclusion dictionary; no expectation is computed by the code under test.

function mv(value: number | null, confidence = 0.9, reason?: string, source?: MeasuredValue['source']): MeasuredValue {
  const m: MeasuredValue = { value, unit: 'x', confidence, beats: [0, 1, 2] };
  if (reason) m.reason = reason;
  if (source) m.source = source;
  return m;
}

function measurements(over: Partial<Measurements> = {}): Measurements {
  return {
    hrMean: mv(92),
    hrMin: mv(78),
    hrMax: mv(110),
    pDuration: mv(0.04),
    pAmplitude: mv(0.2),
    pq: mv(0.1),
    q: mv(-0.3),
    qrs: mv(0.05),
    r: mv(1.8),
    s: mv(-0.4),
    qt: mv(0.2),
    qtc: mv(0.21),
    t: mv(0.3),
    st: mv(0),
    ...over,
  };
}

function rhythm(over: Partial<RhythmReport> = {}): RhythmReport {
  return { type: 'sinus', reasons: [], axisDeg: 65, sinusArrhythmia: false, ectopics: [], episodes: [], ...over };
}

/** Results need a sheet only for its `precision` field. */
function page(msPerPx = 4.65, mvPerPx = 0.023): PageResult {
  return { precision: { mvPerPx, msPerPx } } as unknown as PageResult;
}

interface CaseSpec {
  result?: Partial<CaseResult>;
  inputs?: Partial<ConclusionInputs>;
  settings?: Partial<CaseState['settings']>;
}

/** Case state with a conclusion built by the real `compose` (as the store does). */
function caseState(spec: CaseSpec = {}): CaseState {
  const inputs: ConclusionInputs = { species: 'dog', dogSize: 'large', drugs: '', monitoringMinutes: 5, flags: [], ...spec.inputs };
  const draft: CaseResult = {
    measurements: measurements(),
    rhythm: rhythm(),
    conclusion: { table: [], text: '' },
    confidence: 0.9,
    perPage: [page(), page(), page()],
    span: { durationMs: 15200, pages: 3 },
    flags: inputs.flags,
    ...spec.result,
  };
  const result: CaseResult = { ...draft, conclusion: compose(draft, inputs) };
  return {
    id: 'case-1',
    title: 'Случай 1',
    sheets: result.perPage.map((_, i) => ({ id: `sheet-${i + 1}`, name: `лист-${i + 1}.jpg`, hash: `h${i}`, status: 'done', attempt: 1 })),
    settings: {
      species: inputs.species,
      speciesSource: 'header',
      dogSize: inputs.dogSize,
      calib: { mmPerS: 50, mmPerMv: 10 },
      calibSource: 'default',
      drugs: inputs.drugs,
      monitoringMinutes: inputs.monitoringMinutes,
      minutesSource: 'pages',
      analyzeTogether: false,
      ...spec.settings,
    },
    edits: [],
    result,
    caseSheets: result.perPage.map((_, i) => `sheet-${i + 1}`),
    activeSheetId: 'sheet-1',
    warnings: [],
  };
}

const rowOf = (rows: { key: string }[], key: string) => {
  const found = rows.find((r) => r.key === key);
  if (!found) throw new Error(`нет строки ${key}`);
  return found as { key: string; label: string; value: string; norm: string; tone: string; note: string };
};

describe('results — normal dog', () => {
  const view = buildResultsView(caseState());

  it('table: compose parameter rows in order, HR with mean and range, colours by verdict, status "ready"', () => {
    expect(view.status).toBe('ready');
    expect(view.rows.map((r) => r.key)).toEqual(['hr', 'pDuration', 'pAmplitude', 'pq', 'q', 'qrs', 'r', 's', 'qt', 'qtc', 't', 'st', 'axis']);
    expect(rowOf(view.rows, 'hr')).toMatchObject({ label: 'ЧСС', value: '92 (78–110) уд/мин', norm: '70–160 уд/мин', tone: 'norm' });
    expect(rowOf(view.rows, 's')).toMatchObject({ value: '−0.4 мВ', norm: 'норма не задана', tone: 'none' });
    expect(rowOf(view.rows, 'axis')).toMatchObject({ value: '+65°', norm: '+40…+100°', tone: 'norm' });
  });

  it('extra rows: rhythm, ectopics and episodes «не выявлено», drugs «не указано», minutes «по листам»', () => {
    expect(view.extra.map((r) => r.label)).toEqual(['Ритм', 'Экстрасистолы', 'Эпизоды несинусового ритма', 'Препараты', 'Минуты мониторинга']);
    expect(rowOf(view.extra, 'rhythm')).toMatchObject({ value: 'синусовый', tone: 'norm', note: '' });
    expect(rowOf(view.extra, 'ectopics')).toMatchObject({ value: 'не выявлено', tone: 'norm' });
    expect(rowOf(view.extra, 'episodes')).toMatchObject({ value: 'не выявлено', tone: 'norm' });
    expect(rowOf(view.extra, 'drugs')).toMatchObject({ value: 'не указано', tone: 'none' });
    expect(rowOf(view.extra, 'minutes')).toMatchObject({ value: '5 мин', note: 'по листам', tone: 'none' });
  });

  it('conclusion text comes from compose, last line is about verification; analysis is possible', () => {
    expect(view.impossible).toBe(false);
    const lines = view.text.split('\n');
    expect(lines[0]).toBe('Ритм синусовый. ЧСС 92 уд/мин (78–110), норма 70–160 уд/мин.');
    expect(lines[lines.length - 1]).toBe('Заключение требует верификации специалистом.');
  });
});

describe('results — unreliable rows and notes from the task 07 review', () => {
  const view = buildResultsView(
    caseState({
      result: {
        measurements: measurements({
          hrMean: mv(92, 0.9, undefined, 'all_leads'),
          hrMin: mv(78, 0.9, undefined, 'all_leads'),
          hrMax: mv(110, 0.9, undefined, 'all_leads'),
          pq: mv(0.09, 0.3, 'lead_ii_unreliable'),
          pAmplitude: mv(null, 0, 'p_not_found'),
          q: mv(0, 0.9, 'q_absent'),
          s: mv(0, 0.9, 's_absent'),
        }),
        rhythm: rhythm({ axisDeg: null }),
      },
    }),
  );

  it('unreliable measurement — «ненадёжно, проверьте разметку» and a reason instead of the number; the number is not shown', () => {
    expect(rowOf(view.rows, 'pq')).toMatchObject({ value: 'ненадёжно, проверьте разметку', note: 'отведение II ненадёжно', tone: 'unreliable' });
    expect(rowOf(view.rows, 'pq').value).not.toContain('0.09');
    expect(rowOf(view.rows, 'pAmplitude')).toMatchObject({ value: 'ненадёжно, проверьте разметку', note: 'зубец P не найден', tone: 'unreliable' });
    expect(rowOf(view.rows, 'axis')).toMatchObject({ value: 'ненадёжно, проверьте разметку', note: 'ось не определена', tone: 'unreliable' });
  });

  it('HR from lead consensus is marked «по всем отведениям», the number stays', () => {
    expect(rowOf(view.rows, 'hr')).toMatchObject({ value: '92 (78–110) уд/мин', tone: 'norm' });
    expect(rowOf(view.rows, 'hr').note).toContain('по всем отведениям');
  });

  it('note «по всем отведениям» — on any value with source all_leads, not only HR; lead_ii and no source — no note', () => {
    const v = buildResultsView(
      caseState({
        result: {
          measurements: measurements({
            qrs: mv(0.05, 0.9, undefined, 'all_leads'),
            qt: mv(0.2, 0.9, undefined, 'all_leads'),
            r: mv(1.8, 0.9, undefined, 'lead_ii'),
          }),
        },
      }),
    );
    expect(rowOf(v.rows, 'qrs')).toMatchObject({ value: '0.05 с', tone: 'norm' });
    expect(rowOf(v.rows, 'qrs').note).toContain('по всем отведениям');
    expect(rowOf(v.rows, 'qt').note).toContain('по всем отведениям');
    expect(rowOf(v.rows, 'r').note).not.toContain('по всем отведениям');
    expect(rowOf(v.rows, 'pq').note).not.toContain('по всем отведениям');
    expect(rowOf(v.rows, 'hr').note).not.toContain('по всем отведениям');
  });

  it('annotated zero Q and S — «Q не выражен» / «S не выражен», the norm explanation is kept', () => {
    expect(rowOf(view.rows, 'q')).toMatchObject({ value: '0 мВ', tone: 'norm' });
    expect(rowOf(view.rows, 'q').note).toContain('Q не выражен');
    expect(rowOf(view.rows, 'q').note).toContain('глубокий Q породозависим');
    expect(rowOf(view.rows, 's')).toMatchObject({ value: '0 мВ', tone: 'none' });
    expect(rowOf(view.rows, 's').note).toBe('S не выражен');
  });
});

describe('results — case notes', () => {
  /** How many times a line occurs among the text lines. */
  const countLines = (text: string, line: string) => text.split('\n').filter((l) => l === line).length;

  it('precision ceiling — exactly one line, literally precisionSentence from conclusion; not duplicated in clipboard or print', () => {
    const view = buildResultsView(caseState({ result: { perPage: [page(4.65, 0.023), page(4.0, 0.02), page(3.9, 0.019)] } }));
    const expected = precisionSentence(caseState({ result: { perPage: [page(4.65, 0.023)] } }).result!);
    expect(expected).toMatch(/^Потолок точности листа: 1 px = /);
    // The coarsest sheet defines the ceiling; the line is in the conclusion text and is not repeated as a separate note.
    expect(countLines(view.text, expected)).toBe(1);
    expect(view.notes.some((n) => n.includes('Потолок точности'))).toBe(false);
    expect(toClipboardText(view).split('Потолок точности')).toHaveLength(2);
  });

  it('excluded sheets (another animal) do not count toward the precision ceiling', () => {
    const view = buildResultsView(caseState({ result: { perPage: [page(4.65, 0.023), page(10, 0.05)], analyzed: [0] } }));
    const own = precisionSentence({ perPage: [page(4.65, 0.023)] });
    expect(own).not.toBe(precisionSentence({ perPage: [page(4.65, 0.023), page(10, 0.05)] }));
    expect(countLines(view.text, own)).toBe(1);
  });

  it('grid not recognized (precision 0) — ceiling honestly "not determined", once', () => {
    const view = buildResultsView(caseState({ result: { perPage: [page(0, 0)], span: { durationMs: 5200, pages: 1 } } }));
    expect(countLines(view.text, 'Потолок точности не определён: сетка листа не распознана.')).toBe(1);
    expect(toClipboardText(view).split('Потолок точности')).toHaveLength(2);
  });

  it('case flags — manual correction and "together anyway"; precision_ceiling gives no separate note', () => {
    const view = buildResultsView(caseState({ inputs: { flags: ['manual_correction', 'precision_ceiling', 'analyze_together_forced', 'unknown_flag'] } }));
    expect(view.notes).toContain('Разметка скорректирована вручную.');
    expect(view.notes).toContain('Листы разных животных проанализированы вместе по решению пользователя.');
    expect(view.notes).toHaveLength(2);
    expect(view.notes.join('\n')).not.toContain('unknown_flag');
  });
});

describe('results — cat: no QTc, sinus arrhythmia, ectopics and an episode', () => {
  const view = buildResultsView(
    caseState({
      inputs: { species: 'cat', dogSize: undefined, monitoringMinutes: undefined },
      result: {
        measurements: measurements({
          hrMean: mv(190),
          hrMin: mv(150),
          hrMax: mv(230),
          pDuration: mv(0.03),
          pAmplitude: mv(0.1),
          pq: mv(0.07),
          q: mv(null, 0, 'q_absent'),
          qrs: mv(0.035),
          r: mv(0.6),
          s: mv(-0.2),
          qt: mv(0.15),
          qtc: mv(null, 0, 'species_not_applicable'),
          t: mv(0.1),
          st: mv(0.02),
        }),
        rhythm: rhythm({
          axisDeg: 90,
          sinusArrhythmia: true,
          ectopics: [
            { beat: 4, kind: 'SVE', focus: 'atrial', couplingMs: 240 },
            { beat: 9, kind: 'SVE', focus: 'atrial', couplingMs: 260 },
            { beat: 15, kind: 'SVE', focus: 'junctional', couplingMs: 250 },
          ],
          episodes: [{ startMs: 2400, durationMs: 1100, kind: 've_run', focus: 'right_ventricle', couplingMs: 310, beats: [10, 11, 12] }],
        }),
        perPage: [page(), page()],
        span: { durationMs: 10400, pages: 2 },
      },
    }),
  );

  it('no QTc row; monitoring minutes «не указано»', () => {
    expect(view.rows.some((r) => r.key === 'qtc')).toBe(false);
    expect(rowOf(view.extra, 'minutes')).toMatchObject({ value: 'не указано', note: '' });
  });

  it('sinus rhythm with note «синусовая аритмия (патология)» — red for a cat', () => {
    expect(rowOf(view.extra, 'rhythm')).toMatchObject({ value: 'синусовый', note: 'синусовая аритмия (патология)', tone: 'abnormal' });
  });

  it('ectopics: count, type, "approximate" focus and coupling interval — red', () => {
    expect(rowOf(view.extra, 'ectopics')).toMatchObject({
      value: '3 наджелудочковые (очаг ориентировочно предсердный — 2, АВ-узловой — 1), интервал сцепления 240–260 мс (в среднем 250 мс)',
      tone: 'abnormal',
    });
  });

  it('episodes: count and list with start time, duration, focus and coupling', () => {
    expect(rowOf(view.extra, 'episodes')).toMatchObject({
      value: '1 эпизод',
      note: 'пробежка желудочковых экстрасистол с 2.4 с, длительность 1.1 с, 3 удара, очаг ориентировочно правый желудочек, сцепление 310 мс',
      tone: 'abnormal',
    });
  });
});

describe('results — unreliable beats: ectopics and episodes are not «не выявлено» (blind acceptance, task 13)', () => {
  /** A sheet with one beat and six leads of the given confidence. */
  function pageBeats(confidence: number): PageBeats {
    const signal = (id: string) => ({ id, fs: 500, t0: 0, mv: new Float32Array(10), baselineY: 0, confidence, unreliable: [] });
    return {
      page: 0,
      offsetMs: 0,
      beats: [{ index: 0, tMs: 100, perLead: {}, confidence, reasons: [] }],
      delineations: [],
      signals: ['I', 'II', 'III', 'aVR', 'aVL', 'aVF'].map(signal),
    } as unknown as PageBeats;
  }

  const expectUnreliable = (view: ReturnType<typeof buildResultsView>, reason: string) => {
    for (const key of ['ectopics', 'episodes']) {
      expect(rowOf(view.extra, key)).toMatchObject({ value: 'ненадёжно, проверьте разметку', note: reason, tone: 'unreliable' });
    }
    expect(toTsv(view)).not.toMatch(/Экстрасистолы\tне выявлено|Эпизоды несинусового ритма\tне выявлено/);
  };

  it('all leads unreliable — «ненадёжно, проверьте разметку» with reason «все отведения ненадёжны», as in the text', () => {
    const view = buildResultsView(caseState({ result: { beats: [pageBeats(0.1)] } }));
    expectUnreliable(view, 'все отведения ненадёжны');
    expect(view.text).toContain('Экстрасистолы: ненадёжно, проверьте разметку (все отведения ненадёжны).');
  });

  it('no beats found (foreign image, rhythm reason no_beats) — also "unreliable" with a reason', () => {
    const view = buildResultsView(caseState({ result: { rhythm: rhythm({ type: 'undetermined', reasons: ['no_beats'] }) } }));
    expectUnreliable(view, 'удары не найдены');
  });

  it('reliable beats with no findings — still «не выявлено», green', () => {
    const view = buildResultsView(caseState({ result: { beats: [pageBeats(0.9)] } }));
    expect(rowOf(view.extra, 'ectopics')).toMatchObject({ value: 'не выявлено', tone: 'norm' });
    expect(rowOf(view.extra, 'episodes')).toMatchObject({ value: 'не выявлено', tone: 'norm' });
  });
});

describe('results — pause from RhythmReport.pauses in the rhythm row', () => {
  it('pause duration in ms and start time; no sinus arrhythmia verdict (as in the text); yellow — needs review', () => {
    const view = buildResultsView(
      caseState({ result: { rhythm: rhythm({ sinusArrhythmia: true, pauses: [{ beat: 5, startMs: 3210.4, durationMs: 1843.6 }] }) } }),
    );
    const row = rowOf(view.extra, 'rhythm');
    // By hand: 1843.6 → 1844 ms; 3.2104 → 3.21 s.
    expect(row.note).toContain('пауза 1844 мс (с 3.21 с)');
    expect(row.note).not.toContain('синусовая аритмия');
    expect(row.tone).toBe('border');
    expect(view.text).toContain('Пауза 1844 мс (с 3.21 с)');
    expect(toTsv(view)).toContain('пауза 1844 мс (с 3.21 с)');
  });
});

describe('results — rhythm numbers in norms format, as in the conclusion text', () => {
  const view = buildResultsView(
    caseState({
      result: {
        rhythm: rhythm({
          ectopics: [{ beat: 4, kind: 'VE', focus: 'left_ventricle', couplingMs: 243.7 }],
          episodes: [{ startMs: 2456.4, durationMs: 1123.9, kind: 've_run', focus: 'right_ventricle', couplingMs: 312.6, beats: [10, 11, 12] }],
        }),
      },
    }),
  );

  it('seconds to 0.01, ms as integers; same notation as in the conclusion text', () => {
    // By hand: 243.7 → 244 ms; 2.4564 → 2.46 s; 1.1239 → 1.12 s; 312.6 → 313 ms.
    expect(rowOf(view.extra, 'ectopics').value).toContain('интервал сцепления 244 мс');
    const note = rowOf(view.extra, 'episodes').note;
    expect(note).toContain('с 2.46 с, длительность 1.12 с');
    expect(note).toContain('сцепление 313 мс');
    expect(view.text).toContain(note);
  });
});

describe('results — rhythm interpretation', () => {
  it('dog with sinus arrhythmia — «вариант нормы» ("normal variant"), green', () => {
    const view = buildResultsView(caseState({ result: { rhythm: rhythm({ sinusArrhythmia: true }) } }));
    expect(rowOf(view.extra, 'rhythm')).toMatchObject({ value: 'синусовый', note: 'синусовая аритмия (вариант нормы)', tone: 'norm' });
  });

  it('non-sinus rhythm — red, reason in dictionary words', () => {
    const view = buildResultsView(caseState({ result: { rhythm: rhythm({ type: 'non_sinus', reasons: ['p_not_found', 'pq_unstable'] }) } }));
    expect(rowOf(view.extra, 'rhythm')).toMatchObject({ value: 'несинусовый', note: 'зубец P не найден, интервал PQ непостоянен', tone: 'abnormal' });
  });

  it('rhythm undetermined — shown as unreliable, with a reason', () => {
    const view = buildResultsView(caseState({ result: { rhythm: rhythm({ type: 'undetermined', reasons: ['lead_ii_unreliable'] }) } }));
    expect(rowOf(view.extra, 'rhythm')).toMatchObject({ value: 'не определён', note: 'отведение II ненадёжно', tone: 'unreliable' });
  });
});

describe('results — copying: table TSV, notes and conclusion text (story 71)', () => {
  const view = buildResultsView(caseState({ inputs: { drugs: 'пимобендан 0.25 мг/кг' } }));
  const tsv = toTsv(view);
  const lines = tsv.split('\n');

  it('TSV: header, 13 parameter rows and 5 extra, verdict in Russian words, no English codes', () => {
    expect(lines[0]).toBe('Параметр\tЗначение\tНорма\tОценка\tПримечание');
    expect(lines).toHaveLength(1 + 13 + 5);
    expect(lines[1]).toBe('ЧСС\t92 (78–110) уд/мин\t70–160 уд/мин\tнорма\tгигантские породы 60–140 — пограничная зона 60–70');
    expect(lines.find((l) => l.startsWith('Амплитуда S\t'))).toBe('Амплитуда S\t−0.4 мВ\tнорма не задана\t—\t');
    expect(lines.find((l) => l.startsWith('Экстрасистолы\t'))).toBe('Экстрасистолы\tне выявлено\t\tнорма\t');
    expect(lines.find((l) => l.startsWith('Препараты\t'))).toBe('Препараты\tпимобендан 0.25 мг/кг\t\t\t');
    expect(tsv).not.toMatch(/\b(norm|border|abnormal|n\/a)\b/);
  });

  it('clipboard text: TSV, blank line, conclusion (no notes — block omitted); last line is about verification', () => {
    const text = toClipboardText(view);
    const parts = text.split('\n\n');
    expect(parts[0]).toBe(tsv);
    expect(parts[1]).toBe(view.text);
    expect(text.split('Потолок точности')).toHaveLength(2);
    expect(text).toContain('Препараты: пимобендан 0.25 мг/кг.');
    expect(text.split('\n').at(-1)).toBe('Заключение требует верификации специалистом.');
  });

  it('impossible analysis: unreliable TSV rows with a reason, text «Автоматический анализ невозможен» and the verification line', () => {
    const unreliable = (value: number | null) => mv(value, 0.3, 'lead_ii_unreliable');
    const bad = buildResultsView(
      caseState({
        result: {
          measurements: measurements({
            hrMean: unreliable(100),
            hrMin: unreliable(90),
            hrMax: unreliable(112),
            pDuration: unreliable(null),
            pAmplitude: unreliable(null),
            pq: unreliable(0.09),
            q: unreliable(null),
            qrs: unreliable(null),
            r: unreliable(null),
            s: unreliable(null),
            qt: unreliable(null),
            qtc: unreliable(null),
            t: unreliable(null),
            st: unreliable(null),
          }),
          rhythm: rhythm({ type: 'undetermined', reasons: ['lead_ii_unreliable'], axisDeg: null }),
        },
      }),
    );
    expect(bad.impossible).toBe(true);
    expect(bad.rows.every((r) => r.tone === 'unreliable')).toBe(true);
    expect(toTsv(bad).split('\n')[1]).toBe('ЧСС\tненадёжно, проверьте разметку\t70–160 уд/мин\tненадёжно\tотведение II ненадёжно');
    const text = toClipboardText(bad);
    expect(text).toContain('Автоматический анализ невозможен: отведение II ненадёжно.');
    expect(text).not.toContain('0.09');
    expect(text.split('\n').at(-1)).toBe('Заключение требует верификации специалистом.');
  });
});

describe('results — real sheet through the store (dog a-01)', () => {
  const analyzeSheet = (image: GrayImage) => Promise.resolve(analyzePage(image, POLYSPECTRUM));
  const inputOf = (name: 'a-01'): SheetInput => {
    const image = loadFixture(name);
    return { name: `${name}.jpg`, hash: hashBytes(loadFixtureBytes(name)), image, width: image.width, height: image.height };
  };

  it('full table, precision ceiling with real numbers, conclusion with verification; TSV of 19 lines', async () => {
    const store = createCaseStore({ analyzeSheet });
    store.addSheets([inputOf('a-01')]);
    await store.whenIdle();
    const view = buildResultsView(activeCase(store.getState()));
    expect(view.status).toBe('ready');
    expect(view.rows.map((r) => r.key)).toEqual(['hr', 'pDuration', 'pAmplitude', 'pq', 'q', 'qrs', 'r', 's', 'qt', 'qtc', 't', 'st', 'axis']);
    expect(view.extra).toHaveLength(5);
    // Variant A at 50/10: 1 px ≈ 0.023 mV and ≈ 4.65 ms (task 05 measurements) — numbers from the sheet, not zeros or "?".
    const result = activeCase(store.getState()).result!;
    const precision = precisionSentence(result);
    expect(precision).toMatch(/^Потолок точности листа: 1 px = 0\.0\d+ мВ \/ [\d.]+ мс; точность измерений не лучше ±2 px/);
    expect(view.text.split('\n').filter((l) => l === precision)).toHaveLength(1);
    expect(toClipboardText(view).split('Потолок точности')).toHaveLength(2);
    expect(rowOf(view.rows, 'hr').tone).not.toBe('unreliable');
    expect(view.text.split('\n').at(-1)).toBe('Заключение требует верификации специалистом.');
    expect(toTsv(view).split('\n')).toHaveLength(19);
  });

  it('"no lead" edit for II: HR marked «по всем отведениям», lead II measurements unreliable, manual correction note', async () => {
    const store = createCaseStore({ analyzeSheet });
    store.addSheets([inputOf('a-01')]);
    await store.whenIdle();
    store.addEdit({ kind: 'leadLabel', page: 0, lead: 'II', as: null });
    const view = buildResultsView(activeCase(store.getState()));
    expect(rowOf(view.rows, 'hr').note).toContain('по всем отведениям');
    expect(rowOf(view.rows, 'pq').tone).toBe('unreliable');
    expect(rowOf(view.rows, 'pq').value).toBe('ненадёжно, проверьте разметку');
    expect(view.notes).toContain('Разметка скорректирована вручную.');
  });
});
