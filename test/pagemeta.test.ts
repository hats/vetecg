import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGrayImage } from '../src/core/image';
import { detectLayout } from '../src/core/layout';
import { BUILTIN_GLYPH_SETS, matchGlyphs, readPageMeta } from '../src/core/pagemeta';
import { bandWords, FONTS } from '../src/core/pagemeta/zones';
import { binarizeRect, jaccardDistance, POLYSPECTRUM } from '../src/core/profile';
import type { GrayImage, PageLayout, PageMeta } from '../src/types/contracts';
import { FIXTURES_DIR, getFixture, listFixtures, loadFixture, type Fixture } from './fixtures';

const GLYPHS_DIR = join(FIXTURES_DIR, 'glyphs');
const fixtures = listFixtures();
/** `readPageMeta` always fills `issues`; the field is optional in the contract for the sake of other modules' literals. */
const issuesOf = (meta: PageMeta): string[] => meta.issues ?? [];

/** One `detectLayout` + `readPageMeta` call per fixture — the result is reused by all checks. */
const cache = new Map<string, { image: GrayImage; layout: PageLayout; meta: PageMeta }>();
function analyzed(fixture: Fixture): { image: GrayImage; layout: PageLayout; meta: PageMeta } {
  let entry = cache.get(fixture.name);
  if (!entry) {
    const image = loadFixture(fixture);
    const layout = detectLayout(image, POLYSPECTRUM);
    entry = { image, layout, meta: readPageMeta(image, layout, POLYSPECTRUM) };
    cache.set(fixture.name, entry);
  }
  return entry;
}

/**
 * HR digit centers measured independently from ink (fixtures/polyspectrum/README.md, «Цифры ЧСС и удары»):
 * a-01 — all 12, a-02 — the first 9 (the first one is left of the first visible complex).
 */
const README_HR_CENTERS: Record<string, number[]> = {
  'a-01': [156, 247, 335, 423, 511, 600, 702, 813, 911, 1007, 1101, 1192],
  'a-02': [104, 150, 206, 262, 317, 372, 429, 485, 543],
};

interface GlyphJson {
  text: string;
  width: number;
  height: number;
  data: number[];
}
interface GlyphsFile {
  inkThreshold: number;
  sets: Record<string, { pairAbove?: number; glyphs: GlyphJson[] }>;
}
interface ProvenanceFile {
  entries: { set: string; text: string; fixture: string; rect: { x: number; y: number; width: number; height: number } }[];
}

const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(GLYPHS_DIR, name), 'utf8')) as T;

/** Soft ink per the templates README: 0 for luminance ≥ threshold, (threshold − luminance)·255/threshold otherwise. */
const softInk = (gray: number, threshold: number): number => (gray >= threshold ? 0 : Math.round(((threshold - gray) * 255) / threshold));

