import { describe, expect, it } from 'vitest';
import { renderPhrasesDoc } from './doc';
import * as P from './phrases';

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

describe('docs/slovar-zaklyucheniya.md is built from the phrase dictionary', () => {
  it('the document matches the dictionary render (update: npx vitest run src/analysis/conclusion -u)', async () => {
    await expect(renderPhrasesDoc()).toMatchFileSnapshot('../../../docs/slovar-zaklyucheniya.md');
  });

  it('phrases contain no Latin letters except placeholders and wave names — English codes never reach the text (TECH-02)', () => {
    const phrases = collectStrings(P).filter((s) => s.length > 0);
    expect(phrases.length).toBeGreaterThan(50);
    // Allowed: placeholders, wave and lead names, the QT-correction formula name, "px" in the precision-ceiling note
    // (specification story 26: «1 px = N мВ / M мс; точность измерений не лучше ±2 px»).
    const allowed = /\{\w+\}|\bVan de Water\b|\b(QTc|QRS|PQ|QT|ST|P|Q|R|S|T|I|II|III|aVR|aVL|aVF|px)\b/g;
    for (const phrase of phrases) {
      expect(/[A-Za-z]/.test(phrase.replace(allowed, '')), phrase).toBe(false);
    }
    expect(P.VERIFICATION).toBe('Заключение требует верификации специалистом.');
  });
});
