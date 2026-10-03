/**
 * Konva scene of a sheet (stories 59–65, 18, 20, 20а, 24, 17): sheet raster, traces colored per lead (active one
 * thicker), bridges across `clipped`/`gap` (not a curve), `ambiguous` highlight, dashed baselines (draggable), labels,
 * wave markers of the active lead with draggable boundaries, separators, detected grid, debug layers.
 *
 * Everything is drawn in sheet pixels; zoom and pan are the scale and offset of the `Stage` itself, so markers stay on
 * the curve at any zoom. Line widths are not scaled (`strokeScaleEnabled: false`); handles and labels live in groups
 * with inverse scale (`constNodes`). The scene knows nothing about the store: events go to `SceneCallbacks`.
 */
import Konva from 'konva';
import {
  LEAD_IDS,
  UNRELIABLE_BELOW,
  type Delineation,
  type EctopicKind,
  type GridEstimate,
  type LeadId,
  type MarkerField,
  type PageBeats,
  type PageResult,
  type Point,
  type Rect,
  type TraceHint,
  type ZoneName,
} from '../../types/contracts';
import { ambiguousSegments, clampView, gridLines, timeToX, toContent, traceSegments, viewScale, xToTime, yOnTrace, zoomAt, type View, type Viewport } from './geometry';
import { markerBounds } from './markers';
import {
  CALIBRATION_COLOR,
  DEBUG_COLORS,
  ECTOPIC_COLOR,
  ECTOPIC_LABEL,
  GRID_COLOR,
  LEAD_COLORS,
  MARKER_COLORS,
  SEPARATOR_COLOR,
  UNRELIABLE_COLORS,
  UNRELIABLE_TEXT,
  type MarkerGroup,
} from './style';

export type Mode = 'pan' | 'separator' | 'calibration';

export interface DebugModel {
  /** Prebuilt ink and runs canvases (built lazily in `debug.ts`). */
  ink?: HTMLCanvasElement;
  runs?: HTMLCanvasElement;
  zones: boolean;
  glyphs: boolean;
}

export interface SceneModel {
  /** Sheet key (id): a key change resets the view and reloads the raster. */
  key: string;
  image?: HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
  /** Edited sheet (`CaseResult.perPage[i]`) or the automatic result if the sheet is not in the case yet. */
  page?: PageResult;
  beats?: PageBeats;
  activeLead: LeadId;
  overlayOn: boolean;
  gridOn: boolean;
  /** Grid for the «Сетка» (grid) layer — measured or manual. */
  grid?: GridEstimate;
  /** Beat position in `beats.beats` → ectopic kind. */
  ectopics: ReadonlyMap<number, EctopicKind>;
  separators: readonly TraceHint[];
  mode: Mode;
  calibrationPoints: readonly Point[];
  debug?: DebugModel;
  /** Message over the sheet («кривые не распознаны», «распознаётся…»). */
  message?: string;
}

export interface SceneCallbacks {
  onLeadSelect(slot: LeadId): void;
  /** Context menu of a trace/label; `at` — screen coordinates inside the container. */
  onLeadMenu(slot: LeadId, at: Point): void;
  onMarkerMove(beat: number, field: MarkerField, tMs: number): void;
  onBaselineMove(slot: LeadId, y: number): void;
  onSeparatorDraw(a: Point, b: Point): void;
  onSeparatorMenu(hint: TraceHint, at: Point): void;
  onCalibrationClick(p: Point): void;
  onViewChange(view: View): void;
  onHover(text: string | undefined, at: Point): void;
}

/** Wave boundaries the vet drags, and their color groups. */
const HANDLE_FIELDS: readonly [MarkerField, MarkerGroup][] = [
  ['pOn', 'P'],
  ['pOff', 'P'],
  ['qOn', 'QRS'],
  ['sOff', 'QRS'],
  ['tOff', 'T'],
];
const HANDLE_RADIUS = 5;
const TRACE_WIDTH = 1.4;
const ACTIVE_TRACE_WIDTH = 2.8;
const LABEL_FONT = 13;

