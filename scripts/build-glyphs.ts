/**
 * Rebuilds the "Poly-Spectrum.NET" glyph templates from the fixtures:
 *
 *   node --import ./scripts/ts-hooks.mjs scripts/build-glyphs.ts
 *
 * All clean occurrences of each character are collected in fixture order `a-01 … b-02`: a zone word (HR row, RR row,
 * time labels, header date/time, footer numbers and fragments) is accepted if its glyph count equals the length of
 * the expected text from `expected.json` (merged pairs are skipped); lead labels are the six lines of each sheet's
 * label column. From a character's occurrences, instances with different sub-pixel print phases are picked greedily:
 * an occurrence becomes a template if its correlation with every template already picked for that character is below
 * `SAME_PHASE` (for one character printed with a half-pixel shift, correlation with a single template dropped
 * to 0.64–0.8; the probe got 0.89–0.95 with templates from three sheets). A template is the soft ink of a crop
 * (`cutGlyph`, threshold 170) over the glyph rectangle found by `zones.ts` segmentation at the font threshold;
 * `dy` is the offset of the glyph top from the word top (dots and colons sit below digits). Crop coordinates are in
 * `provenance.json`, one entry per template in `glyphs.json` order. The result is deterministic.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectLayout } from '../src/core/layout';
import { alignSequence, cutGlyph, DEFAULT_INK_THRESHOLD, matchGlyphs } from '../src/core/pagemeta/match';
import { union, type Box } from '../src/core/pagemeta/segment';
import { bandWords, FONTS, labelLines, textWords, type BandFont } from '../src/core/pagemeta/zones';
import { POLYSPECTRUM } from '../src/core/profile';
import { LEAD_IDS, type Glyph, type GrayImage, type Rect } from '../src/types/contracts';
import { FIXTURES_DIR, listFixtures, loadFixture } from '../test/fixtures';

const OUT_DIR = join(FIXTURES_DIR, 'glyphs');
const THRESHOLDS = POLYSPECTRUM.thresholds;
const INK = DEFAULT_INK_THRESHOLD;
/** Correlation above which an occurrence is considered the same print phase as an already picked template. */
const SAME_PHASE = 0.93;
/** Cap on templates per character (thin fonts show more than ten print phases across 10 sheets). */
const MAX_INSTANCES = 16;
/** Minimum correlation of a composite template with a merged word of known text (second pass). */
const MIN_ALIGNED = 0.6;

/** Sets in output order, character order within each set, and each set's font (component threshold). */
const SETS: Record<string, { texts: readonly string[]; font: BandFont; pairs: boolean }> = {
  hrDigits: { texts: [...'0123456789'], font: FONTS.hr, pairs: true },
  rrDigits: { texts: [...'0123456789'], font: FONTS.rr, pairs: true },
  timeDigits: { texts: [...'0123456789:'], font: FONTS.time, pairs: true },
  textDigits: { texts: [...'0123456789.:'], font: FONTS.text, pairs: true },
  leadLabelsA: { texts: LEAD_IDS, font: FONTS.labels, pairs: false },
  leadLabelsB: { texts: LEAD_IDS, font: FONTS.labels, pairs: false },
  species: { texts: ['с', 'к'], font: FONTS.text, pairs: false },
  header: { texts: ['ЭКГ'], font: FONTS.text, pairs: false },
  footer: { texts: ['мм/с', 'мм/мВ', 'ЧСС:'], font: FONTS.text, pairs: false },
};

interface Entry {
  glyph: Glyph;
  fixture: string;
  img: GrayImage;
  rect: Rect;
}

/** All clean occurrences: set → character → occurrences in fixture order. */
const occurrences = new Map<string, Map<string, Entry[]>>();
const log: string[] = [];

/** A merged word with known text, for the second pass. */
interface MergedWord {
  set: string;
  text: string;
  img: GrayImage;
  fixture: string;
  rect: Rect;
  lineTop: number;
}
const merged: MergedWord[] = [];