describe('glyph templates fixtures/polyspectrum/glyphs', () => {
  it('sets: digits 0–9 for HR, RR, time labels (+ «:») and header/footer text (+ «.», «:»), labels per variant, «с»/«к», footer fragments', () => {
    const file = readJson<GlyphsFile>('glyphs.json');
    // A character may have several templates (different print phases) — distinct texts of the set are compared.
    const texts = (set: string) => [...new Set(file.sets[set].glyphs.map((g) => g.text))].sort();
    const digits = '0123456789'.split('');
    expect(texts('hrDigits')).toEqual(digits);
    expect(texts('rrDigits')).toEqual(digits);
    expect(texts('timeDigits')).toEqual([...digits, ':'].sort());
    expect(texts('textDigits')).toEqual([...digits, '.', ':'].sort());
    expect(texts('leadLabelsA')).toEqual(['I', 'II', 'III', 'aVF', 'aVL', 'aVR'].sort());
    expect(texts('leadLabelsB')).toEqual(['I', 'II', 'III', 'aVF', 'aVL', 'aVR'].sort());
    // Cyrillic: «с» U+0441, «к» U+043A — as in SpeciesLetter and expected.json.
    expect(texts('species')).toEqual(['к', 'с']);
    expect(texts('footer')).toEqual(expect.arrayContaining(['мм/с', 'мм/мВ']));
    // Merged pairs are split only for digit sets; for HR digits the width threshold is 9 px (spec).
    expect(file.sets.hrDigits.pairAbove).toBe(9);
    expect(file.sets.leadLabelsA.pairAbove).toBeUndefined();
    for (const [name, set] of Object.entries(file.sets)) {
      for (const g of set.glyphs) {
        expect(g.data.length, `${name}/${g.text}`).toBe(g.width * g.height);
        expect(Math.max(...g.data), `${name}/${g.text} contains ink`).toBeGreaterThan(0);
      }
    }
  });

  it('provenance: each template is cropped from the named fixture and coordinates — re-cropping matches byte for byte', () => {
    const file = readJson<GlyphsFile>('glyphs.json');
    const provenance = readJson<ProvenanceFile>('provenance.json');
    const images = new Map<string, ReturnType<typeof loadFixture>>();
    const image = (fixture: string) => {
      let img = images.get(fixture);
      if (!img) {
        img = loadFixture(fixture.replace(/\.jpg$/, ''));
        images.set(fixture, img);
      }
      return img;
    };
    for (const [name, set] of Object.entries(file.sets)) {
      const entries = provenance.entries.filter((e) => e.set === name);
      expect(entries.length, `provenance entries of ${name}`).toBe(set.glyphs.length);
      set.glyphs.forEach((g, k) => {
        const entry = entries[k];
        expect(entry.text, `provenance ${name}[${k}]`).toBe(g.text);
        const { rect, fixture } = entry;
        expect([rect.width, rect.height]).toEqual([g.width, g.height]);
        const img = image(fixture);
        const recut: number[] = [];
        for (let j = 0; j < rect.height; j++) {
          for (let i = 0; i < rect.width; i++) recut.push(softInk(img.data[(rect.y + j) * img.width + rect.x + i], file.inkThreshold));
        }
        expect(recut, `${name}/${g.text} from ${fixture} @${rect.x},${rect.y}`).toEqual(g.data);
      });
    }
  });
});

describe('matchGlyphs — nearest template with a margin', () => {
  const hrDigits = BUILTIN_GLYPH_SETS.hrDigits;

  it('HR digits of sheet a-07 (templates were not cropped from it): text per expected.json, correlation ≥ 0.85, margin ≥ 0.05', () => {
    const fixture = getFixture('a-07');
    const image = loadFixture(fixture);
    const layout = detectLayout(image, POLYSPECTRUM);
    const words = bandWords(image, layout.zones.hrRow!, POLYSPECTRUM.thresholds, FONTS.hr);
    const expected = fixture.expected.hrRow.map(String);
    expect(words.length).toBe(expected.length);
    let checked = 0;
    words.forEach((word, k) => {
      if (word.length !== expected[k].length) return; // merged pairs — a separate test
      word.forEach((glyph, i) => {
        const match = matchGlyphs(image, glyph, hrDigits);
        expect(match.text, `${expected[k]}[${i}] @x${glyph.x}`).toBe(expected[k][i]);
        expect(match.score, `${expected[k]}[${i}] correlation`).toBeGreaterThanOrEqual(0.85);
        expect(match.margin, `${expected[k]}[${i}] margin`).toBeGreaterThanOrEqual(0.05);
        checked++;
      });
    });
    expect(checked).toBeGreaterThan(30);
  });

  it('merged pair "44" in the number 144 on sheet a-01 (wider than 9 px) is read by trying pairs', () => {
    const fixture = getFixture('a-01');
    const image = loadFixture(fixture);
    const layout = detectLayout(image, POLYSPECTRUM);
    const words = bandWords(image, layout.zones.hrRow!, POLYSPECTRUM.thresholds, FONTS.hr);
    const word = words[fixture.expected.hrRow.indexOf(144)];
    const merged = word[word.length - 1];
    expect(merged.width).toBeGreaterThan(9);
    expect(matchGlyphs(image, merged, hrDigits).text).toBe('44');
  });

  it('a non-digit (lead label) and blank space → "?", no exception', () => {
    const image = loadFixture('a-01');
    const label = { x: 55, y: 534, width: 20, height: 8 }; // "aVR" in the label column
    expect(matchGlyphs(image, label, hrDigits).text).toBe('?');
    const blank = { x: 300, y: 10, width: 6, height: 10 }; // white margin above the header
    const match = matchGlyphs(image, blank, hrDigits);
    expect(match.text).toBe('?');
    expect(match.score).toBeLessThan(0.85);
  });
});

