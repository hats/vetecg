/**
 * Submodule `app/overlay` (task 11): the sheet with overlay, zoom and on-image edits. Mounted into `#sheet` of the
 * task 10 shell and reads state via `getCaseStore()`; edits go to the store as `Edit` (`addEdit`/`setEdits`/
 * `resetEdits`), recomputation is done by `analyzeCase` in the store. Only the active sheet of the strip is drawn
 * («Рост» elaboration).
 *
 * What is shown: the edited sheet `CaseResult.perPage[i]` (edits already applied), beats `CaseResult.beats` of this
 * sheet, separators and manual calibration from `CaseState.edits`. After beats are recomputed, markers are matched by
 * time (`staleMarkerEdits`) and those that lost their complex are reset with a warning (task 09 review agreement).
 */
import { LEAD_IDS, type Edit, type GrayImage, type GridEstimate, type LeadId, type MarkerField, type Point, type TraceHint } from '../../types/contracts';
import { activeCase, getCaseStore, type AppState, type CaseState, type Sheet } from '../state/case-store';
import { h } from '../ui/dom';
import { buildDebugCanvases, isDebug, type DebugCanvases } from './debug';
import { autoLabelOf, pxPerMmFromClicks, separatorHint, swapLabelEdits, type LeadBaseline } from './edits';
import type { View } from './geometry';
import { ectopicPositions, staleMarkerEdits } from './markers';
import { OverlayScene, type DebugModel, type Mode, type SceneModel } from './scene';
import { buildToolbar, type CalibMm, type DebugLayerKey, type ToolbarBadge, type ToolbarState } from './toolbar';

export { autoLabelOf, pxPerMmFromClicks, sameEdit, separatorHint, swapLabelEdits } from './edits';
export { gridLines, timeToX, traceSegments, xToTime, yOnTrace, zoomAt } from './geometry';
export { ectopicPositions, markerBounds, staleMarkerEdits } from './markers';

const MODE_HINT: Record<Mode, string | undefined> = {
  pan: undefined,
  separator: 'Разделитель: проведите горизонтальную линию по участку, где кривые слиплись — всё выше отойдёт верхнему отведению, ниже — нижнему. Esc — отмена.',
  calibration: 'Калибровка: кликните две соседние секундные метки «+» (50 мм) или два узла 5-мм пунктира (5 мм). Esc — отмена.',
};

const FIELD_TITLE: Record<MarkerField, string> = { pOn: 'начало P', pOff: 'конец P', qOn: 'начало QRS', sOff: 'конец QRS', tOff: 'конец T' };