/** Record a character occurrence; `lineTop` is the word top that `dy` is measured from. */
function take(set: string, text: string, img: GrayImage, fixture: string, box: Box, lineTop = box.y): void {
  let bySet = occurrences.get(set);
  if (!bySet) occurrences.set(set, (bySet = new Map()));
  let list = bySet.get(text);
  if (!list) bySet.set(text, (list = []));
  const rect: Rect = { x: box.x, y: box.y, width: box.width, height: box.height };
  const glyph = cutGlyph(img, rect, INK, text);
  if (!glyph.data.some((v) => v > 0)) {
    log.push(`${fixture} ${set}: «${text}» @${rect.x},${rect.y} — пустая вырезка, пропущена`);
    return;
  }
  if (box.y > lineTop) glyph.dy = box.y - lineTop;
  list.push({ glyph, fixture, img, rect });
}

/** Correlation of template `glyph` with the location of occurrence `entry` on its sheet. */
const scoreOn = (entry: Entry, glyph: Glyph): number => matchGlyphs(entry.img, entry.rect, { name: 'probe', glyphs: [glyph], inkThreshold: INK }).score;

/**
 * Greedy selection of a character's instances with different print phases: the first always, then those unlike the
 * picked ones. Similarity is checked both ways (template at the occurrence and occurrence at the template): with
 * crops of different size, a one-way comparison hides a clipped column.
 */
function selectInstances(list: Entry[]): Entry[] {
  const chosen: Entry[] = [];
  for (const entry of list) {
    if (chosen.length >= MAX_INSTANCES) break;
    const similar = chosen.some((c) => Math.min(scoreOn(entry, c.glyph), scoreOn(c, entry.glyph)) >= SAME_PHASE);
    if (!similar) chosen.push(entry);
  }
  return chosen;
}

/** Zone words against expected strings: glyph ↔ character if the word's glyph count equals the string length. */
function alignWords(set: string, words: Box[][], expected: string[], img: GrayImage, fixture: string, zone: string): void {
  if (words.length !== expected.length) {
    log.push(`${fixture} ${zone}: слов ${words.length}, ожидалось ${expected.length} — зона пропущена`);
    return;
  }
  words.forEach((word, k) => {
    const text = expected[k];
    const box = union(word);
    if (word.length !== text.length) {
      log.push(`${fixture} ${zone}: «${text}» — глифов ${word.length} (слипшиеся), во второй проход`);
      merged.push({ set, text, img, fixture, rect: { x: box.x, y: box.y, width: box.width, height: box.height }, lineTop: box.y });
      return;
    }
    word.forEach((glyph, i) => take(set, text[i], img, fixture, glyph, box.y));
  });
}

for (const fixture of listFixtures()) {
  const img = loadFixture(fixture);
  const { zones, variant } = detectLayout(img, POLYSPECTRUM);
  const file = fixture.expected.file;
  const e = fixture.expected;

  // HR row, RR row, time labels.
  alignWords('hrDigits', bandWords(img, zones.hrRow!, THRESHOLDS, FONTS.hr), e.hrRow.map(String), img, file, 'hrRow');
  if (zones.rrRow && e.rrRowMs) alignWords('rrDigits', bandWords(img, zones.rrRow, THRESHOLDS, FONTS.rr), e.rrRowMs.map(String), img, file, 'rrRow');
  alignWords('timeDigits', bandWords(img, zones.timeLabels!, THRESHOLDS, FONTS.time), e.timeLabels, img, file, 'timeLabels');

  // Header: «ДД.ММ.ГГГГ ЧЧ:ММ:СС ЭКГ <с|к> <кличка>…» (date, time, ECG, species letter, pet name) — the first two
  // words give digits, ".", ":"; the third is «ЭКГ»; the fourth (one glyph) is the species letter.
  const headerWords = textWords(img, zones.headerName!, THRESHOLDS);
  const [date, time] = e.headerDate.split(' ');
  if (headerWords.length >= 4) {
    alignWords('textDigits', headerWords.slice(0, 2), [date, time], img, file, 'header');
    if (headerWords[2].length <= 3) take('header', 'ЭКГ', img, file, union(headerWords[2]));
    if (headerWords[3].length === 1) take('species', e.speciesLetter, img, file, headerWords[3][0]);
  } else {
    log.push(`${file} header: слов ${headerWords.length} < 4`);
  }

  // Footer: words against tokens of the expected string; for «мм/с;» and «мм/мВ;» the template omits the trailing ";".
  const footerWords = textWords(img, zones.footer!, THRESHOLDS);
  const tokens = e.footer.split(' ');
  if (footerWords.length >= tokens.length) {
    tokens.forEach((token, k) => {
      const word = footerWords[k];
      const box = union(word);
      if (word.length !== token.length) {
        if (/^\d+$/.test(token)) {
          log.push(`${file} footer: «${token}» — глифов ${word.length} (слипшиеся), во второй проход`);
          merged.push({ set: 'textDigits', text: token, img, fixture: file, rect: { x: box.x, y: box.y, width: box.width, height: box.height }, lineTop: box.y });
        } else if (token.startsWith('мм/') || token === 'ЧСС:') {
          log.push(`${file} footer: «${token}» — глифов ${word.length}, пропущено`);
        }
        return;
      }
      const top = box.y;
      if (/^\d+$/.test(token)) word.forEach((g, i) => take('textDigits', token[i], img, file, g, top));
      else if (token === 'мм/с;' || token === 'мм/мВ;') take('footer', token.slice(0, -1), img, file, union(word.slice(0, -1)));
      else if (token === 'ЧСС:') take('footer', token, img, file, union(word));
    });
  } else {
    log.push(`${file} footer: слов ${footerWords.length} < токенов ${tokens.length}`);
  }

  // Lead labels: by column lines, top to bottom.
  const lines = labelLines(img, zones.leadLabels!, THRESHOLDS);
  if (lines.length === LEAD_IDS.length) lines.forEach((line, k) => take(`leadLabels${variant}`, LEAD_IDS[k], img, file, line));
  else log.push(`${file} leadLabels: строк ${lines.length}, ожидалось 6`);
}

