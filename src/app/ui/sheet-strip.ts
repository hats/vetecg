/**
 * Sheet strip (stories 1, 6, 8–9, 30): thumbnail, status, read time, badges («дубликат» (duplicate), «повтор интервала»
 * (repeated interval), «не учтён» (not counted), unverified header), per-file error, sheet confidence; click selects the
 * active sheet; with `order_unknown`, dragging thumbnails reorders the case's sheets.
 */
import { activeCase, displayOrder, sheetBadges, sheetTimeText, type AppState, type CaseState, type CaseStore, type Sheet } from '../state/case-store';
import { h, percent, STATUS_CLASS, STATUS_LABEL } from './dom';

export interface SheetStripActions {
  pickFiles(): void;
}

export function mountSheetStrip(host: HTMLElement, store: CaseStore, actions: SheetStripActions): void {
  host.className = 'flex flex-col gap-2 min-w-0';
  let dragging: string | null = null;

  const card = (sheet: Sheet, c: CaseState, reorderable: boolean): HTMLElement => {
    const active = sheet.id === c.activeSheetId;
    const el = h('div', {
      class: `card card-compact bg-base-100 border ${active ? 'border-primary ring-1 ring-primary' : 'border-base-300'} ${reorderable ? 'cursor-move' : 'cursor-pointer'}`,
      draggable: reorderable ? 'true' : undefined,
      'data-sheet-id': sheet.id,
      'data-status': sheet.status,
      title: sheet.name,
    });
    el.append(
      sheet.thumbnailUrl
        ? h('figure', { class: 'bg-base-200' }, h('img', { src: sheet.thumbnailUrl, alt: `Лист ${sheet.name}`, class: 'w-full' }))
        : h('figure', { class: 'bg-base-200 h-16 flex items-center justify-center text-xs text-base-content/50' }, 'нет изображения'),
    );
    const status = h('span', { class: `badge badge-xs ${STATUS_CLASS[sheet.status]}` }, STATUS_LABEL[sheet.status]);
    const line = h('div', { class: 'flex flex-wrap items-center gap-1 text-xs' }, status);
    if (sheet.status === 'analyzing' && sheet.attempt > 1) line.append(h('span', { class: 'badge badge-xs badge-warning' }, `попытка ${sheet.attempt}`));
    const time = sheetTimeText(c, sheet.id);
    if (time) line.append(h('span', { class: 'font-mono', 'data-testid': 'sheet-time' }, time));
    if (sheet.status === 'done' && sheet.result && sheet.duplicateOf === undefined) {
      line.append(h('span', { class: 'opacity-70' }, `уверенность ${percent(sheet.result.confidence)}`));
    }
    for (const badge of sheetBadges(c, sheet.id)) line.append(h('span', { class: 'badge badge-xs badge-warning' }, badge));

    const remove = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', title: 'Убрать лист из случая', 'aria-label': 'Убрать лист' }, '×');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      store.removeSheets([sheet.id]);
    });
    el.append(
      h(
        'div',
        { class: 'card-body p-2 gap-1' },
        h('div', { class: 'flex items-start gap-1' }, h('span', { class: 'text-xs truncate flex-1' }, sheet.name), remove),
        line,
        sheet.error ? h('div', { class: 'text-xs text-error', 'data-testid': 'sheet-error' }, sheet.error) : null,
      ),
    );

    el.addEventListener('click', () => store.setActiveSheet(sheet.id));
    if (reorderable) {
      el.addEventListener('dragstart', (event) => {
        dragging = sheet.id;
        event.dataTransfer?.setData('text/plain', sheet.id);
      });
      el.addEventListener('dragover', (event) => {
        event.preventDefault();
        el.classList.add('border-primary');
      });
      el.addEventListener('dragleave', () => {
        if (sheet.id !== c.activeSheetId) el.classList.remove('border-primary');
      });
      el.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const moving = dragging ?? event.dataTransfer?.getData('text/plain') ?? null;
        dragging = null;
        if (moving && moving !== sheet.id) store.reorderSheets(moving, sheet.id);
      });
    }
    return el;
  };

  const render = (state: AppState): void => {
    const c = activeCase(state);
    const reorderable = (c.result?.issues ?? []).includes('order_unknown');
    const add = h('button', { class: 'btn btn-sm btn-outline', type: 'button', 'data-testid': 'add-sheets' }, 'Добавить листы');
    add.addEventListener('click', () => actions.pickFiles());
    const tail = h('div', { class: 'min-h-6' });
    if (reorderable) {
      tail.addEventListener('dragover', (event) => event.preventDefault());
      tail.addEventListener('drop', (event) => {
        event.preventDefault();
        if (dragging) store.reorderSheets(dragging, null);
        dragging = null;
      });
    }
    const parts: (Node | null)[] = [
      h('h2', { class: 'text-sm font-semibold' }, `Листы: ${c.sheets.length}`),
      reorderable ? h('p', { class: 'text-xs text-warning' }, 'Порядок не прочитан — перетащите миниатюры в нужном порядке') : null,
      ...displayOrder(c).map((sheet) => card(sheet, c, reorderable)),
      tail,
      add,
    ];
    host.replaceChildren(...parts.filter((node): node is Node => node !== null));
  };

  store.subscribe(render);
  render(store.getState());
}