describe('readPageMeta on real sheets', () => {
  describe.each(fixtures)('$name', (fixture) => {
    const expected = fixture.expected;

    it('HR row fully matches expected.json, x centers increase and lie in the plot area', () => {
      const { layout, meta } = analyzed(fixture);
      expect(meta.hrRow.map((h) => h.value)).toEqual(expected.hrRow);
      const plot = layout.zones.plot!;
      meta.hrRow.forEach((h, k) => {
        expect(h.x, `x[${k}]`).toBeGreaterThanOrEqual(plot.x);
        expect(h.x, `x[${k}]`).toBeLessThan(plot.x + plot.width);
        if (k) expect(h.x).toBeGreaterThan(meta.hrRow[k - 1].x);
      });
      const centers = README_HR_CENTERS[fixture.name];
      centers?.forEach((x, k) => expect(Math.abs(meta.hrRow[k].x - x), `center ${k}:${meta.hrRow[k].x} vs ${x}`).toBeLessThanOrEqual(2));
      expect(issuesOf(meta)).not.toContain('hr_row_empty');
    });

    it('RR row in ms (B only) and footer HR match expected.json', () => {
      const { meta } = analyzed(fixture);
      if (expected.rrRowMs) expect(meta.rrRowMs).toEqual(expected.rrRowMs);
      else expect(meta.rrRowMs).toBeUndefined();
      expect(meta.footerHr).toBe(expected.footerHr);
    });

    it('time labels: text as in expected.json, seconds per the "mm:ss" or "s" format, x increases', () => {
      const { layout, meta } = analyzed(fixture);
      expect(meta.timeLabels.map((t) => t.text)).toEqual(expected.timeLabels);
      meta.timeLabels.forEach((label, k) => {
        const [mm, ss] = label.text.includes(':') ? label.text.split(':').map(Number) : [0, Number(label.text)];
        expect(label.seconds, label.text).toBe(mm * 60 + ss);
        if (k) expect(label.seconds).toBe(meta.timeLabels[k - 1].seconds + 1);
        const zone = layout.zones.timeLabels!;
        expect(label.x).toBeGreaterThanOrEqual(zone.x);
        expect(label.x).toBeLessThan(zone.x + zone.width);
      });
    });

    it('species letter and header date as in expected.json; footer calibration 50 mm/s, 10 mm/mV', () => {
      const { meta } = analyzed(fixture);
      expect(meta.speciesLetter).toBe(expected.speciesLetter);
      expect(meta.headerDate).toBe(expected.headerDate);
      expect(meta.footerCalib).toEqual({ mmPerS: 50, mmPerMv: 10 });
    });

    it('six lead labels in order I, II, III, aVR, aVL, aVF; rectangles in the label column next to their baselines', () => {
      const { layout, meta } = analyzed(fixture);
      expect(meta.leadLabels.map((l) => l.id)).toEqual(['I', 'II', 'III', 'aVR', 'aVL', 'aVF']);
      const column = layout.zones.leadLabels!;
      meta.leadLabels.forEach((label, k) => {
        const { rect } = label;
        expect(rect.x).toBeGreaterThanOrEqual(column.x);
        expect(rect.x + rect.width).toBeLessThanOrEqual(column.x + column.width);
        // The label sits above its lead baseline, no farther than 30 mm (the lead step) from it.
        const centerY = rect.y + rect.height / 2;
        expect(Math.abs(centerY - layout.expectedBaselines[k]), label.id).toBeLessThan(30 * layout.grid.pxPerMmY);
        if (k) expect(rect.y).toBeGreaterThan(meta.leadLabels[k - 1].rect.y);
      });
      expect(issuesOf(meta).filter((i) => i.startsWith('lead_label'))).toEqual([]);
    });

    it('reading confidence is high, no exceptions', () => {
      const { meta } = analyzed(fixture);
      expect(meta.confidence).toBeGreaterThanOrEqual(0.85);
      expect(issuesOf(meta).filter((i) => i.startsWith('exception'))).toEqual([]);
    });
  });

  it('headerNameCrop: binarized crop without date/time — Jaccard ≥ 0.5 between different sheets, 0 between copies', () => {
    const crops = fixtures.map((f) => analyzed(f).meta.headerNameCrop);
    const toPatch = (crop: GrayImage) => binarizeRect(crop, { x: 0, y: 0, width: crop.width, height: crop.height }, 128);
    const patches = crops.map(toPatch);
    crops.forEach((crop, i) => {
      expect(crop.width).toBeGreaterThan(100);
      expect(crop.height).toBeGreaterThan(8);
      // Only 0 (ink) and 255 (background), ink is present.
      expect(crop.data.every((v) => v === 0 || v === 255)).toBe(true);
      expect(crop.data.some((v) => v === 0)).toBe(true);
      const copy = toPatch({ width: crop.width, height: crop.height, data: Uint8Array.from(crop.data) });
      expect(jaccardDistance(patches[i], copy)).toBe(0);
      for (let j = 0; j < i; j++) {
        expect(jaccardDistance(patches[i], patches[j]), `${fixtures[i].name} vs ${fixtures[j].name}`).toBeGreaterThanOrEqual(0.5);
      }
    });
  });
});