// Completeness check over clean occurrences.
const missing: string[] = [];
for (const [set, { texts }] of Object.entries(SETS)) {
  for (const text of texts) if (!occurrences.get(set)?.get(text)?.length) missing.push(`${set}/${text}`);
}
if (missing.length) {
  console.error(`Не найдены шаблоны: ${missing.join(', ')}\n${log.join('\n')}`);
  process.exit(1);
}

/** Instance selection for all sets from the current occurrence pool. */
function selectAll(): Map<string, Entry[]> {
  const out = new Map<string, Entry[]>();
  for (const [set, { texts }] of Object.entries(SETS)) out.set(set, texts.flatMap((t) => selectInstances(occurrences.get(set)!.get(t)!)));
  return out;
}

// Second pass: merged words of known text are aligned with a composite of their characters' first instances;
// the rectangles found yield occurrences with that sheet's print phase (otherwise sheets whose words are all merged
// stay unrepresented: footer "50" on all variant A sheets, variant B time labels).
const provisional = selectAll();
let aligned = 0;
for (const word of merged) {
  const instances = provisional.get(word.set)!;
  const ofChar = (ch: string): Glyph[] => instances.filter((e) => e.glyph.text === ch).map((e) => e.glyph);
  let sequence = [...word.text].map((ch) => ofChar(ch)[0]);
  if (sequence.some((g) => g === undefined)) continue;
  // Round 1: first instances of the characters; round 2: at the found locations each character is replaced by the
  // instance with the best correlation (the first instance may differ in phase or height and give 0.46 where the best
  // gives 0.83).
  let best = alignSequence(word.img, word.rect, sequence, INK);
  if (best.parts.length) {
    sequence = best.parts.map((p) => {
      const candidates = ofChar(p.glyph.text);
      const scored = candidates.map((g) => matchGlyphs(word.img, p.rect, { name: 'probe', glyphs: [g], inkThreshold: INK }).score);
      return candidates[scored.indexOf(Math.max(...scored))];
    });
    const refined = alignSequence(word.img, word.rect, sequence, INK);
    if (refined.score > best.score) best = refined;
  }
  if (best.score < MIN_ALIGNED) {
    log.push(`${word.fixture} ${word.set}: «${word.text}» не выровнено (корреляция ${best.score.toFixed(2)})`);
    continue;
  }
  best.parts.forEach((p) => take(word.set, p.glyph.text, word.img, word.fixture, { ...p.rect, area: 0 }, word.lineTop));
  aligned++;
}
const selected = selectAll();

const preview = (g: Glyph): string[] =>
  Array.from({ length: g.height }, (_, j) => Array.from({ length: g.width }, (_, i) => (g.data[j * g.width + i] >= 128 ? '#' : '.')).join(''));