/** Gray image → canvas (fallback raster if the file's object URL is unavailable). */
function canvasFromGray(image: GrayImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const data = ctx.createImageData(image.width, image.height);
    for (let i = 0; i < image.data.length; i++) {
      const v = image.data[i];
      const o = i * 4;
      data.data[o] = v;
      data.data[o + 1] = v;
      data.data[o + 2] = v;
      data.data[o + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  }
  return canvas;
}

const sameHint = (a: TraceHint, b: TraceHint): boolean => a.x0 === b.x0 && a.x1 === b.x1 && a.y === b.y && a.above === b.above && a.below === b.below;

export function mountOverlay(host: HTMLElement): void {
  host.dataset.module = 'overlay';
  host.className = 'flex flex-col gap-2 min-w-0';
  host.replaceChildren();
  const store = getCaseStore();
  const debug = isDebug();

  const sceneHost = h('div', {
    class: 'relative w-full overflow-hidden rounded-box border border-base-300 bg-base-200 select-none',
    style: 'touch-action: none; min-height: 160px',
    'data-testid': 'sheet-stage',
  });
  const tooltip = h('div', {
    class: 'absolute z-20 hidden pointer-events-none rounded bg-neutral text-neutral-content text-xs px-2 py-1 max-w-xs shadow',
    'data-testid': 'overlay-tooltip',
  });
  const menu = h('ul', { class: 'menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 absolute z-30 hidden w-60 p-1', 'data-testid': 'overlay-menu' });
  const empty = h('div', { class: 'p-6 text-sm text-base-content/60 text-center', 'data-testid': 'sheet-empty' }, 'Выберите лист в ленте — здесь появится лист с оверлеем');
  // Konva clears its container's content when creating the Stage — it gets a separate div, menu and tooltip beside it.
  const stageDiv = h('div', { class: 'w-full', 'data-testid': 'konva-host' });
  sceneHost.append(stageDiv, tooltip, menu);

  // Overlay UI state (not part of the case): toggles, mode, active lead per sheet, rasters.
  const ui = {
    overlayOn: true,
    gridOn: false,
    mode: 'pan' as Mode,
    calibMm: 50 as CalibMm,
    debug: { ink: debug, runs: false, zones: debug, glyphs: debug } as Record<DebugLayerKey, boolean>,
  };
  const activeLeadBySheet = new Map<string, LeadId>();
  const images = new Map<string, HTMLImageElement | HTMLCanvasElement>();
  const loading = new Set<string>();
  const debugCache = new Map<string, DebugCanvases>();
  let calibrationPoints: Point[] = [];
  let warnings: string[] = [];
  let staleVersion = -1;
  let scene: OverlayScene | undefined;
  let view: View = { zoom: 1, x: 0, y: 0 };
  let current: { c: CaseState; sheet: Sheet; index: number; pageEdits: Edit[] } | undefined;

  const toolbar = buildToolbar(
    {
      setOverlay: (on) => {
        ui.overlayOn = on;
        render();
      },
      setGrid: (on) => {
        ui.gridOn = on;
        render();
      },
      setLead: (id) => {
        if (current) activeLeadBySheet.set(current.sheet.id, id);
        render();
      },
      setMode: (mode) => setMode(mode),
      setCalibMm: (mm) => {
        ui.calibMm = mm;
        render();
      },
      resetEdits: () => {
        calibrationPoints = [];
        warnings = [];
        store.resetEdits();
      },
      resetView: () => scene?.resetView(),
      zoomBy: (factor) => scene?.zoomBy(factor),
      setDebug: (key, on) => {
        ui.debug[key] = on;
        render();
      },
    },
    debug,
  );
  host.append(toolbar.el, sceneHost, empty);

  const setMode = (mode: Mode): void => {
    ui.mode = mode;
    if (mode !== 'calibration') calibrationPoints = [];
    render();
  };

  const hideMenu = (): void => menu.classList.add('hidden');
  const showMenu = (at: Point, items: { label: string; action?: () => void; header?: boolean }[]): void => {
    menu.replaceChildren(
      ...items.map((item) => {
        if (item.header) return h('li', { class: 'menu-title text-xs' }, item.label);
        const a = h('a', { role: 'menuitem' }, item.label);
        a.addEventListener('click', () => {
          hideMenu();
          item.action?.();
        });
        return h('li', {}, a);
      }),
    );
    menu.style.left = `${Math.max(0, Math.min(at.x, sceneHost.clientWidth - 250))}px`;
    menu.style.top = `${Math.max(0, at.y)}px`;
    menu.classList.remove('hidden');
  };
  // Close on mousedown, not click: Konva opens the menu from mouseup, and the following DOM click would close it at once.
  document.addEventListener('mousedown', (event) => {
    if (!menu.contains(event.target as Node)) hideMenu();
  });
  document.addEventListener('touchstart', (event) => {
    if (!menu.contains(event.target as Node)) hideMenu();
  });

  /** An edit replaces the previous edit of the same target (the last one wins in `applyPageEdits` anyway) — the list does not grow. */
  const upsertEdit = (c: CaseState, edit: Edit, same: (e: Edit) => boolean): void => {
    const rest = c.edits.filter((e) => !same(e));
    if (rest.length === c.edits.length) store.addEdit(edit);
    else store.setEdits([...rest, edit]);
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    hideMenu();
    if (ui.mode !== 'pan') setMode('pan');
  });

  /** Baselines of the sheet's traces for the separator: the trace's own, otherwise the layout anchor. */
  const baselinesOf = (): LeadBaseline[] => {
    const page = pageOf();
    if (!page) return [];
    return LEAD_IDS.map((id, k) => {
      const trace = page.leads[k];
      return { id, baselineY: trace && trace.points.length > 0 ? trace.baselineY : page.layout.expectedBaselines[k] };
    });
  };
  const pageOf = () => {
    if (!current) return undefined;
    const { c, sheet, index } = current;
    return (index >= 0 ? c.result?.perPage[index] : undefined) ?? sheet.result;
  };

  const ensureScene = (): OverlayScene | undefined => {
    if (scene) return scene;
    if (sceneHost.clientWidth === 0) return undefined;
    scene = new OverlayScene(stageDiv, {
      onLeadSelect: (slot) => {
        if (current) activeLeadBySheet.set(current.sheet.id, slot);
        render();
      },
      onLeadMenu: (slot, at) => {
        if (!current || current.index < 0) return;
        const { index, pageEdits } = current;
        const auto = autoLabelOf(slot, pageEdits);
        const items: { label: string; action?: () => void; header?: boolean }[] = [
          { label: `Кривая в слоте ${slot}${auto && auto !== slot ? ` (автоматически — ${auto})` : ''}`, header: true },
          {
            label: 'Сделать активным отведением',
            action: () => {
              activeLeadBySheet.set(current!.sheet.id, slot);
              render();
            },
          },
          { label: 'Подписать как…', header: true },
        ];
        if (auto) {
          const c = current.c;
          const sameLabel = (e: Edit): boolean => e.kind === 'leadLabel' && e.page === index && e.lead === auto;
          for (const id of LEAD_IDS) {
            if (id === slot) continue;
            items.push({ label: id, action: () => upsertEdit(c, { kind: 'leadLabel', page: index, lead: auto, as: id }, sameLabel) });
          }
          items.push({ label: 'Нет отведения (не кривая ЭКГ)', action: () => upsertEdit(c, { kind: 'leadLabel', page: index, lead: auto, as: null }, sameLabel) });
        }
        // Label swap: both curves are kept (two edits [A→B, B→A]); previous edits of these leads are replaced.
        items.push({ label: 'Поменять местами…', header: true });
        for (const id of LEAD_IDS) {
          if (id === slot) continue;
          items.push({
            label: `Поменять с ${id}`,
            action: () => {
              const c = current!.c;
              const a = autoLabelOf(slot, pageEdits);
              const b = autoLabelOf(id, pageEdits);
              const rest = c.edits.filter((e) => !(e.kind === 'leadLabel' && e.page === index && (e.lead === a || e.lead === b)));
              store.setEdits([...rest, ...swapLabelEdits(slot, id, pageEdits, index)]);
            },
          });
        }
        showMenu(at, items);
      },
      onMarkerMove: (beat, field, tMs) => {
        if (!current || current.index < 0) return;
        const { c, index } = current;
        upsertEdit(c, { kind: 'marker', page: index, beat, field, tMs: Math.round(tMs * 10) / 10 }, (e) => e.kind === 'marker' && e.page === index && e.beat === beat && e.field === field);
      },
      onBaselineMove: (slot, y) => {
        if (!current || current.index < 0) return;
        const { c, index } = current;
        const lead = autoLabelOf(slot, current.pageEdits);
        if (!lead) return;
        upsertEdit(c, { kind: 'baseline', page: index, lead, y: Math.round(y * 10) / 10 }, (e) => e.kind === 'baseline' && e.page === index && e.lead === lead);
      },
      onSeparatorDraw: (a, b) => {
        if (!current || current.index < 0) return;
        const hint = separatorHint(a, b, baselinesOf());
        if (!hint) {
          warnings = ['Разделитель должен лежать между изолиниями двух соседних отведений и иметь протяжённость по x'];
          setMode('pan');
          return;
        }
        ui.mode = 'pan';
        // Retracing works in automatic labels: overlay slots are mapped to them (an empty slot is the anchor itself).
        const { pageEdits } = current;
        const auto = (slot: LeadId): LeadId => autoLabelOf(slot, pageEdits) ?? slot;
        store.addEdit({
          kind: 'separator',
          page: current.index,
          hint: { x0: Math.round(hint.x0), x1: Math.round(hint.x1), y: Math.round(hint.y * 10) / 10, above: auto(hint.above), below: auto(hint.below) },
        });
      },
      onSeparatorMenu: (hint, at) => {
        if (!current || current.index < 0) return;
        const { c, index } = current;
        showMenu(at, [
          { label: `Разделитель: выше ${hint.above}, ниже ${hint.below}`, header: true },
          { label: 'Удалить разделитель', action: () => store.setEdits(c.edits.filter((e) => !(e.kind === 'separator' && e.page === index && sameHint(e.hint, hint)))) },
        ]);
      },
      onCalibrationClick: (p) => {
        if (!current || current.index < 0) return;
        calibrationPoints = [...calibrationPoints, p].slice(-2);
        if (calibrationPoints.length === 2) {
          const page = pageOf();
          const v = pxPerMmFromClicks(calibrationPoints[0], calibrationPoints[1], ui.calibMm);
          if (page && v > 0.5) {
            ui.mode = 'pan';
            // The edit carries only the px/mm scale; `calib` is the sheet's current calibration unchanged (mm/s and
            // mm/mV are not pinned: applying them and the «вручную» (manual) mark are up to `applyPageEdits`, which
            // reads `pxPerMm`).
            const { c, index } = current;
            upsertEdit(c, { kind: 'calibration', page: index, calib: page.calib, pxPerMm: { x: v, y: v } }, (e) => e.kind === 'calibration' && e.page === index && e.pxPerMm !== undefined);
            return;
          }
          warnings = ['Калибровка: точки слишком близко — кликните две соседние метки «+» или два узла 5-мм пунктира'];
          calibrationPoints = [];
        }
        render();
      },
      onViewChange: (v) => {
        view = v;
        toolbar.update(toolbarState());
      },
      onHover: (text, at) => {
        if (!text) {
          tooltip.classList.add('hidden');
          return;
        }
        tooltip.textContent = text;
        tooltip.style.left = `${Math.min(at.x + 12, Math.max(0, sceneHost.clientWidth - 260))}px`;
        tooltip.style.top = `${at.y + 16}px`;
        tooltip.classList.remove('hidden');
      },
    });
    // For debugging and end-to-end checks in the browser: the scene and Konva stage (like `window.vetecg.store` in task 10).
    (window as unknown as { vetecgOverlay?: unknown }).vetecgOverlay = { scene, stage: scene.konvaStage };
    return scene;
  };

  const imageFor = (sheet: Sheet): HTMLImageElement | HTMLCanvasElement | undefined => {
    const cached = images.get(sheet.id);
    if (cached) return cached;
    if (sheet.imageUrl && !loading.has(sheet.id)) {
      loading.add(sheet.id);
      const img = new Image();
      img.onload = () => {
        loading.delete(sheet.id);
        images.set(sheet.id, img);
        render();
      };
      img.onerror = () => {
        loading.delete(sheet.id);
        if (sheet.image) images.set(sheet.id, canvasFromGray(sheet.image));
        render();
      };
      img.src = sheet.imageUrl;
      return undefined;
    }
    if (!sheet.imageUrl && sheet.image) {
      const canvas = canvasFromGray(sheet.image);
      images.set(sheet.id, canvas);
      return canvas;
    }
    return undefined;
  };

  /** Rasters of sheets no longer in any case are dropped (the object URL is already revoked). */
  const prune = (state: AppState): void => {
    const alive = new Set(state.cases.flatMap((c) => c.sheets.map((s) => s.id)));
    for (const id of [...images.keys()]) if (!alive.has(id)) images.delete(id);
    for (const id of [...debugCache.keys()]) if (!alive.has(id)) debugCache.delete(id);
  };

  const manualGrid = (c: CaseState, index: number, grid: GridEstimate, frame: { x: number; y: number }): { grid: GridEstimate; pxPerMm: number } | undefined => {
    const edit = [...c.edits].reverse().find((e): e is Extract<Edit, { kind: 'calibration' }> => e.kind === 'calibration' && e.pxPerMm !== undefined && (e.page === index || e.page === undefined));
    if (!edit?.pxPerMm) return undefined;
    return {
      pxPerMm: edit.pxPerMm.x,
      grid: { pxPerMmX: edit.pxPerMm.x, pxPerMmY: edit.pxPerMm.y, phaseX: grid.pxPerMmX > 0 ? grid.phaseX : frame.x, phaseY: grid.pxPerMmY > 0 ? grid.phaseY : frame.y, confidence: 1 },
    };
  };

  const toolbarState = (): ToolbarState => {
    const page = pageOf();
    const badges: ToolbarBadge[] = [];
    let hint = MODE_HINT[ui.mode];
    if (ui.mode === 'calibration' && calibrationPoints.length === 1) hint = `${hint} Первая точка поставлена — кликните вторую.`;
    let debugStats: string | undefined;
    if (current && page) {
      const { c, index, sheet } = current;
      const gridMissing = !(page.layout.grid.pxPerMmX > 0 && page.layout.grid.pxPerMmY > 0);
      const manual = index >= 0 ? manualGrid(c, index, page.layout.grid, page.layout.frame) : undefined;
      if (manual) {
        // "Applied" — only if the sheet grid in the result equals the given scale (read by `applyPageEdits`).
        const applied = Math.abs(page.layout.grid.pxPerMmX - manual.grid.pxPerMmX) < 1e-6 && Math.abs(page.layout.grid.pxPerMmY - manual.grid.pxPerMmY) < 1e-6;
        badges.push(
          applied
            ? { text: `калибровка вручную: ${manual.pxPerMm.toFixed(2)} px/мм`, kind: 'manual' }
            : { text: `калибровка вручную: ${manual.pxPerMm.toFixed(2)} px/мм — не применено (лист считается по сетке ${page.layout.grid.pxPerMmX.toFixed(2)} px/мм)`, kind: 'warning' },
        );
      } else if (gridMissing) badges.push({ text: 'калибровка не определена — задайте двумя кликами («Калибровка»)', kind: 'warning' });
      else badges.push({ text: `сетка ${page.layout.grid.pxPerMmX.toFixed(2)}×${page.layout.grid.pxPerMmY.toFixed(2)} px/мм, уверенность ${Math.round(page.layout.grid.confidence * 100)} %`, kind: 'info' });
      if (page.calibSource === 'manual') badges.push({ text: `калибровка листа задана вручную: ${page.calib.mmPerS} мм/с, ${page.calib.mmPerMv} мм/мВ`, kind: 'manual' });
      if (page.issues.includes('lead_order_mismatch')) badges.push({ text: 'подписи отведений не в ожидаемом порядке — проверьте и переназначьте через правую кнопку', kind: 'warning' });
      const missing = page.leads.filter((t) => t.points.length === 0).map((t) => t.id);
      if (missing.length && missing.length < 6) badges.push({ text: `не найдены кривые: ${missing.join(', ')}`, kind: 'warning' });
      if (index >= 0 && c.result && !c.result.beats?.some((pb) => pb.page === index)) badges.push({ text: 'лист не учтён в случае (дубликат, повтор интервала или другое животное)', kind: 'info' });
      if (page.precision.mvPerPx > 0) badges.push({ text: `1 px = ${Math.round(page.precision.mvPerPx * 1000)} мкВ / ${page.precision.msPerPx.toFixed(1)} мс`, kind: 'info' });
      const stats = debugCache.get(sheet.id)?.stats;
      if (stats) debugStats = `прогонов ${stats.runs}, компонент графа ${stats.components}, компонент чернил ${stats.inkComponents}, текстовых ${stats.textComponents}`;
    }
    return {
      hasPage: !!page,
      overlayOn: ui.overlayOn,
      gridOn: ui.gridOn,
      activeLead: current ? activeLeadBySheet.get(current.sheet.id) ?? 'II' : 'II',
      leads: LEAD_IDS.map((id, k) => ({ id, present: !!page?.leads[k] && page.leads[k].points.length > 0, confidence: page?.leads[k]?.confidence })),
      mode: ui.mode,
      calibMm: ui.calibMm,
      editsCount: current?.c.edits.length ?? 0,
      zoom: view.zoom,
      badges,
      warnings,
      hint,
      debug: debug ? { ...ui.debug, stats: debugStats } : undefined,
    };
  };

  /** Marker check after beats are recomputed — outside the subscriber (setEdits itself triggers recompute and emit). */
  const checkStaleMarkers = (state: AppState, c: CaseState): void => {
    if (!c.result?.beats || staleVersion === state.version) return;
    const stale = staleMarkerEdits(c.edits, c.result.beats);
    if (stale.length === 0) return;
    staleVersion = state.version;
    warnings = stale.map((e) => {
      if (e.kind !== 'marker') return '';
      const sheet = c.sheets.find((s) => s.id === c.caseSheets[e.page]);
      return `Сброшен маркер «${FIELD_TITLE[e.field]}» комплекса ${e.beat + 1} листа «${sheet?.name ?? e.page + 1}»: удары пересчитаны, комплекс не найден по времени`;
    });
    queueMicrotask(() => store.setEdits(c.edits.filter((e) => !stale.includes(e))));
  };

  const render = (): void => {
    const state = store.getState();
    prune(state);
    const c = activeCase(state);
    const sheet = c.sheets.find((s) => s.id === c.activeSheetId);
    if (!sheet) {
      current = undefined;
      sceneHost.classList.add('hidden');
      empty.classList.remove('hidden');
      toolbar.update(toolbarState());
      return;
    }
    sceneHost.classList.remove('hidden');
    empty.classList.add('hidden');
    const index = c.caseSheets.indexOf(sheet.id);
    const pageEdits = index >= 0 ? c.edits.filter((e) => e.page === index) : [];
    current = { c, sheet, index, pageEdits };
    checkStaleMarkers(state, c);

    const sc = ensureScene();
    const page = pageOf();
    const image = imageFor(sheet);
    const width = sheet.width ?? sheet.image?.width ?? page?.layout.frame.width ?? 1280;
    const height = sheet.height ?? sheet.image?.height ?? page?.layout.frame.height ?? 905;
    const beats = index >= 0 ? c.result?.beats?.find((pb) => pb.page === index) : undefined;
    const activeLead = activeLeadBySheet.get(sheet.id) ?? 'II';
    const ectopics = new Map(
      ectopicPositions(c.result?.beats ?? [], c.result?.rhythm.ectopics ?? [])
        .filter((p) => p.page === index)
        .map((p) => [p.beat, p.kind] as const),
    );
    const separators = pageEdits.filter((e): e is Extract<Edit, { kind: 'separator' }> => e.kind === 'separator').map((e) => e.hint);
    const manual = page && index >= 0 ? manualGrid(c, index, page.layout.grid, page.layout.frame) : undefined;

    let debugModel: DebugModel | undefined;
    if (debug && page) {
      let canvases = debugCache.get(sheet.id);
      if (!canvases && (ui.debug.ink || ui.debug.runs) && sheet.image) {
        canvases = buildDebugCanvases(sheet.image, page.layout);
        debugCache.set(sheet.id, canvases);
      }
      debugModel = { ink: ui.debug.ink ? canvases?.ink : undefined, runs: ui.debug.runs ? canvases?.runs : undefined, zones: ui.debug.zones, glyphs: ui.debug.glyphs };
    }

    let message: string | undefined;
    if (sheet.status === 'queued' || sheet.status === 'analyzing') message = 'Лист распознаётся…';
    else if (sheet.status === 'error') message = sheet.error ?? 'Ошибка распознавания';
    else if (page && page.leads.every((t) => t.points.length === 0)) message = 'Кривые не распознаны — показана только картинка';
    else if (!image) message = 'Загрузка изображения…';

    const model: SceneModel = {
      key: sheet.id,
      image,
      width,
      height,
      page,
      beats,
      activeLead,
      overlayOn: ui.overlayOn,
      gridOn: ui.gridOn,
      grid: manual?.grid ?? page?.layout.grid,
      ectopics,
      separators,
      mode: ui.mode,
      calibrationPoints,
      debug: debugModel,
      message,
    };
    if (sc) {
      sc.render(model);
      view = sc.getView();
    }
    toolbar.update(toolbarState());
  };

  // The scene is created once the container gets a width (the case screen is hidden until the first sheet).
  const observer = new ResizeObserver(() => {
    if (!scene) render();
    else scene.resize();
  });
  observer.observe(sceneHost);

  store.subscribe(() => render());
  render();
}