const ZONE_LABEL: Record<ZoneName, string> = {
  header: 'шапка',
  headerName: 'шапка: кличка',
  headerProduct: 'шапка: продукт',
  timeLabels: 'метки времени',
  hrRow: 'ряд ЧСС',
  leadLabels: 'подписи отведений',
  plot: 'область кривых',
  footer: 'футер',
  rrRow: 'ряд RR',
};

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/** Polyline piece between x0 and x1 with interpolated ends — for tinting a wave along the curve. */
function sliceTrace(points: readonly Point[], x0: number, x1: number): Point[] {
  if (points.length === 0 || !(x1 > x0)) return [];
  const y0 = yOnTrace(points, x0);
  const y1 = yOnTrace(points, x1);
  if (y0 === undefined || y1 === undefined) return [];
  return [{ x: x0, y: y0 }, ...points.filter((p) => p.x > x0 && p.x < x1), { x: x1, y: y1 }];
}

const plotArea = (page: PageResult): Rect => page.layout.zones.plot ?? page.layout.frame;

export class OverlayScene {
  private readonly container: HTMLDivElement;
  private readonly cb: SceneCallbacks;
  private readonly stage: Konva.Stage;
  /** Three layers (Konva recommends ≤ 5): static (raster, grid, debug), overlay (traces, baselines, separators), foreground (markers, tools). */
  private readonly baseLayer = new Konva.Layer({ listening: false });
  private readonly imageGroup = new Konva.Group();
  private readonly gridGroup = new Konva.Group();
  private readonly debugGroup = new Konva.Group();
  private readonly overlayLayer = new Konva.Layer();
  private readonly frontLayer = new Konva.Layer();
  private readonly markerGroup = new Konva.Group();
  private readonly toolGroup = new Konva.Group({ listening: false });
  private view: View = { zoom: 1, x: 0, y: 0 };
  private vp: Viewport = { width: 1, height: 1, contentWidth: 1, contentHeight: 1, base: 1 };
  private model?: SceneModel;
  private imageNode?: Konva.Image;
  private gridNode?: { key: string; node: Konva.Image };
  private constNodes: Konva.Node[] = [];
  private drawing?: { start: Point; line: Konva.Line };
  private pinch?: { dist: number; center: Point };

  constructor(container: HTMLDivElement, callbacks: SceneCallbacks) {
    this.container = container;
    this.cb = callbacks;
    this.stage = new Konva.Stage({ container, width: 10, height: 10, draggable: true });
    this.baseLayer.add(this.imageGroup, this.gridGroup, this.debugGroup);
    this.frontLayer.add(this.markerGroup, this.toolGroup);
    this.stage.add(this.baseLayer, this.overlayLayer, this.frontLayer);
    this.stage.dragBoundFunc((pos) => {
      const v = clampView({ zoom: this.view.zoom, x: pos.x, y: pos.y }, this.vp);
      return { x: v.x, y: v.y };
    });
    this.stage.on('dragend', () => {
      if (this.model?.mode !== 'pan') return;
      this.view = { ...this.view, x: this.stage.x(), y: this.stage.y() };
      this.cb.onViewChange(this.view);
    });
    this.stage.on('wheel', (e) => {
      e.evt.preventDefault();
      const pointer = this.stage.getPointerPosition();
      if (!pointer) return;
      const factor = Math.min(2, Math.max(0.5, Math.exp(-e.evt.deltaY * 0.0015)));
      this.setView(zoomAt(this.view, this.vp, pointer, factor));
    });
    this.stage.on('touchmove', (e) => {
      const t = e.evt.touches;
      if (t.length !== 2) return;
      e.evt.preventDefault();
      if (this.stage.isDragging()) this.stage.stopDrag();
      const rect = this.container.getBoundingClientRect();
      const p1 = { x: t[0].clientX - rect.left, y: t[0].clientY - rect.top };
      const p2 = { x: t[1].clientX - rect.left, y: t[1].clientY - rect.top };
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (this.pinch) {
        const zoomed = zoomAt(this.view, this.vp, center, dist / this.pinch.dist);
        this.setView(clampView({ ...zoomed, x: zoomed.x + center.x - this.pinch.center.x, y: zoomed.y + center.y - this.pinch.center.y }, this.vp));
      }
      this.pinch = { dist, center };
    });
    this.stage.on('touchend', () => {
      this.pinch = undefined;
    });
    this.stage.on('contextmenu', (e) => e.evt.preventDefault());
    // Drawing modes: separator — drag a line; calibration — clicks.
    this.stage.on('mousedown touchstart', (e) => {
      const mode = this.model?.mode;
      if (mode !== 'separator' || e.target !== this.stage) return;
      const p = this.pointer();
      if (!p) return;
      this.drawing = { start: p, line: new Konva.Line({ points: [p.x, p.y, p.x, p.y], stroke: SEPARATOR_COLOR, strokeWidth: 3, dash: [8, 6], strokeScaleEnabled: false }) };
      this.toolGroup.add(this.drawing.line);
    });
    this.stage.on('mousemove touchmove', () => {
      if (!this.drawing) return;
      const p = this.pointer();
      if (!p) return;
      this.drawing.line.points([this.drawing.start.x, this.drawing.start.y, p.x, this.drawing.start.y]);
      this.frontLayer.batchDraw();
    });
    this.stage.on('mouseup touchend', () => {
      if (!this.drawing) return;
      const { start, line } = this.drawing;
      const p = this.pointer() ?? start;
      line.destroy();
      this.drawing = undefined;
      this.cb.onSeparatorDraw(start, { x: p.x, y: start.y });
    });
    this.stage.on('click tap', (e) => {
      if (this.model?.mode !== 'calibration' || e.target !== this.stage) return;
      const p = this.pointer();
      if (p) this.cb.onCalibrationClick(p);
    });
    this.stage.on('mouseleave', () => this.cb.onHover(undefined, { x: 0, y: 0 }));
  }