const setsJson = Object.entries(SETS)
  .map(([set, { pairs }]) => {
    const entries = selected.get(set)!;
    const widest = Math.max(...entries.map((e) => e.glyph.width));
    const head = pairs ? `      "pairAbove": ${widest + 2},\n` : '';
    const glyphs = entries
      .map(({ glyph }) => {
        const dy = glyph.dy ? `, "dy": ${glyph.dy}` : '';
        const rows = preview(glyph).map((r) => JSON.stringify(r)).join(', ');
        return `        {"text": ${JSON.stringify(glyph.text)}, "width": ${glyph.width}, "height": ${glyph.height}${dy},\n         "preview": [${rows}],\n         "data": [${Array.from(glyph.data).join(',')}]}`;
      })
      .join(',\n');
    return `    "${set}": {\n${head}      "glyphs": [\n${glyphs}\n      ]\n    }`;
  })
  .join(',\n');

const glyphsFile = `{
  "_note": "Шаблоны глифов листов «Поли-Спектр.NET» для шаблонного чтения (src/core/pagemeta). Вырезаны из фикстур скриптом scripts/build-glyphs.ts (координаты — provenance.json). data — мягкие чернила построчно: 0 при яркости ≥ inkThreshold, иначе (inkThreshold − яркость)·255/inkThreshold; preview — то же при пороге 128; dy — смещение верха глифа от верха строки шрифта (точки и двоеточия ниже цифр). Наборы: hrDigits — жирные цифры мгновенной ЧСС (10 px), rrDigits — жирные цифры ряда RR варианта Б (9 px), timeDigits — мелкие цифры и «:» меток времени (7 px), textDigits — цифры, «.», «:» обычного шрифта шапки и футера, leadLabelsA/B — подписи отведений на вариант, species — буквы вида «с»/«к» (кириллица) после «ЭКГ», header — фрагмент «ЭКГ», footer — фрагменты футера. pairAbove — глиф шире этого числа px читается как слипшаяся пара (цифры ЧСС: 9).",
  "inkThreshold": ${INK},
  "sets": {
${setsJson}
  }
}
`;

const provenanceEntries = Object.entries(SETS)
  .flatMap(([set, { font }]) =>
    selected.get(set)!.map((e) => {
      const rect = `{"x": ${e.rect.x}, "y": ${e.rect.y}, "width": ${e.rect.width}, "height": ${e.rect.height}}`;
      return `    {"set": "${set}", "text": ${JSON.stringify(e.glyph.text)}, "fixture": "${e.fixture}", "rect": ${rect}, "boxThreshold": ${THRESHOLDS[font.ink]}}`;
    }),
  )
  .join(',\n');
const provenanceFile = `{
  "_note": "Происхождение шаблонов glyphs.json — по одной записи на шаблон в порядке glyphs.json: из какой фикстуры fixtures/polyspectrum/<fixture> и какого прямоугольника (px листа: левый верхний угол и размер) вырезан шаблон. Прямоугольник — bbox компонент темнее boxThreshold (порог шрифта: 130 — жирные, 170 — мелкие и обычные), значения — мягкие чернила при пороге ${INK}. Собрано scripts/build-glyphs.ts: чистые вхождения знака по порядку фикстур a-01 … b-02, из них отобраны экземпляры с разной фазой печати (корреляция с уже отобранными < ${SAME_PHASE}).",
  "entries": [
${provenanceEntries}
  ]
}
`;

writeFileSync(join(OUT_DIR, 'glyphs.json'), glyphsFile);
writeFileSync(join(OUT_DIR, 'provenance.json'), provenanceFile);
const total = [...selected.values()].reduce((s, list) => s + list.length, 0);
const found = [...occurrences.values()].reduce((s, m) => s + [...m.values()].reduce((q, l) => q + l.length, 0), 0);
console.log(`Записано ${total} шаблонов (из ${found} вхождений; слипшихся слов выровнено ${aligned} из ${merged.length}) в ${OUT_DIR}`);
for (const [set, list] of selected) {
  const perText = new Map<string, number>();
  for (const e of list) perText.set(e.glyph.text, (perText.get(e.glyph.text) ?? 0) + 1);
  console.log(`  ${set}: ${[...perText].map(([t, n]) => `${t}×${n}`).join(' ')}`);
}
if (log.length) console.log(`Пропуски при сборе (слипшиеся слова и несовпавшие зоны):\n${log.join('\n')}`);