describe('readPageMeta without text', () => {
  it('white synthetic sheet: fields empty/undefined, confidence 0, no exceptions', () => {
    const image = createGrayImage(1280, 905);
    const layout = detectLayout(image, POLYSPECTRUM);
    const meta = readPageMeta(image, layout, POLYSPECTRUM);
    expect(meta.hrRow).toEqual([]);
    expect(meta.rrRowMs).toBeUndefined();
    expect(meta.timeLabels).toEqual([]);
    expect(meta.leadLabels).toEqual([]);
    expect(meta.footerHr).toBeUndefined();
    expect(meta.footerCalib).toBeUndefined();
    expect(meta.headerDate).toBeUndefined();
    expect(meta.speciesLetter).toBeUndefined();
    expect(meta.headerNameCrop.data.every((v) => v === 255)).toBe(true);
    expect(meta.confidence).toBe(0);
    expect(issuesOf(meta)).toEqual(expect.arrayContaining(['hr_row_empty', 'time_labels_empty', 'footer_empty', 'header_date_unread', 'species_unread']));
    expect(issuesOf(meta).filter((i) => i.startsWith('exception'))).toEqual([]);
  });

  it('sheet with an erased footer: footer calibration and HR undefined, the rest is read', () => {
    const fixture = getFixture('a-01');
    const image = loadFixture(fixture);
    const layout = detectLayout(image, POLYSPECTRUM);
    const footer = layout.zones.footer!;
    for (let y = footer.y; y < footer.y + footer.height; y++) image.data.fill(255, y * image.width + footer.x, y * image.width + footer.x + footer.width);
    const meta = readPageMeta(image, layout, POLYSPECTRUM);
    expect(meta.footerCalib).toBeUndefined();
    expect(meta.footerHr).toBeUndefined();
    expect(issuesOf(meta)).toContain('footer_empty');
    expect(meta.hrRow.map((h) => h.value)).toEqual(fixture.expected.hrRow);
  });
});
