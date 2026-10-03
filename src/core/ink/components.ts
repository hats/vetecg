/**
 * Labeling of 8-connected components with brightness hysteresis: a candidate is a pixel darker than `edge`; a
 * component stays ink if it contains at least one core pixel (darker than `core`). This way the anti-aliased fringe
 * of the curve (120–230) joins the ink through connectivity, while grid dots (180–235, no core) do not.
 */
import type { GrayImage, Rect } from '../../types/contracts';

export interface RawComponent {
  id: number;
  area: number;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  hasCore: boolean;
}

export interface Labeling {
  /** Component label per pixel (0 = background); sized to the whole sheet. */
  labels: Int32Array;
  components: RawComponent[];
}

export function labelHysteresis(img: GrayImage, region: Rect, core: number, edge: number): Labeling {
  const { width, data } = img;
  const x0 = region.x;
  const y0 = region.y;
  const x1 = region.x + region.width - 1;
  const y1 = region.y + region.height - 1;
  const labels = new Int32Array(width * img.height);
  const stack = new Int32Array(region.width * region.height);
  const components: RawComponent[] = [];
  let next = 1;
  for (let y = y0; y <= y1; y++) {
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      const start = row + x;
      if (data[start] >= edge || labels[start]) continue;
      const id = next++;
      let sp = 0;
      stack[sp++] = start;
      labels[start] = id;
      let area = 0;
      let hasCore = false;
      let xmin = x;
      let xmax = x;
      let ymin = y;
      let ymax = y;
      while (sp > 0) {
        const i = stack[--sp];
        area++;
        if (data[i] < core) hasCore = true;
        const iy = (i / width) | 0;
        const ix = i - iy * width;
        if (ix < xmin) xmin = ix;
        if (ix > xmax) xmax = ix;
        if (iy < ymin) ymin = iy;
        if (iy > ymax) ymax = iy;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = iy + dy;
          if (ny < y0 || ny > y1) continue;
          const nrow = ny * width;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = ix + dx;
            if (nx < x0 || nx > x1) continue;
            const k = nrow + nx;
            if (data[k] < edge && !labels[k]) {
              labels[k] = id;
              stack[sp++] = k;
            }
          }
        }
      }
      components.push({ id, area, xmin, xmax, ymin, ymax, hasCore });
    }
  }
  return { labels, components };
}
