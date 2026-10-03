/**
 * Module `ink`: ink and components. Exposes `extractInk(img, layout, profile) -> InkMask`; hides the
 * 130/170 hysteresis and the removal of grid remnants, the "+" lattice and text (per component, not by cutting zones).
 *
 * Order: hysteresis component labeling inside the frame → drop components without a core and with area
 * below `minComponentArea` (grid remnants) → "+" lattice at layout positions (free-standing ones removed
 * entirely, curve-covered ones trimmed to the curve band measured in neighbouring columns) → compact
 * glyph-like components in the profile's text zones go to `textComponents`. A curve entering a
 * text zone stays: it is not compact.
 */
import type { FormatProfile, GrayImage, InkComponent, InkMask, PageLayout, Point, Rect, ZoneName } from '../../types/contracts';
import { labelHysteresis, type RawComponent } from './components';

export const INK = 255;

/** Profile zones that hold text; compact components inside them are glyphs. */
const TEXT_ZONES: ZoneName[] = ['timeLabels', 'hrRow', 'leadLabels', 'rrRow'];

/** Glyph-like component: no wider than a merged pair of digits and no shorter than the smallest time label. */
const GLYPH_MAX_WIDTH = 16;
const GLYPH_MAX_HEIGHT = 12;
const GLYPH_MIN_HEIGHT = 5;
const GLYPH_MIN_WIDTH = 2;
/** Position tolerance of a component relative to the text zone, px. */
const ZONE_SLACK = 2;

/** "+" cross mark: 3–5 px; with the anti-aliased fringe no larger than 7×7 and no heavier than 30 px. */
const PLUS_MAX_SIZE = 7;
const PLUS_MAX_AREA = 30;
/** Search radius for a cross mark around its predicted position, px. */
const PLUS_SEARCH = 3;
/** Half the length of a cross-mark arm, px (5×5 cross). */
const PLUS_ARM = 2;

interface Working {
  img: GrayImage;
  region: Rect;
  labels: Int32Array;
  byId: Map<number, RawComponent>;
  alive: Set<number>;
  /** Ink core threshold: a darker pixel is the curve body, not the anti-aliased fringe. */
  core: number;
}

function toComponent(c: RawComponent, area: number): InkComponent {
  return { id: c.id, bbox: { x: c.xmin, y: c.ymin, width: c.xmax - c.xmin + 1, height: c.ymax - c.ymin + 1 }, area };
}

function isSmall(c: RawComponent): boolean {
  return c.xmax - c.xmin + 1 <= PLUS_MAX_SIZE && c.ymax - c.ymin + 1 <= PLUS_MAX_SIZE && c.area <= PLUS_MAX_AREA;
}

/** Erases a component entirely (pixels in its bbox carrying its label). */
function eraseComponent(w: Working, c: RawComponent): void {
  const { labels } = w;
  const width = w.img.width;
  for (let y = c.ymin; y <= c.ymax; y++) {
    const row = y * width;
    for (let x = c.xmin; x <= c.xmax; x++) if (labels[row + x] === c.id) labels[row + x] = 0;
  }
  w.alive.delete(c.id);
}

function isInkPixel(w: Working, x: number, y: number): boolean {
  const { region } = w;
  if (x < region.x || y < region.y || x > region.x + region.width - 1 || y > region.y + region.height - 1) return false;
  const id = w.labels[y * w.img.width + x];
  return id !== 0 && w.alive.has(id);
}

/** Pixels of a "+" cross centred at (x, y): horizontal and vertical arms of length 2·PLUS_ARM + 1. */
function crossPixels(x: number, y: number): { x: number; y: number; vertical: boolean }[] {
  const out: { x: number; y: number; vertical: boolean }[] = [];
  for (let d = -PLUS_ARM; d <= PLUS_ARM; d++) {
    out.push({ x: x + d, y, vertical: false });
    if (d !== 0) out.push({ x, y: y + d, vertical: true });
  }
  return out;
}

