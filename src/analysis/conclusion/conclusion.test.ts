import { describe, expect, it } from 'vitest';
import type { CaseResult, LeadSignal, MeasuredValue, Measurements, PageBeats, PageResult, RhythmReport } from '../../types/contracts';
import { beatsUnreliableReason, compose, precisionSentence } from './index';
import { analyzeCase } from '../case';
import { analyzePage } from '../../core/page';
import { POLYSPECTRUM } from '../../core/profile';
import { getFixture, loadFixture } from '../../../test/fixtures';

// Synthetic cases. Expected lines come from the specification wording (§3 «Заключение», stories 67–70),
// norm numbers from the §4 decisions; no expectation is computed by the code under test.

function mv(value: number | null, confidence = 0.9, reason?: string): MeasuredValue {
  const unit = 'x';
  return reason ? { value, unit, confidence, beats: [0, 1, 2], reason } : { value, unit, confidence, beats: [0, 1, 2] };
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

/** The conclusion needs only the sheet's `precision` field; the rest is outside the `compose` seam. */
function page(msPerPx = 4.65, mvPerPx = 0.023): PageResult {
  return { precision: { mvPerPx, msPerPx } } as unknown as PageResult;
}

function caseResult(over: Partial<CaseResult> = {}): CaseResult {
  return {
    measurements: measurements(),
    rhythm: rhythm(),
    conclusion: { table: [], text: '' },
    confidence: 0.9,
    perPage: [page(), page(), page()],
    span: { durationMs: 15200, pages: 3 },
    ...over,
  };
}

const row = (table: { key: string }[], key: string) => {
  const found = table.find((r) => r.key === key);
  if (!found) throw new Error(`нет строки ${key}`);
  return found as { key: string; label: string; value: string; norm: string; verdict: string; note?: string };
};

/** Full result snapshot: text plus the table as TSV — so the whole conclusion can be eyeballed. */
const snapshotOf = (result: { table: { label: string; value: string; norm: string; verdict: string; note?: string }[]; text: string }) =>
  `${result.text}\n\n${result.table.map((r) => [r.label, r.value, r.norm, r.verdict, r.note ?? ''].join('\t')).join('\n')}\n`;

describe('conclusion.compose — normal large dog', () => {
  const result = compose(caseResult(), { species: 'dog', dogSize: 'large', drugs: '', monitoringMinutes: 5, flags: [] });
  const lines = result.text.split('\n');

  it('text: rhythm and HR with norm, axis in norm, no deviations, no extrasystoles, drugs, minutes, verification note as the last line', () => {
    expect(lines[0]).toBe('Ритм синусовый. ЧСС 92 уд/мин (78–110), норма 70–160 уд/мин.');
    expect(result.text).toContain('Электрическая ось +65° — в пределах нормы (+40…+100°).');
    expect(result.text).toContain('Отклонений от нормы по измеренным параметрам не выявлено.');
    expect(result.text).toContain('Экстрасистолы: не выявлено.');
    expect(result.text).toContain('Эпизоды несинусового ритма: не выявлено.');
    expect(result.text).toContain('Препараты: не указаны.');
    expect(result.text).toContain('Запись: 3 листа, 15.2 с; мониторинг 5 мин.');
    expect(result.text).not.toContain('Синусовая аритмия');
    expect(lines[lines.length - 1]).toBe('Заключение требует верификации специалистом.');
  });

  it('table: 13 rows with the species norm, values with units, S and QTc — "norm not defined", the rest — norm', () => {
    expect(result.table.map((r) => r.key)).toEqual([
      'hr', 'pDuration', 'pAmplitude', 'pq', 'q', 'qrs', 'r', 's', 'qt', 'qtc', 't', 'st', 'axis',
    ]);
    expect(row(result.table, 'hr')).toMatchObject({ value: '92 (78–110) уд/мин', norm: '70–160 уд/мин', verdict: 'norm' });
    expect(row(result.table, 'qrs')).toMatchObject({ value: '0.05 с', norm: '≤ 0.06 с', verdict: 'norm' });
    expect(row(result.table, 'q')).toMatchObject({ value: '−0.3 мВ', verdict: 'norm' });
    expect(row(result.table, 's')).toMatchObject({ value: '−0.4 мВ', norm: 'норма не задана', verdict: 'n/a' });
    expect(row(result.table, 'qtc')).toMatchObject({ value: '0.21 с', verdict: 'n/a' });
    expect(row(result.table, 't')).toMatchObject({ value: '0.3 мВ', verdict: 'norm' });
    expect(row(result.table, 'axis')).toMatchObject({ value: '+65°', norm: '+40…+100°', verdict: 'norm' });
    for (const r of result.table) {
      if (r.key !== 's' && r.key !== 'qtc') expect(r.verdict, r.key).toBe('norm');
    }
  });

  it('full snapshot', async () => {
    await expect(snapshotOf(result)).toMatchFileSnapshot('__snapshots__/dog-large-norm.txt');
  });
});

describe('conclusion.compose — cat with supraventricular extrasystoles and sinus arrhythmia', () => {
  const result = compose(
    caseResult({
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
        qtc: mv(null, 0),
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
      }),
      perPage: [page(), page()],
      span: { durationMs: 10400, pages: 2 },
    }),
    { species: 'cat', drugs: '', flags: [] },
  );

  it('text: species-specific sinus arrhythmia interpretation, extrasystoles with count, type, "tentative" focus and coupling', () => {
    const lines = result.text.split('\n');
    expect(lines[0]).toBe('Ритм синусовый. ЧСС 190 уд/мин (150–230), норма 140–220 уд/мин.');
    expect(lines[1]).toContain('Синусовая аритмия — для кошки в клинике нехарактерна, требует внимания');
    expect(result.text).toContain('Электрическая ось +90° — в пределах нормы (0…+160°).');
    expect(result.text).toContain(
      'Экстрасистолы: 3 наджелудочковые (очаг ориентировочно предсердный — 2, АВ-узловой — 1), интервал сцепления 240–260 мс (в среднем 250 мс).',
    );
    expect(result.text).toContain('Ненадёжные измерения (в заключении не учитывались): амплитуда Q.');
    expect(result.text).toContain('Запись: 2 листа, 10.4 с; длительность мониторинга не указана.');
    expect(result.text).not.toContain('QTc');
    expect(lines[lines.length - 1]).toBe('Заключение требует верификации специалистом.');
  });

  it('table: no QTc row (no correction for cats), signed ST, Q — "unreliable" without a verdict', () => {
    expect(result.table).toHaveLength(12);
    expect(result.table.some((r) => r.key === 'qtc')).toBe(false);
    expect(row(result.table, 'st')).toMatchObject({ value: '+0.02 мВ', norm: '−0.05…+0.05 мВ', verdict: 'norm' });
    expect(row(result.table, 'q')).toMatchObject({ value: 'ненадёжно', norm: 'норма не задана', verdict: 'n/a' });
    // Task 13: seconds no finer than 0.01 (was «0.035 с»).
    expect(row(result.table, 'qrs')).toMatchObject({ value: '0.04 с', norm: '≤ 0.04 с', verdict: 'norm' });
    expect(row(result.table, 'hr').verdict).toBe('norm');
  });

  it('full snapshot', async () => {
    await expect(snapshotOf(result)).toMatchFileSnapshot('__snapshots__/cat-sve-sinus-arrhythmia.txt');
  });
});

