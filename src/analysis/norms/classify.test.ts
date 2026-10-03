import { describe, expect, it } from 'vitest';
import type { NormClass, NormKey } from '../../types/contracts';
import { classify, getNorms } from './index';

type Case = [NormKey, number, NormClass];

// Limits come from the specification §4 decisions; borderline zone — ±10 % from the limit or the reference's explicit grey zone.
const cases: Record<'dog-small' | 'dog-large' | 'cat', Case[]> = {
  'dog-small': [
    ['hrMean', 70, 'norm'],
    ['hrMean', 60, 'border'],
    ['hrMean', 59, 'abnormal'],
    ['hrMean', 180, 'norm'],
    ['hrMean', 198, 'border'],
    ['hrMean', 199, 'abnormal'],
    ['pDuration', 0.04, 'norm'],
    ['pDuration', 0.044, 'border'],
    ['pDuration', 0.045, 'abnormal'],
    ['pAmplitude', 0.05, 'norm'],
    ['pAmplitude', 0.4, 'norm'],
    ['pAmplitude', 0.44, 'border'],
    ['pAmplitude', 0.45, 'abnormal'],
    ['pq', 0.06, 'norm'],
    ['pq', 0.055, 'border'],
    ['pq', 0.053, 'abnormal'],
    ['pq', 0.13, 'norm'],
    ['pq', 0.14, 'border'],
    ['pq', 0.15, 'abnormal'],
    ['qrs', 0.05, 'norm'],
    ['qrs', 0.06, 'border'],
    ['qrs', 0.061, 'abnormal'],
    ['r', 0.3, 'norm'],
    ['r', 2.5, 'norm'],
    ['r', 2.75, 'border'],
    ['r', 2.76, 'abnormal'],
    ['qt', 0.15, 'norm'],
    ['qt', 0.135, 'border'],
    ['qt', 0.134, 'abnormal'],
    ['qt', 0.25, 'norm'],
    ['qt', 0.275, 'border'],
    ['qt', 0.276, 'abnormal'],
    ['st', -0.1, 'norm'],
    ['st', -0.15, 'border'],
    ['st', -0.2, 'border'],
    ['st', -0.21, 'abnormal'],
    ['st', 0.1, 'norm'],
    ['st', 0.15, 'border'],
    ['st', 0.16, 'abnormal'],
    ['axis', 40, 'norm'],
    ['axis', 30, 'border'],
    ['axis', 29, 'abnormal'],
    ['axis', 100, 'norm'],
    ['axis', 110, 'border'],
    ['axis', 111, 'abnormal'],
  ],
  'dog-large': [
    ['hrMean', 65, 'border'],
    ['hrMean', 59, 'abnormal'],
    ['hrMean', 160, 'norm'],
    ['hrMean', 176, 'border'],
    ['hrMean', 177, 'abnormal'],
    ['pDuration', 0.04, 'norm'],
    ['pDuration', 0.05, 'border'],
    ['pDuration', 0.051, 'abnormal'],
    ['pAmplitude', 0.4, 'norm'],
    ['pq', 0.12, 'norm'],
    ['qrs', 0.06, 'norm'],
    ['qrs', 0.07, 'border'],
    ['qrs', 0.071, 'abnormal'],
    ['r', 3.0, 'norm'],
    ['r', 3.3, 'border'],
    ['r', 3.31, 'abnormal'],
    ['qt', 0.25, 'norm'],
    ['axis', 100, 'norm'],
  ],
  cat: [
    ['hrMean', 140, 'norm'],
    ['hrMean', 120, 'border'],
    ['hrMean', 119, 'abnormal'],
    ['hrMean', 220, 'norm'],
    ['hrMean', 240, 'border'],
    ['hrMean', 241, 'abnormal'],
    ['pDuration', 0.04, 'norm'],
    ['pDuration', 0.045, 'abnormal'],
    ['pAmplitude', 0.2, 'norm'],
    ['pAmplitude', 0.22, 'border'],
    ['pAmplitude', 0.23, 'abnormal'],
    ['pq', 0.05, 'norm'],
    ['pq', 0.046, 'border'],
    ['pq', 0.044, 'abnormal'],
    ['pq', 0.09, 'norm'],
    ['pq', 0.098, 'border'],
    ['pq', 0.1, 'abnormal'],
    ['qrs', 0.04, 'norm'],
    ['qrs', 0.05, 'border'],
    ['qrs', 0.051, 'abnormal'],
    ['r', 0.9, 'norm'],
    ['r', 0.99, 'border'],
    ['r', 1.0, 'abnormal'],
    ['qt', 0.12, 'norm'],
    ['qt', 0.09, 'border'],
    ['qt', 0.089, 'abnormal'],
    ['qt', 0.18, 'norm'],
    ['qt', 0.2, 'border'],
    ['qt', 0.201, 'abnormal'],
    ['st', 0.05, 'norm'],
    ['st', -0.05, 'norm'],
    ['st', 0.07, 'border'],
    ['st', -0.1, 'border'],
    ['st', 0.11, 'abnormal'],
    ['st', -0.11, 'abnormal'],
    ['axis', 0, 'norm'],
    ['axis', -10, 'border'],
    ['axis', -11, 'abnormal'],
    ['axis', 160, 'norm'],
    ['axis', 170, 'border'],
    ['axis', 171, 'abnormal'],
  ],
};

