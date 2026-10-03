/**
 * Reading sheet fields by layout zones: HR row, RR row (B), time labels, lead labels, footer
 * (calibration and HR), header (date, species letter, pet-name crop). Each reader is a pure function over
 * `GrayImage`; it returns a value, confidence 0..1 and issue codes (snake_case). Words are read by `readWord`:
 * glyph positions from `decodeWord`, acceptance of each from `matchGlyphs` ("best with a margin").
 */
import {
  LEAD_IDS,
  type Calibration,
  type FormatProfile,
  type GlyphSet,
  type GrayImage,
  type LeadId,
  type LeadLabel,
  type PageLayout,
  type PrintedHr,
  type Rect,
  type SpeciesLetter,
  type TimeLabel,
} from '../../types/contracts';
import { decodeWord, findFragment, matchGlyphs, type FragmentHit, type Placement } from './match';
import { glyphSetFor } from './sets';
import { bandWords, FONTS, labelLines, textWords, wordRect, type BandFont } from './zones';

export interface Reading<T> {
  value: T;
  /** 0..1: fraction read × mean correlation of accepted glyphs; nothing found gives 0. */
  confidence: number;
  issues: string[];
}

/** One glyph of a word: what the DP placed and what `matchGlyphs` accepted ("?" means rejected). */
export interface PartReading extends Placement {
  text: string;
  score: number;
}

export interface WordReading {
  /** Word text; "?" in place of a glyph rejected by the "best with a margin" rule. */
  text: string;
  /** Minimum correlation over the word's glyphs (0 if there are no glyphs). */
  score: number;
  parts: PartReading[];
}

const mean = (values: number[]): number => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);
const right = (r: Rect): number => r.x + r.width - 1;
const centerX = (r: Rect): number => r.x + (r.width - 1) / 2;
const isDigit = (text: string): boolean => /^\d$/.test(text);

const digitsOnlyCache = new WeakMap<GlyphSet, GlyphSet>();

/** The same set without punctuation: digit placements are accepted among digits (a 2 px wide "1" otherwise loses its margin to ":"). */
function digitsOnly(set: GlyphSet): GlyphSet {
  let out = digitsOnlyCache.get(set);
  if (!out) {
    out = { ...set, glyphs: set.glyphs.filter((g) => isDigit(g.text)) };
    digitsOnlyCache.set(set, out);
  }
  return out;
}

/**
 * Reads a word: glyph positions by DP (whole set, including punctuation), each by the "best with a margin"
 * rule; a digit placement is checked against the set's digits only, punctuation against the whole set.
 */
export function readWord(img: GrayImage, rect: Rect, set: GlyphSet): WordReading {
  const parts = decodeWord(img, rect, set).map((part) => {
    const match = matchGlyphs(img, part.rect, isDigit(part.glyph.text) ? digitsOnly(set) : set);
    return { ...part, text: match.text, score: match.score };
  });
  return { text: parts.map((p) => p.text).join(''), score: parts.length ? Math.min(...parts.map((p) => p.score)) : 0, parts };
}

/**
 * Digits of a word: every digit placement must be accepted ("?" → word unread); punctuation placements
 * (".", ":") are not read by correlation (unreliable on a 2×5 px colon) and count only structurally
 * (date format by digit count, "mm:ss" by a ":" placement between the 2nd and 3rd digit, decimal point via `decimalOf`).
 */
function digitsOf(reading: WordReading): { digits: string; score: number } | undefined {
  const digitParts = reading.parts.filter((p) => isDigit(p.glyph.text));
  if (!digitParts.length || digitParts.some((p) => p.text === '?')) return undefined;
  return { digits: digitParts.map((p) => p.text).join(''), score: Math.min(...digitParts.map((p) => p.score)) };
}