/**
 * Curve-covered cross mark. The cross is located precisely — as the position within ±2 px of the predicted one where
 * the "+" shape holds the most ink of the component; its pixels are removed, then those belonging to the curve are
 * restored: a whole arm if it is "anchored" by ink at both ends (the stroke passed through the cross along it),
 * and individual pixels 4-adjacent to curve ink (stroke thickness). This way a cross that the curve only touches
 * with an arm end does not remain as an outlier, and a stroke through the cross is not broken.
 */
function trimCoveredPlus(w: Working, id: number, cx: number, cy: number): boolean {
  const width = w.img.width;
  const { labels } = w;
  let bx = cx;
  let by = cy;
  let bestScore = -1;
  let bestDist = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      let score = 0;
      for (const p of crossPixels(cx + dx, cy + dy)) if (isInkPixel(w, p.x, p.y) && labels[p.y * width + p.x] === id) score++;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (score > bestScore || (score === bestScore && dist < bestDist)) {
        bestScore = score;
        bestDist = dist;
        bx = cx + dx;
        by = cy + dy;
      }
    }
  }
  const pixels = crossPixels(bx, by);
  if (bestScore < pixels.length - 1) return false;
  const removed = pixels.filter((p) => labels[p.y * width + p.x] === id);
  for (const p of removed) labels[p.y * width + p.x] = 0;

  const anchored = (dx: number, dy: number): boolean => {
    for (let a = -1; a <= 1; a++) if (isInkPixel(w, bx + dx + (dy !== 0 ? a : 0), by + dy + (dx !== 0 ? a : 0))) return true;
    return false;
  };
  const verticalThrough = anchored(0, -PLUS_ARM - 1) && anchored(0, PLUS_ARM + 1);
  const horizontalThrough = anchored(-PLUS_ARM - 1, 0) && anchored(PLUS_ARM + 1, 0);
  const onCross = new Set(pixels.map((p) => p.y * width + p.x));
  for (const p of removed) {
    const center = p.x === bx && p.y === by;
    let restore = p.vertical || center ? verticalThrough : false;
    if (!restore && (!p.vertical || center)) restore = horizontalThrough;
    if (!restore) {
      // Stroke-thickness pixel: 4-adjacent to the curve core outside the cross (the anti-aliased fringe does not count).
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (!onCross.has(ny * width + nx) && isInkPixel(w, nx, ny) && w.img.data[ny * width + nx] < w.core) {
          restore = true;
          break;
        }
      }
    }
    if (restore) labels[p.y * width + p.x] = id;
  }
  return true;
}

/** "+" lattice: free-standing crosses are erased, curve-covered ones are trimmed; returns the centres. */
function removePlusMarks(w: Working, layout: PageLayout): Point[] {
  const marks: Point[] = [];
  const lattice = layout.plusLattice;
  if (!lattice) return marks;
  const { region } = w;
  const width = w.img.width;
  for (const cxRaw of lattice.columnsX) {
    for (const cyRaw of lattice.rowsY) {
      const cx = Math.round(cxRaw);
      const cy = Math.round(cyRaw);
      if (cx < region.x || cx > region.x + region.width - 1 || cy < region.y || cy > region.y + region.height - 1) continue;
      const ids = new Set<number>();
      for (let y = Math.max(region.y, cy - PLUS_SEARCH); y <= Math.min(region.y + region.height - 1, cy + PLUS_SEARCH); y++) {
        for (let x = Math.max(region.x, cx - PLUS_SEARCH); x <= Math.min(region.x + region.width - 1, cx + PLUS_SEARCH); x++) {
          const id = w.labels[y * width + x];
          if (id && w.alive.has(id)) ids.add(id);
        }
      }
      if (ids.size === 0) continue;
      let found = false;
      let sumX = 0;
      let sumY = 0;
      let n = 0;
      for (const id of ids) {
        const c = w.byId.get(id)!;
        if (isSmall(c)) {
          const mx = (c.xmin + c.xmax) / 2;
          const my = (c.ymin + c.ymax) / 2;
          if (Math.abs(mx - cx) <= PLUS_SEARCH && Math.abs(my - cy) <= PLUS_SEARCH) {
            sumX += mx;
            sumY += my;
            n++;
            eraseComponent(w, c);
            found = true;
          }
        } else {
          // A curve-covered cross is still a mark: trim the arms if there are anchor columns,
          // otherwise (a steep stroke passed through the cross) leave the ink as is.
          trimCoveredPlus(w, id, cx, cy);
          found = true;
        }
      }
      if (found) marks.push(n > 0 ? { x: sumX / n, y: sumY / n } : { x: cxRaw, y: cyRaw });
    }
  }
  return marks;
}