  /** Cursor position in sheet px. */
  private pointer(): Point | undefined {
    const p = this.stage.getPointerPosition();
    return p ? toContent(this.view, this.vp, p) : undefined;
  }

  private screenPointer(): Point {
    return this.stage.getPointerPosition() ?? { x: 0, y: 0 };
  }

  getView(): View {
    return this.view;
  }

  /** Konva stage — for debugging and end-to-end checks (`window.vetecgOverlay`). */
  get konvaStage(): Konva.Stage {
    return this.stage;
  }

  /** Fits the viewport to the container width: at zoom 1 the sheet fits the width. */
  resize(): void {
    const width = this.container.clientWidth;
    // A hidden container (width 0, ResizeObserver on hide) does not set the viewport: otherwise clamping the view to a
    // degenerate viewport reset the zoom to the top-left corner (seen in headless Chrome 600 ms after wheel).
    if (!this.model || width <= 0) return;
    const base = width / this.model.width;
    const height = Math.max(1, Math.round(this.model.height * base));
    this.stage.size({ width, height });
    this.vp = { width, height, contentWidth: this.model.width, contentHeight: this.model.height, base };
    this.setView(clampView(this.view, this.vp), false);
  }

  resetView(): void {
    this.setView({ zoom: 1, x: 0, y: 0 });
  }

  zoomBy(factor: number): void {
    this.setView(zoomAt(this.view, this.vp, { x: this.vp.width / 2, y: this.vp.height / 2 }, factor));
  }

  private setView(view: View, notify = true): void {
    this.view = view;
    const s = viewScale(view, this.vp);
    this.stage.scale({ x: s, y: s });
    this.stage.position({ x: view.x, y: view.y });
    for (const node of this.constNodes) node.scale({ x: 1 / s, y: 1 / s });
    this.stage.batchDraw();
    if (notify) this.cb.onViewChange(view);
  }

  render(model: SceneModel): void {
    const sheetChanged = this.model?.key !== model.key;
    this.model = model;
    this.stage.draggable(model.mode === 'pan');
    if (sheetChanged) {
      this.view = { zoom: 1, x: 0, y: 0 };
      this.gridNode?.node.destroy();
      this.gridNode = undefined;
    }
    this.resize();
    this.renderImage(model);
    this.renderGrid(model);
    this.renderDebug(model);
    this.constNodes = [];
    this.overlayLayer.destroyChildren();
    this.markerGroup.destroyChildren();
    this.toolGroup.destroyChildren();
    if (model.page && model.overlayOn) {
      this.renderTraces(model, model.page);
      this.renderSeparators(model);
      if (model.beats) this.renderMarkers(model, model.page, model.beats);
    }
    this.renderCalibration(model);
    if (model.message) this.renderMessage(model.message);
    this.setView(clampView(this.view, this.vp), false);
  }

  private renderImage(model: SceneModel): void {
    if (!model.image) {
      this.imageNode?.destroy();
      this.imageNode = undefined;
      this.baseLayer.batchDraw();
      return;
    }
    if (!this.imageNode) {
      this.imageNode = new Konva.Image({ image: model.image, x: 0, y: 0, listening: false });
      this.imageGroup.add(this.imageNode);
    }
    this.imageNode.image(model.image);
    this.imageNode.size({ width: model.width, height: model.height });
    this.baseLayer.batchDraw();
  }