describe('conclusion.compose — dog with unreliable lead II', () => {
  const unreliable = (value: number | null) => mv(value, 0.3, 'lead_ii_unreliable');
  const result = compose(
    caseResult({
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
      confidence: 0.3,
      perPage: [page()],
      span: { durationMs: 5200, pages: 1 },
    }),
    { species: 'dog', dogSize: 'small', drugs: 'пимобендан', monitoringMinutes: 3, flags: ['manual_correction'] },
  );

  it('text: «Автоматический анализ невозможен: <причина>» and the verification note; unreliable numbers do not appear in the text', () => {
    // Task 13: the former expectation pinned a two-line text — §3 also requires drugs, minutes, flags and precision ceiling.
    const lines = result.text.split('\n');
    expect(lines[0]).toBe('Автоматический анализ невозможен: отведение II ненадёжно.');
    expect(lines[lines.length - 1]).toBe('Заключение требует верификации специалистом.');
    expect(result.text).not.toContain('0.09');
    expect(result.text).not.toContain('100');
  });

  it('task 13: the "impossible" branch keeps drugs, minutes, flags and precision ceiling; verification is the last line', () => {
    const lines = result.text.split('\n');
    expect(lines[0]).toBe('Автоматический анализ невозможен: отведение II ненадёжно.');
    expect(lines).toContain('Препараты: пимобендан.');
    expect(lines).toContain('Запись: 1 лист, 5.2 с; мониторинг 3 мин.');
    expect(lines).toContain('Пометки: разметка скорректирована вручную.');
    expect(lines).toContain('Потолок точности листа: 1 px = 0.023 мВ / 4.7 мс; точность измерений не лучше ±2 px (±0.046 мВ / ±9.4 мс).');
    expect(lines[lines.length - 1]).toBe('Заключение требует верификации специалистом.');
    const noMinutes = compose(caseResult({ measurements: measurements({ hrMean: mv(null, 0, 'no_beats'), hrMin: mv(null, 0), hrMax: mv(null, 0), pDuration: mv(null, 0), pAmplitude: mv(null, 0), pq: mv(null, 0), q: mv(null, 0), qrs: mv(null, 0), r: mv(null, 0), s: mv(null, 0), qt: mv(null, 0), qtc: mv(null, 0), t: mv(null, 0), st: mv(null, 0) }) }), {
      species: 'cat',
      drugs: '',
      flags: ['analyze_together_forced'],
    });
    expect(noMinutes.text).toContain('Автоматический анализ невозможен: удары не найдены.');
    expect(noMinutes.text).toContain('длительность мониторинга не указана');
    expect(noMinutes.text).toContain('Препараты: не указаны.');
    expect(noMinutes.text).toContain('Пометки: листы проанализированы вместе по решению пользователя.');
    expect(noMinutes.text.split('\n').at(-1)).toBe('Заключение требует верификации специалистом.');
  });

  it('table: "unreliable" in every row, no verdict set, reason in the note', () => {
    expect(result.table).toHaveLength(13);
    for (const r of result.table) {
      expect(r.value, r.key).toBe('ненадёжно');
      expect(r.verdict, r.key).toBe('n/a');
    }
    expect(row(result.table, 'pq').note).toBe('отведение II ненадёжно');
    expect(row(result.table, 'pq').norm).toBe('0.06–0.13 с');
  });

  it('full snapshot', async () => {
    await expect(snapshotOf(result)).toMatchFileSnapshot('__snapshots__/dog-unreliable-lead-ii.txt');
  });
});

