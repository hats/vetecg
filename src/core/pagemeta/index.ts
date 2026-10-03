/**
 * Module `pagemeta`: digits and header read from the sheet. Exposes `readPageMeta(img, layout, profile) -> PageMeta`
 * and template reading `matchGlyphs(img, rect, set)` (per the spec it belongs to the profile; implemented here,
 * the profile keeps a stub), the built-in glyph sets `BUILTIN_GLYPH_SETS` and `glyphSetFor`.
 * Hides segmentation, correlation, and splitting of merged glyphs.
 *
 * An exception inside a step does not fail the sheet: it becomes `issue` `exception:<step>:<message>`, the field stays empty.
 * Confidence is the mean over fields (HR row, time labels, labels, footer, header, RR row for B); empty sheet gives 0.
 */
import type { FormatProfile, GrayImage, PageLayout, PageMeta, Rect, ZoneName } from '../../types/contracts';
import { readFooter, readHeader, readLeadLabels, readNumberRow, readTimeLabels } from './readers';
import { glyphSetFor } from './sets';
import { FONTS } from './zones';

export { ACCEPT_MARGIN, ACCEPT_SCORE, decodeWord, findFragment, matchGlyphs } from './match';
export type { FragmentHit, Placement } from './match';
export { BUILTIN_GLYPH_SETS, glyphSetFor } from './sets';
export type { BuiltinGlyphSetName } from './sets';
export { readWord } from './readers';

const EMPTY_CROP: GrayImage = { width: 0, height: 0, data: new Uint8Array(0) };

export function readPageMeta(img: GrayImage, layout: PageLayout, profile: FormatProfile): PageMeta {
  const issues: string[] = [];
  const fields: number[] = [];
  const meta: PageMeta = { hrRow: [], timeLabels: [], leadLabels: [], headerNameCrop: EMPTY_CROP, confidence: 0, issues };

  /** Read step: the zone is required; an exception → issue and zero field confidence. */
  const step = (name: string, zone: ZoneName, read: (rect: Rect) => number): void => {
    const rect = layout.zones[zone];
    if (!rect) {
      issues.push(`zone_missing:${zone}`);
      fields.push(0);
      return;
    }
    try {
      fields.push(read(rect));
    } catch (error) {
      issues.push(`exception:${name}:${error instanceof Error ? error.message : String(error)}`);
      fields.push(0);
    }
  };

  step('hr_row', 'hrRow', (zone) => {
    const r = readNumberRow(img, zone, glyphSetFor(profile, 'hrDigits'), FONTS.hr, profile, 'hr');
    meta.hrRow = r.value;
    issues.push(...r.issues);
    return r.confidence;
  });
  if (layout.zones.rrRow) {
    step('rr_row', 'rrRow', (zone) => {
      const r = readNumberRow(img, zone, glyphSetFor(profile, 'rrDigits'), FONTS.rr, profile, 'rr');
      meta.rrRowMs = r.value.map((n) => n.value);
      issues.push(...r.issues);
      return r.confidence;
    });
  }
  step('time_labels', 'timeLabels', (zone) => {
    const r = readTimeLabels(img, zone, profile);
    meta.timeLabels = r.value;
    issues.push(...r.issues);
    return r.confidence;
  });
  step('lead_labels', 'leadLabels', (zone) => {
    const r = readLeadLabels(img, zone, layout, profile);
    meta.leadLabels = r.value;
    issues.push(...r.issues);
    return r.confidence;
  });
  step('footer', 'footer', (zone) => {
    const r = readFooter(img, zone, profile);
    if (r.value.calib) meta.footerCalib = r.value.calib;
    if (r.value.hr !== undefined) meta.footerHr = r.value.hr;
    issues.push(...r.issues);
    return r.confidence;
  });
  step('header', 'headerName', (zone) => {
    const r = readHeader(img, zone, profile);
    meta.headerNameCrop = r.value.crop;
    if (r.value.date !== undefined) meta.headerDate = r.value.date;
    if (r.value.species !== undefined) meta.speciesLetter = r.value.species;
    issues.push(...r.issues);
    return r.confidence;
  });

  meta.confidence = fields.length ? fields.reduce((s, v) => s + v, 0) / fields.length : 0;
  return meta;
}