/** Darkest pixel of the rectangle (255 outside the sheet). */
function darkest(img: GrayImage, rect: Rect): number {
  let min = 255;
  for (let j = 0; j < rect.height; j++) {
    const y = rect.y + j;
    if (y < 0 || y >= img.height) continue;
    for (let i = 0; i < rect.width; i++) {
      const x = rect.x + i;
      if (x >= 0 && x < img.width) min = Math.min(min, img.data[y * img.width + x]);
    }
  }
  return min;
}

/**
 * Footer number with an optional decimal point («12.5 мм/с»): digits strictly; a "." placement between digits
 * counts as a decimal point if its pixel is darker than the ink core (`inkCore`; an anti-aliasing pixel is lighter);
 * two dots means not a number. ":" placements (never part of a number) are ignored.
 */
function decimalOf(reading: WordReading, img: GrayImage, inkCore: number): { value: number; score: number } | undefined {
  const digits = digitsOf(reading);
  if (!digits) return undefined;
  let text = '';
  let dots = 0;
  reading.parts.forEach((p, k) => {
    if (isDigit(p.glyph.text)) text += p.text;
    else if (p.glyph.text === '.' && k > 0 && k < reading.parts.length - 1 && darkest(img, p.rect) < inkCore) {
      text += '.';
      dots++;
    }
  });
  if (dots > 1 || /^\.|\.$/.test(text)) return undefined;
  return { value: Number(text), score: digits.score };
}

/** Number row (HR above lead I, RR at the bottom of variant B): each number with its x center. */
export function readNumberRow(
  img: GrayImage,
  zone: Rect,
  set: GlyphSet,
  font: BandFont,
  profile: FormatProfile,
  prefix: string,
): Reading<PrintedHr[]> {
  const words = bandWords(img, zone, profile.thresholds, font);
  const issues: string[] = [];
  const value: PrintedHr[] = [];
  const scores: number[] = [];
  for (const word of words) {
    const rect = wordRect(word);
    const number = digitsOf(readWord(img, rect, set));
    if (number) {
      value.push({ value: Number(number.digits), x: centerX(rect) });
      scores.push(number.score);
    } else {
      issues.push(`${prefix}_number_unread:${rect.x}`);
    }
  }
  if (!words.length) issues.push(`${prefix}_row_empty`);
  return { value, confidence: words.length ? (value.length / words.length) * mean(scores) : 0, issues };
}

/**
 * Time label: "mm:ss" is four digits with a ":" placement (or a gap ≥ 2 px) between the second and third,
 * otherwise seconds as an integer. Returns the canonical text and seconds.
 */
function parseTimeLabel(reading: WordReading): { text: string; seconds: number; score: number } | undefined {
  const number = digitsOf(reading);
  if (!number) return undefined;
  const digitParts = reading.parts.filter((p) => isDigit(p.glyph.text));
  if (number.digits.length === 4) {
    const colonPlaced = reading.parts.some((p) => p.glyph.text === ':' && p.rect.x > digitParts[1].rect.x && p.rect.x < digitParts[2].rect.x);
    const gap = digitParts[2].rect.x - right(digitParts[1].rect) - 1;
    if (colonPlaced || gap >= 2) {
      const text = `${number.digits.slice(0, 2)}:${number.digits.slice(2)}`;
      return { text, seconds: Number(number.digits.slice(0, 2)) * 60 + Number(number.digits.slice(2)), score: number.score };
    }
  }
  if (reading.parts.some((p) => p.glyph.text === ':')) return undefined;
  return { text: number.digits, seconds: Number(number.digits), score: number.score };
}

/** Time labels above the frame: text, seconds, x center. */
export function readTimeLabels(img: GrayImage, zone: Rect, profile: FormatProfile): Reading<TimeLabel[]> {
  const words = bandWords(img, zone, profile.thresholds, FONTS.time);
  const set = glyphSetFor(profile, 'timeDigits');
  const issues: string[] = [];
  const value: TimeLabel[] = [];
  const scores: number[] = [];
  for (const word of words) {
    const rect = wordRect(word);
    const label = parseTimeLabel(readWord(img, rect, set));
    if (!label) {
      issues.push(`time_label_unread:${rect.x}`);
      continue;
    }
    value.push({ text: label.text, seconds: label.seconds, x: centerX(rect) });
    scores.push(label.score);
  }
  if (!words.length) issues.push('time_labels_empty');
  return { value, confidence: words.length ? (value.length / words.length) * mean(scores) : 0, issues };
}