describe('norms.classify — norm and borderline-zone limits', () => {
  const tables = {
    'dog-small': getNorms('dog', 'small'),
    'dog-large': getNorms('dog', 'large'),
    cat: getNorms('cat'),
  };

  for (const [profile, list] of Object.entries(cases) as [keyof typeof cases, Case[]][]) {
    it(`${profile}: ${list.length} boundary values`, () => {
      for (const [param, value, expected] of list) {
        expect(classify(param, value, tables[profile]), `${profile} ${param}=${value}`).toBe(expected);
      }
    });
  }
});

describe('norms.classify — special rules', () => {
  const dog = getNorms('dog', 'large');
  const cat = getNorms('cat');

  it('dog T: |T| ≤ 25 % R of either sign; without R — only the 1.0 mV ceiling', () => {
    expect(classify('t', 0.6, dog, { r: 2.5 })).toBe('norm'); // 24 % R
    expect(classify('t', -0.6, dog, { r: 2.5 })).toBe('norm'); // negative — not a deviation
    expect(classify('t', 0.65, dog, { r: 2.5 })).toBe('border'); // 26 % R — within +10 % of the rule
    expect(classify('t', 0.7, dog, { r: 2.5 })).toBe('abnormal'); // 28 % R
    expect(classify('t', 0.9, dog)).toBe('norm');
    expect(classify('t', 1.05, dog)).toBe('border');
    expect(classify('t', 1.2, dog)).toBe('abnormal');
    expect(classify('t', 1.05, dog, { r: 2.5 })).toBe('abnormal'); // 42 % R — the worse of the two verdicts
    expect(classify('t', 0.5, dog, { r: null })).toBe('norm');
  });

  it('cat T: usually positive <0.3 mV; negative — borderline', () => {
    expect(classify('t', 0.25, cat)).toBe('norm');
    expect(classify('t', -0.25, cat)).toBe('border');
    expect(classify('t', 0.3, cat)).toBe('norm');
    expect(classify('t', 0.33, cat)).toBe('border');
    expect(classify('t', 0.34, cat)).toBe('abnormal');
    expect(classify('t', -0.4, cat)).toBe('abnormal');
  });

  it('deep Q in a dog (>0.5 mV absolute) — borderline, never a deviation; no norm for cats', () => {
    expect(classify('q', -0.3, dog)).toBe('norm');
    expect(classify('q', -0.5, dog)).toBe('norm');
    expect(classify('q', -0.6, dog)).toBe('border');
    expect(classify('q', -1.9, dog)).toBe('border');
    expect(classify('q', -0.6, cat)).toBe('n/a');
  });

  it('"norm not defined": S, QTc, HR min/max and a missing value → n/a', () => {
    expect(classify('s', -0.4, dog)).toBe('n/a');
    expect(classify('qtc', 0.22, dog)).toBe('n/a');
    expect(classify('hrMin', 50, dog)).toBe('n/a');
    expect(classify('qrs', null, dog)).toBe('n/a');
  });
});
