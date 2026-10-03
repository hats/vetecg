/**
 * Sheet toolbar: overlay and grid (stories 59, 16), active lead (64), edit modes — separator (20а) and two-click
 * calibration (17), «Сбросить правки» (reset edits, 63), zoom (65), sheet badges and warnings, debug layers with
 * `?debug=1`. Built once; `update` resets the values.
 */
import { LEAD_IDS, type LeadId } from '../../types/contracts';
import { h } from '../ui/dom';
import type { Mode } from './scene';
import { LEAD_COLORS } from './style';

export type CalibMm = 50 | 5;
export type DebugLayerKey = 'ink' | 'runs' | 'zones' | 'glyphs';

export interface ToolbarBadge {
  text: string;
  kind: 'info' | 'warning' | 'manual';
}

export interface ToolbarState {
  hasPage: boolean;
  overlayOn: boolean;
  gridOn: boolean;
  activeLead: LeadId;
  leads: { id: LeadId; present: boolean; confidence?: number }[];
  mode: Mode;
  calibMm: CalibMm;
  editsCount: number;
  zoom: number;
  badges: ToolbarBadge[];
  warnings: string[];
  hint?: string;
  debug?: Record<DebugLayerKey, boolean> & { stats?: string };
}

export interface ToolbarActions {
  setOverlay(on: boolean): void;
  setGrid(on: boolean): void;
  setLead(id: LeadId): void;
  setMode(mode: Mode): void;
  setCalibMm(mm: CalibMm): void;
  resetEdits(): void;
  resetView(): void;
  zoomBy(factor: number): void;
  setDebug(key: DebugLayerKey, on: boolean): void;
}

const BADGE_CLASS: Record<ToolbarBadge['kind'], string> = { info: 'badge-ghost', warning: 'badge-warning', manual: 'badge-info' };

const toggle = (label: string, testId: string): [HTMLLabelElement, HTMLInputElement] => {
  const input = h('input', { type: 'checkbox', class: 'toggle toggle-xs', 'data-testid': testId });
  return [h('label', { class: 'flex items-center gap-1 text-xs cursor-pointer' }, input, label), input];
};