describe('conclusion.compose — small dog with deviations, VE, an episode and flags', () => {
  const result = compose(
    caseResult({
      measurements: measurements({
        hrMean: mv(205),
        hrMin: mv(180),
        hrMax: mv(230),
        pDuration: mv(0.045),
        q: mv(-0.8),
        qrs: mv(0.08),
        r: mv(2.0),
        s: mv(-0.5),
        t: mv(0.9),
        st: mv(-0.15),
      }),
      rhythm: rhythm({
        axisDeg: 20,
        ectopics: [{ beat: 7, kind: 'VE', focus: 'left_ventricle', couplingMs: 300 }],
        episodes: [{ startMs: 2400, durationMs: 1100, kind: 've_run', focus: 'right_ventricle', couplingMs: 310, beats: [10, 11, 12] }],
      }),
      perPage: [page(4.65, 0.023)],
      span: { durationMs: 5200, pages: 1 },
    }),
    {
      species: 'dog',
      dogSize: 'small',
      drugs: 'пимобендан 0.25 мг/кг',
      flags: ['manual_correction', 'precision_ceiling', 'analyze_together_forced', 'unknown_flag'],
    },
  );

  it('text: tachycardia, left axis, deviations and borderline values with dictionary phrases, VE, episode, drugs, flags', () => {
    const lines = result.text.split('\n');
    expect(lines[0]).toBe('Ритм синусовый. ЧСС 205 уд/мин (180–230), норма 70–180 уд/мин — выше нормы (тахикардия).');
    expect(result.text).toContain('Электрическая ось +20° — отклонение влево (норма +40…+100°).');
    expect(result.text).toContain(
      'Отклонения от нормы: длительность P 0.05 с — выше нормы, норма ≤ 0.04 с; длительность QRS 0.08 с — выше нормы, норма ≤ 0.05 с; амплитуда T 0.9 мВ (45 % R) — выше нормы, норма ≤ 25 % R и по модулю ≤ 1 мВ.',
    );
    expect(result.text).toContain(
      'Пограничные значения: амплитуда Q −0.8 мВ — глубокий Q, пограничное (породозависимо), норма по модулю ≤ 0.5 мВ; сегмент ST −0.15 мВ — пограничная депрессия, норма −0.1…+0.1 мВ.',
    );
    expect(result.text).toContain('Экстрасистолы: 1 желудочковая (очаг ориентировочно левый желудочек), интервал сцепления 300 мс.');
    expect(result.text).toContain(
      'Эпизоды несинусового ритма (1): пробежка желудочковых экстрасистол с 2.4 с, длительность 1.1 с, 3 удара, очаг ориентировочно правый желудочек, сцепление 310 мс.',
    );
    expect(result.text).toContain('Препараты: пимобендан 0.25 мг/кг.');
    expect(result.text).toContain('Запись: 1 лист, 5.2 с; длительность мониторинга не указана.');
    // Task 13: the precision ceiling is a separate line in every conclusion (story 26), numbers no finer than the sheet.
    expect(result.text).toContain('Пометки: разметка скорректирована вручную; листы проанализированы вместе по решению пользователя.');
    expect(result.text).toContain('Потолок точности листа: 1 px = 0.023 мВ / 4.7 мс; точность измерений не лучше ±2 px (±0.046 мВ / ±9.4 мс).');
    expect(result.text).not.toContain('unknown_flag');
    expect(lines[lines.length - 1]).toBe('Заключение требует верификации специалистом.');
  });

  it('table: verdicts by class, fraction of R in the T note, QTc without a verdict', () => {
    expect(row(result.table, 'hr').verdict).toBe('abnormal');
    expect(row(result.table, 'axis')).toMatchObject({ value: '+20°', verdict: 'abnormal' });
    expect(row(result.table, 't')).toMatchObject({ value: '0.9 мВ', verdict: 'abnormal', note: '45 % R' });
    expect(row(result.table, 'q')).toMatchObject({ value: '−0.8 мВ', verdict: 'border' });
    expect(row(result.table, 'st')).toMatchObject({ value: '−0.15 мВ', verdict: 'border' });
    expect(row(result.table, 'qrs')).toMatchObject({ value: '0.08 с', norm: '≤ 0.05 с', verdict: 'abnormal' });
    expect(row(result.table, 'qtc')).toMatchObject({ value: '0.21 с', norm: 'норма не задана', verdict: 'n/a' });
    expect(row(result.table, 'r')).toMatchObject({ value: '2 мВ', norm: '≤ 2.5 мВ', verdict: 'norm' });
  });

  it('full snapshot', async () => {
    await expect(snapshotOf(result)).toMatchFileSnapshot('__snapshots__/dog-small-deviations.txt');
  });
});

