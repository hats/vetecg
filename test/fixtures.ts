/**
 * Fixture loader for tests: lists the 10 real sheets in `fixtures/polyspectrum/`
 * with expected values from `expected.json` and decodes them into `GrayImage` (Node, no browser).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromJpeg } from '../src/core/image/jpeg';
import type { GrayImage, PageVariant, SpeciesLetter } from '../src/types/contracts';

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'polyspectrum');

/** One `expected.json` entry; fields are named as in `PageMeta`. */
export interface FixtureExpected {
  file: string;
  source: string;
  variant: PageVariant;
  size: [number, number];
  headerDate: string;
  headerProduct: string;
  speciesLetter: SpeciesLetter;
  timeLabels: string[];
  hrRow: number[];
  rrRowMs?: number[];
  footerHr: number;
  footer: string;
  notes: string;
}

export interface Fixture {
  /** Name without extension: `a-01` … `b-02`. */
  name: string;
  path: string;
  expected: FixtureExpected;
}

interface ExpectedFile {
  pages: FixtureExpected[];
}

let cache: Fixture[] | undefined;

export function listFixtures(): Fixture[] {
  if (!cache) {
    const parsed = JSON.parse(readFileSync(join(FIXTURES_DIR, 'expected.json'), 'utf8')) as ExpectedFile;
    cache = parsed.pages.map((expected) => ({
      name: expected.file.replace(/\.jpg$/, ''),
      path: join(FIXTURES_DIR, expected.file),
      expected,
    }));
  }
  return cache;
}

export function getFixture(name: string): Fixture {
  const fixture = listFixtures().find((f) => f.name === name);
  if (!fixture) throw new Error(`No fixture "${name}"`);
  return fixture;
}

export function loadFixtureBytes(fixture: Fixture | string): Uint8Array {
  const target = typeof fixture === 'string' ? getFixture(fixture) : fixture;
  return new Uint8Array(readFileSync(target.path));
}

export function loadFixture(fixture: Fixture | string): GrayImage {
  return fromJpeg(loadFixtureBytes(fixture));
}
