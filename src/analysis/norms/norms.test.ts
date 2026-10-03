import { describe, expect, it } from 'vitest';
import { getNorms } from './index';

// Expected numbers come from the specification §4 decisions (based on Tilley & Smith, table 3-1), not from the code.
describe('norms.getNorms — norm tables per species and size', () => {
  it('QRS: ≤0.05 s small, ≤0.06 s large, ≤0.04 s cats; every row has a source', () => {
    const small = getNorms('dog', 'small');
    const large = getNorms('dog', 'large');
    const cat = getNorms('cat');

    expect(small.params.qrs?.max).toBe(0.05);
    expect(large.params.qrs?.max).toBe(0.06);
    expect(cat.params.qrs?.max).toBe(0.04);
    expect(cat.dogSize).toBeUndefined();

    for (const table of [small, large, cat]) {
      for (const [key, range] of Object.entries(table.params)) {
        expect(range?.source.length, `источник у ${key}`).toBeGreaterThan(0);
        expect(range?.unit.length, `единица у ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('task 13: borderline zones absent from the sources (QRS +0.01 s, dog ST from 0.1 and cat 0.05–0.10 mV, axis ±10°) — source «ПРОЕКТ»; every explicit zone has its own source', () => {
    // The "no source" list comes from the specification §4 decisions («QRS +0.01 с, S у кошек, ST … помечаются источником ПРОЕКТ»)
    // and from the data itself (axis ±10° — «инженерный допуск», engineering tolerance). Cat S has no norm at all (null) — no zone.
    const tables = [getNorms('dog', 'small'), getNorms('dog', 'large'), getNorms('cat')];
    for (const table of tables) {
      for (const key of ['qrs', 'st', 'axis'] as const) {
        expect(table.params[key]?.borderSource, `${table.species}/${table.dogSize ?? ''} ${key}`).toBe('ПРОЕКТ');
        // The main source string does not attribute the project zone to the literature.
        expect(table.params[key]?.source, `${key}: ${table.params[key]?.source}`).not.toMatch(/пограничн|серая зона/);
      }
      for (const [key, range] of Object.entries(table.params)) {
        if (range && (range.borderMin !== undefined || range.borderMax !== undefined)) {
          expect(range.borderSource?.length, `источник пограничной зоны у ${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('corrected vs the former references: large-dog P ≤0.04 (0.05 — giant breeds), dog PQ 0.06–0.13, QT 0.15–0.25 / 0.12–0.18, large-dog P ≤0.40 mV', () => {
    const small = getNorms('dog', 'small');
    const large = getNorms('dog', 'large');
    const cat = getNorms('cat');

    expect(large.params.pDuration?.max).toBe(0.04);
    expect(large.params.pDuration?.borderMax).toBe(0.05);
    expect(small.params.pq).toMatchObject({ min: 0.06, max: 0.13 });
    expect(large.params.pq).toMatchObject({ min: 0.06, max: 0.13 });
    expect(cat.params.pq).toMatchObject({ min: 0.05, max: 0.09 });
    expect(small.params.qt).toMatchObject({ min: 0.15, max: 0.25 });
    expect(large.params.qt).toMatchObject({ min: 0.15, max: 0.25 });
    expect(cat.params.qt).toMatchObject({ min: 0.12, max: 0.18 });
    expect(large.params.pAmplitude?.max).toBe(0.4);
    // No lower limits for P, T and R: a low P and a flat T are normal.
    for (const table of [small, large, cat]) {
      expect(table.params.pAmplitude?.min).toBeUndefined();
      expect(table.params.t?.min).toBeUndefined();
      expect(table.params.r?.min).toBeUndefined();
    }
  });

  it('added: R ≤2.5 / ≤3.0 / ≤0.9 mV, S — norm not defined; HR 70–180 / 70–160 / 140–220; axis +40…+100 / 0…+160', () => {
    const small = getNorms('dog', 'small');
    const large = getNorms('dog', 'large');
    const cat = getNorms('cat');

    expect(small.params.r?.max).toBe(2.5);
    expect(large.params.r?.max).toBe(3.0);
    expect(cat.params.r?.max).toBe(0.9);
    expect(small.params.s).toBeUndefined();
    expect(cat.params.s).toBeUndefined();

    expect(small.params.hrMean).toMatchObject({ min: 70, max: 180 });
    expect(large.params.hrMean).toMatchObject({ min: 70, max: 160 });
    expect(cat.params.hrMean).toMatchObject({ min: 140, max: 220, borderMin: 120, borderMax: 240 });

    expect(small.params.axis).toMatchObject({ min: 40, max: 100 });
    expect(cat.params.axis).toMatchObject({ min: 0, max: 160 });
  });

  it('rhythm thresholds: sinus arrhythmia >10 % (≥0.12 s dogs / ≥0.10 s cats), normal only in dogs; wide QRS >70 / >40 ms', () => {
    const dog = getNorms('dog', 'large');
    const cat = getNorms('cat');

    expect(dog.thresholds?.sinusArrhythmia).toMatchObject({ rrVariation: 0.1, rrDeltaS: 0.12, normalForSpecies: true });
    expect(cat.thresholds?.sinusArrhythmia).toMatchObject({ rrVariation: 0.1, rrDeltaS: 0.1, normalForSpecies: false });
    expect(dog.thresholds?.wideQrs).toMatchObject({ s: 0.07, confidentS: 0.08 });
    expect(cat.thresholds?.wideQrs).toMatchObject({ s: 0.04, confidentS: 0.05 });
    expect(dog.thresholds?.prematurity.fraction).toBeGreaterThan(0);
  });

  it('a dog without a size gets the standard-breed (large) table', () => {
    expect(getNorms('dog').dogSize).toBe('large');
  });
});