  /** Detected grid: 5-mm lines and 1-mm nodes on a sheet-sized canvas (tens of thousands of nodes — not shapes). */
  private renderGrid(model: SceneModel): void {
    const grid = model.grid;
    const show = model.gridOn && model.page && grid && grid.pxPerMmX > 0 && grid.pxPerMmY > 0;
    this.gridGroup.visible(!!show);
    if (!show || !model.page) {
      this.baseLayer.batchDraw();
      return;
    }
    const key = `${model.key}|${grid.pxPerMmX}|${grid.pxPerMmY}|${grid.phaseX}|${grid.phaseY}`;
    if (this.gridNode?.key !== key) {
      this.gridNode?.node.destroy();
      const canvas = document.createElement('canvas');
      canvas.width = model.width;
      canvas.height = model.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const lines = gridLines(model.page.layout, grid);
        const { frame } = model.page.layout;
        ctx.fillStyle = GRID_COLOR;
        ctx.globalAlpha = 0.9;
        for (const x of lines.xs1) for (const y of lines.ys1) ctx.fillRect(Math.round(x) - 0.5, Math.round(y) - 0.5, 1.4, 1.4);
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const x of lines.xs5) {
          ctx.moveTo(Math.round(x) + 0.5, frame.y);
          ctx.lineTo(Math.round(x) + 0.5, frame.y + frame.height);
        }
        for (const y of lines.ys5) {
          ctx.moveTo(frame.x, Math.round(y) + 0.5);
          ctx.lineTo(frame.x + frame.width, Math.round(y) + 0.5);
        }
        ctx.stroke();
      }
      const node = new Konva.Image({ image: canvas, x: 0, y: 0, listening: false });
      this.gridGroup.add(node);
      this.gridNode = { key, node };
    }
    this.baseLayer.batchDraw();
  }

  /** `?debug=1`: ink, runs, profile zones, read glyphs with labels. */
  private renderDebug(model: SceneModel): void {
    this.debugGroup.destroyChildren();
    const d = model.debug;
    const page = model.page;
    if (!d || !page) {
      this.baseLayer.batchDraw();
      return;
    }
    if (d.ink) this.debugGroup.add(new Konva.Image({ image: d.ink, x: 0, y: 0, listening: false }));
    if (d.runs) this.debugGroup.add(new Konva.Image({ image: d.runs, x: 0, y: 0, listening: false }));
    if (d.zones) {
      for (const [name, rect] of Object.entries(page.layout.zones) as [ZoneName, Rect | undefined][]) {
        if (!rect) continue;
        this.debugGroup.add(new Konva.Rect({ ...rect, stroke: DEBUG_COLORS.zone, strokeWidth: 1, dash: [4, 3], strokeScaleEnabled: false, listening: false }));
        this.debugGroup.add(this.constText(rect.x + 2, rect.y + 1, ZONE_LABEL[name], DEBUG_COLORS.zone, 11));
      }
      const f = page.layout.frame;
      this.debugGroup.add(new Konva.Rect({ ...f, stroke: DEBUG_COLORS.zone, strokeWidth: 2, strokeScaleEnabled: false, listening: false }));
      for (const [k, y] of page.layout.expectedBaselines.entries()) {
        this.debugGroup.add(new Konva.Line({ points: [f.x, y, f.x + f.width, y], stroke: DEBUG_COLORS.zone, strokeWidth: 1, dash: [2, 6], strokeScaleEnabled: false, listening: false }));
        this.debugGroup.add(this.constText(f.x + f.width - 90, y - 14, `якорь ${LEAD_IDS[k]} y=${y.toFixed(1)}`, DEBUG_COLORS.zone, 10));
      }
    }
    if (d.glyphs) {
      const meta = page.meta;
      const hrY = page.layout.zones.hrRow?.y ?? page.layout.frame.y;
      for (const hr of meta.hrRow) {
        this.debugGroup.add(new Konva.Line({ points: [hr.x, hrY, hr.x, hrY + 14], stroke: DEBUG_COLORS.glyph, strokeWidth: 1, strokeScaleEnabled: false, listening: false }));
        this.debugGroup.add(this.constText(hr.x - 8, hrY - 14, String(hr.value), DEBUG_COLORS.glyph, 11));
      }
      const tY = page.layout.zones.timeLabels?.y ?? page.layout.frame.y;
      for (const t of meta.timeLabels) this.debugGroup.add(this.constText(t.x - 10, tY - 2, `${t.text} (${t.seconds} с)`, DEBUG_COLORS.glyph, 10));
      for (const l of meta.leadLabels) {
        this.debugGroup.add(new Konva.Rect({ ...l.rect, stroke: DEBUG_COLORS.glyph, strokeWidth: 1, strokeScaleEnabled: false, listening: false }));
        this.debugGroup.add(this.constText(l.rect.x + l.rect.width + 2, l.rect.y - 2, l.id, DEBUG_COLORS.glyph, 10));
      }
      const info = [
        `вариант ${page.layout.variant}, сетка ${page.layout.grid.pxPerMmX.toFixed(3)}×${page.layout.grid.pxPerMmY.toFixed(3)} px/мм (уверенность ${Math.round(page.layout.grid.confidence * 100)} %)`,
        `дата ${meta.headerDate ?? '—'}, вид «${meta.speciesLetter ?? '—'}», футер ЧСС ${meta.footerHr ?? '—'}, калибровка футера ${meta.footerCalib ? `${meta.footerCalib.mmPerS}/${meta.footerCalib.mmPerMv}` : '—'}`,
        `ряд ЧСС: ${meta.hrRow.map((h) => h.value).join(' ') || '—'}${meta.rrRowMs ? `; ряд RR: ${meta.rrRowMs.join(' ')}` : ''}`,
        `issues: ${page.issues.join(', ') || '—'}`,
      ];
      this.debugGroup.add(this.constText(page.layout.frame.x + 4, page.layout.frame.y + page.layout.frame.height + 4, info.join('\n'), DEBUG_COLORS.glyph, 11));
    }
    this.baseLayer.batchDraw();
  }

  private constText(x: number, y: number, text: string, fill: string, fontSize = LABEL_FONT): Konva.Group {
    const group = new Konva.Group({ x, y, listening: false });
    group.add(new Konva.Text({ text, fontSize, fill, fontFamily: 'system-ui, sans-serif', padding: 1 }));
    this.constNodes.push(group);
    return group;
  }

  private hover(node: Konva.Node, text: string): void {
    node.on('mouseenter', () => this.cb.onHover(text, this.screenPointer()));
    node.on('mousemove', () => this.cb.onHover(text, this.screenPointer()));
    node.on('mouseleave', () => this.cb.onHover(undefined, this.screenPointer()));
  }

  private renderTraces(model: SceneModel, page: PageResult): void {
    const plot = plotArea(page);
    const frame = page.layout.frame;
    page.leads.forEach((trace, k) => {
      const slot = LEAD_IDS[k] ?? trace.id;
      const color = LEAD_COLORS[slot];
      const active = slot === model.activeLead;
      const select = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
        e.cancelBubble = true;
        this.cb.onLeadSelect(slot);
      };
      const menu = (e: Konva.KonvaEventObject<PointerEvent>) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        this.cb.onLeadMenu(slot, this.screenPointer());
      };

      // Dashed baseline — dragged vertically (story 20).
      const baseline = new Konva.Line({
        name: `baseline baseline-${slot}`,
        points: [plot.x, 0, plot.x + plot.width, 0],
        y: trace.baselineY,
        stroke: color,
        strokeWidth: active ? 1.5 : 1,
        dash: [8, 6],
        opacity: 0.75,
        strokeScaleEnabled: false,
        hitStrokeWidth: 12,
        draggable: true,
      });
      baseline.dragBoundFunc((pos) => {
        const s = viewScale(this.view, this.vp);
        const minY = this.stage.y() + frame.y * s;
        const maxY = this.stage.y() + (frame.y + frame.height) * s;
        return { x: this.stage.x(), y: Math.min(maxY, Math.max(minY, pos.y)) };
      });
      baseline.on('dragstart', (e) => {
        e.cancelBubble = true;
      });
      baseline.on('dragend', () => this.cb.onBaselineMove(slot, baseline.y()));
      baseline.on('click tap', select);
      baseline.on('contextmenu', menu);
      this.hover(baseline, `Изолиния ${slot}: y = ${trace.baselineY.toFixed(1)} px — перетащите по вертикали, чтобы поправить`);
      // The baseline is added after the curve (further down) so it lies on top of it and catches dragging.
      const addBaseline = (): void => {
        this.overlayLayer.add(baseline);
      };

      if (trace.points.length === 0) {
        addBaseline();
        // Below the baseline: above it may sit the label of a trace reassigned to a neighbouring slot (same y).
        this.overlayLayer.add(this.constText(frame.x + 4, trace.baselineY + 4, `${slot}: кривая не найдена`, color));
        return;
      }

      // Curve in pieces; bridges across clipped/gap — dashed, not a curve (§2); merging — yellow under the curve.
      const { curve, bridges } = traceSegments(trace.points, trace.unreliable);
      let lastTagX = -Infinity;
      for (const seg of ambiguousSegments(trace.points, trace.unreliable)) {
        const line = new Konva.Line({ points: flat(seg), stroke: UNRELIABLE_COLORS.ambiguous, strokeWidth: 7, opacity: 0.55, strokeScaleEnabled: false, lineCap: 'round', lineJoin: 'round', hitStrokeWidth: 10 });
        this.hover(line, UNRELIABLE_TEXT.ambiguous);
        this.overlayLayer.add(line);
      }
      for (const seg of curve) {
        if (seg.length < 2) continue;
        const line = new Konva.Line({
          points: flat(seg),
          stroke: color,
          strokeWidth: active ? ACTIVE_TRACE_WIDTH : TRACE_WIDTH,
          opacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round',
          strokeScaleEnabled: false,
          hitStrokeWidth: 10,
        });
        line.on('click tap', select);
        line.on('contextmenu', menu);
        this.overlayLayer.add(line);
      }
      for (const b of bridges) {
        const line = new Konva.Line({
          points: [b.from.x, b.from.y, b.to.x, b.to.y],
          stroke: UNRELIABLE_COLORS[b.kind],
          strokeWidth: b.kind === 'clipped' ? 3 : 2,
          dash: b.kind === 'clipped' ? [5, 4] : [3, 5],
          opacity: 0.95,
          strokeScaleEnabled: false,
          hitStrokeWidth: 12,
        });
        this.hover(line, UNRELIABLE_TEXT[b.kind]);
        this.overlayLayer.add(line);
        // Clipping: a tag at the frame so it is visible without hover (at most once per 90 px — otherwise they overlap).
        if (b.kind === 'clipped' && b.from.x - lastTagX > 90) {
          lastTagX = b.from.x;
          const tag = this.constText(b.from.x - 20, Math.max(b.from.y, b.to.y) > frame.y + frame.height / 2 ? frame.y + frame.height - 16 : frame.y + 2, 'обрезано прибором', UNRELIABLE_COLORS.clipped, 10);
          this.overlayLayer.add(tag);
        }
      }

      addBaseline();

      // Label with confidence; click — active lead, right button — reassignment, vertical drag — the same baseline
      // edit (a handle where the curve is not in the way).
      const low = trace.confidence < UNRELIABLE_BELOW;
      const label = new Konva.Group({ x: frame.x + 4, y: trace.baselineY - 22, draggable: true, name: `label label-${slot}` });
      label.dragBoundFunc((pos) => {
        const s = viewScale(this.view, this.vp);
        const minY = this.stage.y() + (frame.y - 22) * s;
        const maxY = this.stage.y() + (frame.y + frame.height - 22) * s;
        return { x: this.stage.x() + (frame.x + 4) * s, y: Math.min(maxY, Math.max(minY, pos.y)) };
      });
      label.on('dragstart', (e) => {
        e.cancelBubble = true;
      });
      label.on('dragmove', () => {
        baseline.y(label.y() + 22);
      });
      label.on('dragend', () => this.cb.onBaselineMove(slot, label.y() + 22));
      const text = new Konva.Text({
        text: `${slot} · ${Math.round(trace.confidence * 100)} %${low ? ' ненадёжно' : ''}`,
        fontSize: LABEL_FONT,
        fontStyle: active ? 'bold' : 'normal',
        fill: color,
        fontFamily: 'system-ui, sans-serif',
        padding: 2,
      });
      label.add(new Konva.Rect({ width: text.width(), height: text.height(), fill: 'rgba(255,255,255,0.8)', cornerRadius: 3 }));
      label.add(text);
      label.on('click tap', select);
      label.on('contextmenu', menu);
      this.hover(label, `Отведение ${slot}: уверенность ${Math.round(trace.confidence * 100)} %${trace.reasons.length ? ` (${trace.reasons.join(', ')})` : ''}. Клик — активное, правая кнопка — подпись`);
      this.constNodes.push(label);
      this.overlayLayer.add(label);
    });
    this.overlayLayer.batchDraw();
  }

  private renderSeparators(model: SceneModel): void {
    for (const hint of model.separators) {
      const line = new Konva.Line({ points: [hint.x0, hint.y, hint.x1, hint.y], stroke: SEPARATOR_COLOR, strokeWidth: 3, dash: [8, 6], strokeScaleEnabled: false, hitStrokeWidth: 12 });
      const menu = (e: Konva.KonvaEventObject<PointerEvent | MouseEvent | TouchEvent>) => {
        e.evt.preventDefault?.();
        e.cancelBubble = true;
        this.cb.onSeparatorMenu(hint, this.screenPointer());
      };
      line.on('contextmenu click tap', menu);
      this.hover(line, `Разделитель: выше — ${hint.above}, ниже — ${hint.below}. Клик — удалить`);
      this.overlayLayer.add(line);
      for (const x of [hint.x0, hint.x1]) {
        const end = new Konva.Group({ x, y: hint.y });
        end.add(new Konva.Circle({ radius: 5, fill: '#fff', stroke: SEPARATOR_COLOR, strokeWidth: 2 }));
        end.on('contextmenu click tap', menu);
        this.constNodes.push(end);
        this.overlayLayer.add(end);
      }
    }
  }

  private renderMarkers(model: SceneModel, page: PageResult, beats: PageBeats): void {
    const slotIndex = LEAD_IDS.indexOf(model.activeLead);
    const trace = page.leads[slotIndex];
    if (!trace || trace.points.length === 0) return;
    const points = trace.points;
    const calib = page.calib;
    const toX = (tMs: number): number => timeToX(page.layout, calib, tMs);
    const plot = plotArea(page);

    beats.beats.forEach((beat, k) => {
      const d: Delineation | undefined = beats.delineations[k];
      if (!d) return;
      const weak = beat.confidence < UNRELIABLE_BELOW || d.confidence < UNRELIABLE_BELOW;
      const group = new Konva.Group({ opacity: weak ? 0.55 : 1 });

      // Waves along the curve: P, QRS, T — in the group color.
      const spans: [number | null, number | null, MarkerGroup][] = [
        [d.pOn, d.pOff, 'P'],
        [d.qOn, d.sOff, 'QRS'],
        [d.tPeak ?? d.sOff, d.tOff, 'T'],
      ];
      for (const [a, b, g] of spans) {
        if (a === null || b === null) continue;
        const seg = sliceTrace(points, toX(a), toX(b));
        if (seg.length >= 2) group.add(new Konva.Line({ points: flat(seg), stroke: MARKER_COLORS[g], strokeWidth: 5, opacity: 0.6, lineCap: 'round', lineJoin: 'round', strokeScaleEnabled: false, listening: false }));
      }
      // R/S/T peaks — small marks, not draggable.
      for (const [t, g, dy] of [
        [d.rPeak, 'QRS', -9],
        [d.sPeak, 'QRS', 9],
        [d.tPeak, 'T', -9],
      ] as [number | null, MarkerGroup, number][]) {
        if (t === null) continue;
        const x = toX(t);
        const y = yOnTrace(points, x);
        if (y === undefined) continue;
        const peak = new Konva.Group({ x, y, listening: false });
        peak.add(new Konva.RegularPolygon({ sides: 3, radius: 4, fill: MARKER_COLORS[g], y: dy, rotation: dy > 0 ? 180 : 0 }));
        this.constNodes.push(peak);
        group.add(peak);
      }
      if (!d.pFound && d.qOn !== null) {
        const x = toX(d.qOn) - 46;
        group.add(this.constText(x, trace.baselineY - 40, 'P не найден', MARKER_COLORS.P, 10));
      }
      // Ectopy — a separate tag above the complex.
      const ectopic = model.ectopics.get(k);
      if (ectopic) {
        const x = toX(beat.tMs);
        group.add(new Konva.Line({ points: [x, trace.baselineY - 70, x, trace.baselineY + 30], stroke: ECTOPIC_COLOR, strokeWidth: 1.5, dash: [4, 4], strokeScaleEnabled: false, listening: false }));
        const tag = new Konva.Group({ x: x - 14, y: trace.baselineY - 86 });
        const text = new Konva.Text({ text: ECTOPIC_LABEL[ectopic], fontSize: 12, fontStyle: 'bold', fill: '#fff', fontFamily: 'system-ui, sans-serif', padding: 3 });
        tag.add(new Konva.Rect({ width: text.width(), height: text.height(), fill: ECTOPIC_COLOR, cornerRadius: 3 }));
        tag.add(text);
        this.constNodes.push(tag);
        group.add(tag);
      }

      // Boundary handles: drag along time, vertically follow the curve; bounded by neighbours (story 61).
      const neighbours = { prevTMs: beats.beats[k - 1]?.tMs, nextTMs: beats.beats[k + 1]?.tMs };
      for (const [field, g] of HANDLE_FIELDS) {
        const t = d[field];
        if (t === null) continue;
        const x = toX(t);
        const y = yOnTrace(points, x);
        if (y === undefined) continue;
        const handle = new Konva.Group({ x, y, draggable: true, name: `marker marker-${k}-${field}` });
        handle.add(new Konva.Circle({ radius: HANDLE_RADIUS, fill: MARKER_COLORS[g], stroke: '#fff', strokeWidth: 1.5, hitStrokeWidth: 8 }));
        handle.add(new Konva.Line({ points: [0, -14, 0, 14], stroke: MARKER_COLORS[g], strokeWidth: 1.5 }));
        const bounds = markerBounds(field, d, neighbours);
        const minX = Math.max(plot.x, toX(Math.max(bounds.minMs, 0)));
        const maxX = Math.min(plot.x + plot.width, toX(Math.min(bounds.maxMs, xToTime(page.layout, calib, plot.x + plot.width))));
        handle.dragBoundFunc((pos) => {
          const transform = this.stage.getAbsoluteTransform().copy();
          const world = transform.copy().invert().point(pos);
          const cx = Math.min(maxX, Math.max(minX, world.x));
          const cy = yOnTrace(points, cx) ?? world.y;
          return transform.point({ x: cx, y: cy });
        });
        handle.on('dragstart', (e) => {
          e.cancelBubble = true;
        });
        handle.on('dragend', () => this.cb.onMarkerMove(k, field, xToTime(page.layout, calib, handle.x())));
        this.hover(handle, `${this.fieldTitle(field)} комплекса ${k + 1}: ${Math.round(t)} мс — перетащите по оси времени`);
        this.constNodes.push(handle);
        group.add(handle);
      }
      this.markerGroup.add(group);
    });
    this.frontLayer.batchDraw();
  }

  private fieldTitle(field: MarkerField): string {
    return { pOn: 'Начало P', pOff: 'Конец P', qOn: 'Начало QRS (Q)', sOff: 'Конец QRS (S)', tOff: 'Конец T' }[field];
  }

  private renderCalibration(model: SceneModel): void {
    const pts = model.calibrationPoints;
    for (const p of pts) {
      const mark = new Konva.Group({ x: p.x, y: p.y, listening: false });
      mark.add(new Konva.Circle({ radius: 7, stroke: CALIBRATION_COLOR, strokeWidth: 2 }));
      mark.add(new Konva.Line({ points: [-11, 0, 11, 0], stroke: CALIBRATION_COLOR, strokeWidth: 1 }));
      mark.add(new Konva.Line({ points: [0, -11, 0, 11], stroke: CALIBRATION_COLOR, strokeWidth: 1 }));
      this.constNodes.push(mark);
      this.toolGroup.add(mark);
    }
    if (pts.length === 2) {
      this.toolGroup.add(new Konva.Line({ points: [pts[0].x, pts[0].y, pts[1].x, pts[1].y], stroke: CALIBRATION_COLOR, strokeWidth: 2, dash: [6, 4], strokeScaleEnabled: false, listening: false }));
    }
    this.frontLayer.batchDraw();
  }

  private renderMessage(text: string): void {
    const group = new Konva.Group({ x: 12, y: 12, listening: false });
    const label = new Konva.Text({ text, fontSize: 15, fill: '#1f2937', fontFamily: 'system-ui, sans-serif', padding: 8 });
    group.add(new Konva.Rect({ width: label.width(), height: label.height(), fill: 'rgba(255,255,255,0.9)', cornerRadius: 6, stroke: '#d1d5db' }));
    group.add(label);
    this.constNodes.push(group);
    this.toolGroup.add(group);
  }

  destroy(): void {
    this.stage.destroy();
  }
}