export function buildToolbar(actions: ToolbarActions, debug: boolean): { el: HTMLElement; update(state: ToolbarState): void } {
  const [overlayRow, overlay] = toggle('Оверлей', 'overlay-toggle');
  const [gridRow, grid] = toggle('Сетка', 'grid-toggle');
  overlay.addEventListener('change', () => actions.setOverlay(overlay.checked));
  grid.addEventListener('change', () => actions.setGrid(grid.checked));

  const leadButtons = new Map<LeadId, HTMLButtonElement>();
  const leads = h('div', { class: 'join', role: 'group', 'aria-label': 'Активное отведение' });
  for (const id of LEAD_IDS) {
    const button = h('button', { type: 'button', class: 'btn btn-xs join-item', 'data-testid': `lead-${id}`, style: `color: ${LEAD_COLORS[id]}` }, id);
    button.addEventListener('click', () => actions.setLead(id));
    leadButtons.set(id, button);
    leads.append(button);
  }

  const separator = h('button', { type: 'button', class: 'btn btn-xs btn-outline', 'data-testid': 'mode-separator', title: 'Разделитель отведений там, где кривые слиплись' }, 'Разделитель');
  const calibration = h('button', { type: 'button', class: 'btn btn-xs btn-outline', 'data-testid': 'mode-calibration', title: 'Ручная калибровка px/мм двумя кликами' }, 'Калибровка');
  const calibMm = h('select', { class: 'select select-xs', 'data-testid': 'calib-mm', title: 'По чему калибровать' });
  calibMm.append(h('option', { value: '50' }, 'две метки «+» = 50 мм'), h('option', { value: '5' }, 'два узла пунктира = 5 мм'));
  separator.addEventListener('click', () => actions.setMode(separator.classList.contains('btn-active') ? 'pan' : 'separator'));
  calibration.addEventListener('click', () => actions.setMode(calibration.classList.contains('btn-active') ? 'pan' : 'calibration'));
  calibMm.addEventListener('change', () => actions.setCalibMm(calibMm.value === '5' ? 5 : 50));

  const reset = h('button', { type: 'button', class: 'btn btn-xs btn-outline btn-warning', 'data-testid': 'reset-edits' }, 'Сбросить правки');
  reset.addEventListener('click', () => actions.resetEdits());
  const editsCount = h('span', { class: 'badge badge-xs badge-ghost', 'data-testid': 'edits-count' });

  const zoomOut = h('button', { type: 'button', class: 'btn btn-xs join-item', title: 'Отдалить' }, '−');
  const zoomIn = h('button', { type: 'button', class: 'btn btn-xs join-item', title: 'Приблизить' }, '+');
  const zoomText = h('span', { class: 'btn btn-xs join-item no-animation pointer-events-none font-mono', 'data-testid': 'zoom' }, '×1.0');
  const fit = h('button', { type: 'button', class: 'btn btn-xs join-item', title: 'Вписать лист (зум 1×)', 'data-testid': 'zoom-fit' }, 'Вписать');
  zoomOut.addEventListener('click', () => actions.zoomBy(1 / 1.5));
  zoomIn.addEventListener('click', () => actions.zoomBy(1.5));
  fit.addEventListener('click', () => actions.resetView());

  const badges = h('div', { class: 'flex flex-wrap items-center gap-1', 'data-testid': 'sheet-badges' });
  const hint = h('div', { class: 'text-xs text-info hidden', 'data-testid': 'mode-hint' });
  const warnings = h('div', { class: 'flex flex-col gap-1', 'data-testid': 'overlay-warnings' });

  const debugInputs = new Map<DebugLayerKey, HTMLInputElement>();
  const debugRow = h('div', { class: 'flex flex-wrap items-center gap-3 text-xs', 'data-testid': 'debug-layers' });
  const debugStats = h('span', { class: 'opacity-70 font-mono' });
  if (debug) {
    debugRow.append(h('span', { class: 'font-semibold' }, 'Отладка:'));
    const layers: [DebugLayerKey, string][] = [
      ['ink', 'чернила'],
      ['runs', 'прогоны'],
      ['zones', 'зоны профиля'],
      ['glyphs', 'глифы'],
    ];
    for (const [key, label] of layers) {
      const [row, input] = toggle(label, `debug-${key}`);
      input.addEventListener('change', () => actions.setDebug(key, input.checked));
      debugInputs.set(key, input);
      debugRow.append(row);
    }
    debugRow.append(debugStats);
  }

  const el = h(
    'div',
    { class: 'flex flex-col gap-1', 'data-testid': 'overlay-toolbar' },
    h(
      'div',
      { class: 'flex flex-wrap items-center gap-3' },
      overlayRow,
      gridRow,
      h('span', { class: 'text-xs opacity-70' }, 'Отведение:'),
      leads,
      h('div', { class: 'flex items-center gap-1' }, separator, calibration, calibMm),
      h('div', { class: 'flex items-center gap-1' }, reset, editsCount),
      h('div', { class: 'join ml-auto' }, zoomOut, zoomText, zoomIn, fit),
    ),
    badges,
    hint,
    warnings,
    debug ? debugRow : null,
  );

  const update = (s: ToolbarState): void => {
    overlay.checked = s.overlayOn;
    grid.checked = s.gridOn;
    grid.disabled = !s.hasPage;
    for (const [id, button] of leadButtons) {
      const lead = s.leads.find((l) => l.id === id);
      button.classList.toggle('btn-active', id === s.activeLead);
      button.classList.toggle('opacity-40', !!lead && !lead.present);
      button.title = lead?.present ? `${id}: уверенность ${Math.round((lead.confidence ?? 0) * 100)} %` : `${id}: кривая не найдена`;
    }
    separator.classList.toggle('btn-active', s.mode === 'separator');
    calibration.classList.toggle('btn-active', s.mode === 'calibration');
    separator.disabled = !s.hasPage;
    calibration.disabled = !s.hasPage;
    calibMm.value = String(s.calibMm);
    reset.disabled = s.editsCount === 0;
    editsCount.textContent = s.editsCount ? `правок: ${s.editsCount}` : 'правок нет';
    zoomText.textContent = `×${s.zoom.toFixed(1)}`;
    badges.replaceChildren(...s.badges.map((b) => h('span', { class: `badge badge-sm ${BADGE_CLASS[b.kind]}` }, b.text)));
    hint.classList.toggle('hidden', !s.hint);
    hint.textContent = s.hint ?? '';
    warnings.replaceChildren(...s.warnings.map((w) => h('div', { class: 'alert alert-warning text-xs py-1 px-3', role: 'alert' }, w)));
    if (s.debug) {
      for (const [key, input] of debugInputs) input.checked = s.debug[key];
      debugStats.textContent = s.debug.stats ?? '';
    }
  };

  return { el, update };
}