describe('conclusion.compose — "not detected" only with reliable beats (task 13)', () => {
  const sig = (confidence: number) => ({ id: 'II', fs: 500, t0: 0, mv: new Float32Array(10), baselineY: 0, confidence, unreliable: [] }) as unknown as LeadSignal;
  const pageBeats = (beats: number, confidence: number): PageBeats =>
    ({ page: 0, offsetMs: 0, beats: Array.from({ length: beats }, () => ({})), delineations: [], signals: [sig(confidence), sig(confidence)] }) as unknown as PageBeats;

  it('no beats — extrasystole and episode lines say "unreliable, check the markup" with a reason, not "not detected"', () => {
    const { text } = compose(caseResult({ beats: [pageBeats(0, 0.9)] }), { species: 'dog', drugs: '', flags: [] });
    expect(text).toContain('Экстрасистолы: ненадёжно, проверьте разметку (удары не найдены).');
    expect(text).toContain('Эпизоды несинусового ритма: ненадёжно, проверьте разметку (удары не найдены).');
    expect(text).not.toContain('Экстрасистолы: не выявлено');
    expect(text).not.toContain('ритма: не выявлено');
  });

  it('all leads unreliable (foreign image) — "unreliable, check the markup (all leads unreliable)"', () => {
    const { text } = compose(caseResult({ beats: [pageBeats(5, 0.3)] }), { species: 'dog', drugs: '', flags: [] });
    expect(text).toContain('Экстрасистолы: ненадёжно, проверьте разметку (все отведения ненадёжны).');
    expect(text).toContain('Эпизоды несинусового ритма: ненадёжно, проверьте разметку (все отведения ненадёжны).');
  });

  it('reliable beats without arrhythmias — still "not detected"', () => {
    const { text } = compose(caseResult({ beats: [pageBeats(5, 0.9)] }), { species: 'dog', drugs: '', flags: [] });
    expect(text).toContain('Экстрасистолы: не выявлено.');
    expect(text).toContain('Эпизоды несинусового ритма: не выявлено.');
  });
});