/** Lead labels in the left column: six lines top to bottom in `LEAD_IDS` order. */
export function readLeadLabels(img: GrayImage, zone: Rect, layout: PageLayout, profile: FormatProfile): Reading<LeadLabel[]> {
  const set = glyphSetFor(profile, layout.variant === 'B' ? 'leadLabelsB' : 'leadLabelsA');
  const lines = labelLines(img, zone, profile.thresholds);
  const issues: string[] = [];
  const value: LeadLabel[] = [];
  const scores: number[] = [];
  for (const line of lines) {
    const match = matchGlyphs(img, line, set);
    if (match.text === '?') {
      issues.push(`lead_label_unread:${line.y}`);
      continue;
    }
    value.push({ id: match.text as LeadId, rect: { x: line.x, y: line.y, width: line.width, height: line.height } });
    scores.push(match.score);
  }
  const ids = value.map((l) => l.id);
  for (const id of LEAD_IDS) if (!ids.includes(id)) issues.push(`lead_label_missing:${id}`);
  if (ids.length === LEAD_IDS.length && ids.some((id, k) => id !== LEAD_IDS[k])) issues.push('lead_labels_order');
  const found = LEAD_IDS.filter((id) => ids.includes(id)).length;
  return { value, confidence: (found / LEAD_IDS.length) * mean(scores), issues };
}

export interface FooterReading {
  calib?: Calibration;
  hr?: number;
}

/** x distance between a word and an anchor within which the word counts as adjacent («50 мм/с», «ЧСС: 138»). */
const NEIGHBOUR_GAP = 8;

/**
 * Footer: calibration is the numbers before the fragments «мм/с» and «мм/мВ» (mm/s, mm/mV), HR is the number after
 * «ЧСС:» (HR); fragments are found by sliding along the footer line. An unreadable footer → `undefined` fields, no exception.
 */
export function readFooter(img: GrayImage, zone: Rect, profile: FormatProfile): Reading<FooterReading> {
  const words = textWords(img, zone, profile.thresholds);
  const issues: string[] = [];
  if (!words.length) return { value: {}, confidence: 0, issues: ['footer_empty'] };
  const rects = words.map(wordRect);
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const area: Rect = { x: zone.x, y: top - 1, width: zone.width, height: bottom - top + 2 };
  const anchors = glyphSetFor(profile, 'footer');
  const digits = glyphSetFor(profile, 'textDigits');
  const scores: number[] = [];

  /** The best of the fragment's instances (variants A and B print the footer with different print phases). */
  const anchor = (text: string): FragmentHit | undefined => {
    let best: FragmentHit | undefined;
    for (const glyph of anchors.glyphs) {
      if (glyph.text !== text) continue;
      const hit = findFragment(img, area, glyph, anchors.inkThreshold);
      if (hit && (!best || hit.score > best.score)) best = hit;
    }
    return best;
  };
  const numberAt = (rect: Rect | undefined): number | undefined => {
    if (!rect) return undefined;
    const number = decimalOf(readWord(img, rect, digits), img, profile.thresholds.inkCore);
    if (!number) return undefined;
    scores.push(number.score);
    return number.value;
  };
  const before = (hit: FragmentHit | undefined): Rect | undefined => {
    if (!hit) return undefined;
    const candidates = rects.filter((r) => right(r) < hit.rect.x && hit.rect.x - right(r) - 1 <= NEIGHBOUR_GAP);
    return candidates.length ? candidates[candidates.length - 1] : undefined;
  };
  const after = (hit: FragmentHit | undefined): Rect | undefined => {
    if (!hit) return undefined;
    return rects.find((r) => r.x > right(hit.rect) && r.x - right(hit.rect) - 1 <= NEIGHBOUR_GAP);
  };

  const hitS = anchor('мм/с');
  const hitMv = anchor('мм/мВ');
  const hitHr = anchor('ЧСС:');
  for (const hit of [hitS, hitMv, hitHr]) if (hit) scores.push(hit.score);
  const mmPerS = numberAt(before(hitS));
  const mmPerMv = numberAt(before(hitMv));
  const hr = numberAt(after(hitHr));

  const value: FooterReading = {};
  if (mmPerS !== undefined && mmPerMv !== undefined) value.calib = { mmPerS, mmPerMv };
  else issues.push('footer_calib_unread');
  if (hr !== undefined) value.hr = hr;
  else issues.push('footer_hr_unread');
  const read = (value.calib ? 2 : 0) + (value.hr ? 1 : 0);
  return { value, confidence: (read / 3) * mean(scores), issues };
}