function zoneContains(zone: Rect, c: RawComponent): boolean {
  const mx = (c.xmin + c.xmax) / 2;
  const my = (c.ymin + c.ymax) / 2;
  return (
    mx >= zone.x - ZONE_SLACK &&
    mx <= zone.x + zone.width - 1 + ZONE_SLACK &&
    my >= zone.y - ZONE_SLACK &&
    my <= zone.y + zone.height - 1 + ZONE_SLACK
  );
}

function isGlyphLike(c: RawComponent): boolean {
  const bw = c.xmax - c.xmin + 1;
  const bh = c.ymax - c.ymin + 1;
  return bw >= GLYPH_MIN_WIDTH && bw <= GLYPH_MAX_WIDTH && bh >= GLYPH_MIN_HEIGHT && bh <= GLYPH_MAX_HEIGHT;
}

function extract(img: GrayImage, layout: PageLayout, profile: FormatProfile): InkMask {
  const t = profile.thresholds;
  const region = layout.frame;
  const { labels, components } = labelHysteresis(img, region, t.inkCore, t.inkEdge);
  const byId = new Map<number, RawComponent>();
  const alive = new Set<number>();
  for (const c of components) {
    byId.set(c.id, c);
    if (c.hasCore && c.area >= t.minComponentArea) alive.add(c.id);
  }
  const w: Working = { img, region, labels, byId, alive, core: t.inkCore };

  const plusMarks = removePlusMarks(w, layout);

  const textZones = TEXT_ZONES.map((name) => layout.zones[name]).filter((z): z is Rect => z !== undefined);
  const textIds = new Set<number>();
  for (const id of alive) {
    const c = byId.get(id)!;
    if (isGlyphLike(c) && textZones.some((zone) => zoneContains(zone, c))) textIds.add(id);
  }

  // Areas after cross trimming — in a single pass over the region.
  const area = new Map<number, number>();
  const width = img.width;
  const mask = new Uint8Array(width * img.height);
  const darkness = new Uint8Array(width * img.height);
  for (let y = region.y; y < region.y + region.height; y++) {
    const row = y * width;
    for (let x = region.x; x < region.x + region.width; x++) {
      const id = labels[row + x];
      if (!id || !alive.has(id)) continue;
      area.set(id, (area.get(id) ?? 0) + 1);
      if (!textIds.has(id)) {
        mask[row + x] = INK;
        darkness[row + x] = 255 - img.data[row + x];
      }
    }
  }

  const inkComponents: InkComponent[] = [];
  const textComponents: InkComponent[] = [];
  for (const id of alive) {
    const c = byId.get(id)!;
    const a = area.get(id) ?? 0;
    if (a === 0) continue;
    (textIds.has(id) ? textComponents : inkComponents).push(toComponent(c, a));
  }
  return { mask, width, height: img.height, components: inkComponents, textComponents, plusMarks, darkness };
}

export function extractInk(img: GrayImage, layout: PageLayout, profile: FormatProfile): InkMask {
  try {
    return extract(img, layout, profile);
  } catch (error) {
    return {
      mask: new Uint8Array(img.width * img.height),
      width: img.width,
      height: img.height,
      components: [],
      textComponents: [],
      plusMarks: [],
      issues: [`exception:${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