describe('conclusion.compose — P found for some complexes (task 13, a-02)', () => {
  it('reason p_not_all:14/18 — «зубец P найден перед 14 из 18 комплексов», not «зубец P не найден»', () => {
    const { text } = compose(caseResult({ rhythm: rhythm({ type: 'non_sinus', reasons: ['p_not_all:14/18', 'pq_unstable'] }) }), { species: 'dog', drugs: '', flags: [] });
    expect(text.split('\n')[0]).toMatch(/^Ритм несинусовый \(зубец P найден перед 14 из 18 комплексов, интервал PQ непостоянен\)\./);
    expect(text).not.toContain('зубец P не найден');
  });
});

describe('conclusion.compose — pause (task 13)', () => {
  it('713 ms pause at 2.11 s — a separate phrase with duration in ms and «требует проверки специалистом»', () => {
    const { text } = compose(caseResult({ rhythm: rhythm({ pauses: [{ beat: 9, startMs: 2114, durationMs: 713 }] }) }), { species: 'dog', drugs: '', flags: [] });
    expect(text).toContain('Пауза 713 мс (с 2.11 с) — требует проверки специалистом.');
    expect(text).not.toContain('вариант нормы');
  });
});

describe('conclusion.compose — the raw value is classified, the rounded one is printed (task 13, review)', () => {
  it('P 0.044 s in a large dog — «0.04 с», borderline (norm ≤ 0.04, zone up to 0.05)', () => {
    const r = compose(caseResult({ measurements: measurements({ pDuration: mv(0.044) }) }), { species: 'dog', dogSize: 'large', drugs: '', flags: [] });
    expect(row(r.table, 'pDuration')).toMatchObject({ value: '0.04 с', verdict: 'border' });
    expect(r.text).toContain('длительность P 0.04 с — пограничное (у верхней границы), норма ≤ 0.04 с');
  });

  it('QRS 0.054 s in a small dog (norm ≤ 0.05) — not "norm"', () => {
    const r = compose(caseResult({ measurements: measurements({ qrs: mv(0.054) }) }), { species: 'dog', dogSize: 'small', drugs: '', flags: [] });
    expect(row(r.table, 'qrs').value).toBe('0.05 с');
    expect(row(r.table, 'qrs').verdict).not.toBe('norm');
  });
});

describe('precisionSentence — precision ceiling, two significant digits (story 26, task 13 review)', () => {
  it('variant A (0.0232 mV, 4.646 ms per px): «1 px = 0.023 мВ / 4.6 мс; ±2 px (±0.046 мВ / ±9.2 мс)» — exactly 2× the printed value', () => {
    expect(precisionSentence(caseResult({ perPage: [page(4.646, 0.0232)] }))).toBe(
      'Потолок точности листа: 1 px = 0.023 мВ / 4.6 мс; точность измерений не лучше ±2 px (±0.046 мВ / ±9.2 мс).',
    );
  });

  it('small px (0.0046 mV) — also two significant digits, never "0 mV"; with several sheets — the coarsest', () => {
    const text = precisionSentence(caseResult({ perPage: [page(2.1, 0.0046), page(1.9, 0.0031)] }));
    expect(text).toBe('Потолок точности листа: 1 px = 0.0046 мВ / 2.1 мс; точность измерений не лучше ±2 px (±0.0092 мВ / ±4.2 мс).');
  });

  it('no grid — "precision ceiling not determined"', () => {
    expect(precisionSentence(caseResult({ perPage: [{} as PageResult] }))).toBe('Потолок точности не определён: сетка листа не распознана.');
  });
});