export interface HeaderReading {
  date?: string;
  species?: SpeciesLetter;
  crop: GrayImage;
}

/** Binarized sheet crop: 0 is ink (darker than the threshold), 255 is background. */
function binarizedCrop(img: GrayImage, rect: Rect, threshold: number): GrayImage {
  const width = Math.max(0, Math.round(rect.width));
  const height = Math.max(0, Math.round(rect.height));
  const data = new Uint8Array(width * height).fill(255);
  for (let j = 0; j < height; j++) {
    const y = rect.y + j;
    if (y < 0 || y >= img.height) continue;
    for (let i = 0; i < width; i++) {
      const x = rect.x + i;
      if (x >= 0 && x < img.width && img.data[y * img.width + x] < threshold) data[j * width + i] = 0;
    }
  }
  return { width, height, data };
}

/**
 * Header «ДД.ММ.ГГГГ ЧЧ:ММ:СС ЭКГ <с|к> <кличка>, …» (date, time, ECG, species letter, pet name): date and time
 * are the first two words (regular-font templates; the format is set by the digit count, 8 and 6, dots and colons
 * are structural), the species letter is a single glyph after the word «ЭКГ», the pet-name crop runs from the word
 * «ЭКГ» to the end of the zone.
 */
export function readHeader(img: GrayImage, zone: Rect, profile: FormatProfile): Reading<HeaderReading> {
  const words = textWords(img, zone, profile.thresholds).map(wordRect);
  const issues: string[] = [];
  const scores: number[] = [];
  const value: HeaderReading = { crop: binarizedCrop(img, zone, profile.thresholds.headerThreshold) };

  if (words.length >= 2) {
    const date = digitsOf(readWord(img, words[0], glyphSetFor(profile, 'textDigits')));
    const time = digitsOf(readWord(img, words[1], glyphSetFor(profile, 'textDigits')));
    if (date?.digits.length === 8 && time?.digits.length === 6) {
      const d = date.digits;
      const t = time.digits;
      value.date = `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)} ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}`;
      scores.push(Math.min(date.score, time.score));
    }
  }
  if (value.date === undefined) {
    issues.push('header_date_unread');
    scores.push(0);
  }

  const anchor = words.length >= 3 ? matchGlyphs(img, words[2], glyphSetFor(profile, 'header')) : undefined;
  const letter = anchor?.text === 'ЭКГ' && words.length >= 4 ? matchGlyphs(img, words[3], glyphSetFor(profile, 'species')) : undefined;
  if (letter && letter.text !== '?') {
    value.species = letter.text as SpeciesLetter;
    scores.push(letter.score);
  } else {
    issues.push('species_unread');
    scores.push(0);
  }

  // Crop without the date/time prefix: from the start of the third word («ЭКГ»), otherwise the whole zone.
  const start = words.length >= 3 ? words[2].x : zone.x;
  value.crop = binarizedCrop(img, { x: start, y: zone.y, width: zone.x + zone.width - start, height: zone.height }, profile.thresholds.headerThreshold);
  return { value, confidence: mean(scores), issues };
}
