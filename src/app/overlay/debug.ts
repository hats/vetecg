/**
 * Debug mode `?debug=1` (decisions §5, A06 → R07): ink and runs layers are built lazily from the sheet's gray image —
 * sheet-sized canvases (tens of thousands of elements cannot be drawn as Konva shapes). Profile zones and read glyphs
 * are drawn by the scene itself from `PageResult`.
 *
 * Runs come from an internal file of the `trace` module (`buildRunGraph`) — debug only, the module contract hides them.
 */
import type { GrayImage, PageLayout } from '../../types/contracts';
import { extractInk } from '../../core/ink';
import { POLYSPECTRUM } from '../../core/profile';
import { buildRunGraph } from '../../core/trace/runs';
import { DEBUG_COLORS } from './style';

export const isDebug = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';

export interface DebugCanvases {
  ink: HTMLCanvasElement;
  runs: HTMLCanvasElement;
  /** Number of run-graph components and total runs — for the toolbar caption. */
  stats: { runs: number; components: number; inkComponents: number; textComponents: number };
}

const PALETTE = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#4d7c0f', '#b91c1c', '#1d4ed8', '#047857', '#c026d3'];

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Нет 2D-контекста для отладочного холста');
  return [canvas, ctx];
}

/** Ink (red), text components (boxes), «+» marks; runs — colored by graph component. */
export function buildDebugCanvases(image: GrayImage, layout: PageLayout): DebugCanvases {
  const ink = extractInk(image, layout, POLYSPECTRUM);
  const { width, height } = image;

  const [inkCanvas, inkCtx] = canvasOf(width, height);
  const data = inkCtx.createImageData(width, height);
  for (let i = 0; i < ink.mask.length; i++) {
    if (ink.mask[i] === 0) continue;
    const o = i * 4;
    data.data[o] = 220;
    data.data[o + 1] = 38;
    data.data[o + 2] = 38;
    data.data[o + 3] = 120;
  }
  inkCtx.putImageData(data, 0, 0);
  inkCtx.strokeStyle = DEBUG_COLORS.glyph;
  inkCtx.lineWidth = 1;
  for (const c of ink.textComponents) inkCtx.strokeRect(c.bbox.x - 0.5, c.bbox.y - 0.5, c.bbox.width + 1, c.bbox.height + 1);
  inkCtx.strokeStyle = DEBUG_COLORS.zone;
  for (const p of ink.plusMarks) {
    inkCtx.beginPath();
    inkCtx.moveTo(p.x - 6, p.y + 0.5);
    inkCtx.lineTo(p.x + 6, p.y + 0.5);
    inkCtx.moveTo(p.x + 0.5, p.y - 6);
    inkCtx.lineTo(p.x + 0.5, p.y + 6);
    inkCtx.stroke();
  }

  const f = layout.frame;
  const graph = buildRunGraph(ink, Math.max(0, f.x), Math.min(width - 1, f.x + f.width - 1), Math.max(0, f.y), Math.min(height - 1, f.y + f.height - 1));
  const [runCanvas, runCtx] = canvasOf(width, height);
  runCtx.globalAlpha = 0.85;
  for (const run of graph.runs) {
    runCtx.fillStyle = PALETTE[graph.component[run.index] % PALETTE.length];
    runCtx.fillRect(run.x, run.y0, 1, run.y1 - run.y0 + 1);
  }
  return {
    ink: inkCanvas,
    runs: runCanvas,
    stats: { runs: graph.runs.length, components: graph.componentCount, inkComponents: ink.components.length, textComponents: ink.textComponents.length },
  };
}