describe('beatsUnreliableReason — export for the UI', () => {
  it('no beats → no_beats; reliable beats → null', () => {
    const sig = { id: 'II', fs: 500, t0: 0, mv: new Float32Array(4), baselineY: 0, confidence: 0.9, unreliable: [] } as unknown as LeadSignal;
    const pb = (n: number) => ({ page: 0, offsetMs: 0, beats: Array.from({ length: n }, () => ({})), delineations: [], signals: [sig] }) as unknown as PageBeats;
    expect(beatsUnreliableReason(caseResult({ beats: [pb(0)] }))).toBe('no_beats');
    expect(beatsUnreliableReason(caseResult({ beats: [pb(3)] }))).toBeNull();
  });
});

describe('conclusion.compose — T below zero (task 13)', () => {
  it('dog: T −0.9 mV with R 1.8 (50 % R) — «отрицательный T, глубже нормы», not «выше нормы»', () => {
    const { text } = compose(caseResult({ measurements: measurements({ t: mv(-0.9) }) }), { species: 'dog', dogSize: 'large', drugs: '', flags: [] });
    expect(text).toContain('амплитуда T −0.9 мВ (50 % R) — отрицательный T, глубже нормы, норма ≤ 25 % R и по модулю ≤ 1 мВ');
    expect(text).not.toContain('выше нормы');
  });

  it('cat: T −0.4 mV — deviation «отрицательный T, глубже нормы»; T −0.1 — borderline by sign', () => {
    const deep = compose(caseResult({ measurements: measurements({ hrMean: mv(180), r: mv(0.6), t: mv(-0.4) }) }), { species: 'cat', drugs: '', flags: [] });
    expect(deep.text).toContain('амплитуда T −0.4 мВ — отрицательный T, глубже нормы, норма по модулю ≤ 0.3 мВ');
    const shallow = compose(caseResult({ measurements: measurements({ hrMean: mv(180), r: mv(0.6), t: mv(-0.1) }) }), { species: 'cat', drugs: '', flags: [] });
    expect(shallow.text).toContain('амплитуда T −0.1 мВ — отрицательный зубец T, пограничное (у кошек обычно положительный)');
  });
});

describe('conclusion.compose on real sheets (analyzeCase seam) — task 13', () => {
  const cases = new Map<string, CaseResult>();
  const caseOf = (name: string): CaseResult => {
    let c = cases.get(name);
    if (!c) {
      const fixture = getFixture(name);
      const species = fixture.expected.speciesLetter === 'к' ? 'cat' : 'dog';
      c = analyzeCase([analyzePage(loadFixture(fixture), POLYSPECTRUM)], { species, drugs: '', analyzeTogether: false }, []);
      cases.set(name, c);
    }
    return c;
  };

  it('a-01: numbers no finer than the sheet — integer HR, no numbers with three decimals in text or table (except px size)', () => {
    const { conclusion } = caseOf('a-01');
    // The precision-ceiling line prints the pixel size with two significant digits (0.023 mV) — per the task 13 review.
    const measuredText = conclusion.text
      .split('\n')
      .filter((l) => !l.startsWith('Потолок точности'))
      .join('\n');
    expect(measuredText).not.toMatch(/\d\.\d{3}/);
    expect(conclusion.text).toMatch(/Потолок точности листа: 1 px = 0\.023 мВ \/ 4\.\d мс/);
    for (const r of conclusion.table) expect(r.value, r.key).not.toMatch(/\d\.\d{3}/);
    expect(row(conclusion.table, 'hr').value).toMatch(/^\d+ \(\d+–\d+\) уд\/мин$/);
    expect(conclusion.text).toMatch(/ЧСС \d+ уд\/мин \(\d+–\d+\)/);
  }, 20_000);

  it('a-02: rhythm described via the count of complexes with a found P — «зубец P найден перед 14 из 18 комплексов»', () => {
    const { conclusion } = caseOf('a-02');
    expect(conclusion.text).toContain('Ритм несинусовый (зубец P найден перед 14 из 18 комплексов');
    expect(conclusion.text).not.toContain('зубец P не найден');
  }, 20_000);

  it('b-02: pause ≈ 713 ms named in a separate phrase, «вариант нормы» does not appear', () => {
    const { conclusion } = caseOf('b-02');
    expect(conclusion.text).toMatch(/Пауза 7(0[1-9]|1\d|2[0-5]) мс \(с [\d.]+ с\) — требует проверки специалистом\./);
    expect(conclusion.text).not.toContain('вариант нормы');
  }, 20_000);
});
