import { describe, expect, it } from 'vitest';
import { renderNormsDoc } from './doc';
import { NORM_ENTRIES, NORM_SOURCES, RHYTHM_THRESHOLDS } from './index';

describe('docs/normy-ekg.md is built from the norms data', () => {
  it('the document matches the data render (update: npx vitest run src/analysis/norms -u)', async () => {
    await expect(renderNormsDoc()).toMatchFileSnapshot('../../../docs/normy-ekg.md');
  });

  it('the document contains the sections required by acceptance', () => {
    const doc = renderNormsDoc();
    expect(doc).toContain('| Параметр | Собака мелкая | Собака крупная | Кошка | Источник |');
    expect(doc).toContain('## Расхождения с прежними справочниками и что изменено');
    expect(doc).toContain('## Источники');
    expect(doc).toContain('Синусовая аритмия');
    expect(doc).toContain('Экстрасистолы');
  });

  it('task 13: the QRS, ST and axis rows show the borderline-zone source «ПРОЕКТ», not the literature', () => {
    const doc = renderNormsDoc();
    const rowOf = (label: string) => doc.split('\n').find((l) => l.startsWith(`| ${label},`)) ?? '';
    for (const label of ['Длительность QRS', 'Сегмент ST', 'Электрическая ось QRS']) {
      expect(rowOf(label), label).toContain('пограничная зона — ПРОЕКТ');
    }
    expect(rowOf('Длительность QRS')).not.toContain('KAT22');
  });

  it('every norm row and every threshold references a known source code', () => {
    const codes = NORM_SOURCES.map((s) => s.code);
    const hasKnownCode = (source: string) => codes.some((code) => source.includes(code));
    for (const entry of NORM_ENTRIES) {
      for (const range of Object.values(entry.ranges)) {
        if (range) expect(hasKnownCode(range.source), `${entry.key}: ${range.source}`).toBe(true);
      }
    }
    for (const thresholds of Object.values(RHYTHM_THRESHOLDS)) {
      for (const group of Object.values(thresholds)) {
        expect(hasKnownCode(group.source), group.source).toBe(true);
      }
    }
  });
});
