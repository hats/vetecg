/**
 * Screen skeleton (§5: empty → case → result): app header with progress and «Новый случай» (new case), case tabs after
 * «Разделить» (split), empty screen, sheet strip, mount points for the overlay (`#sheet`, task 11) and results
 * (`#results`, task 12), case panel, different-animals dialog. Files are accepted by drag-and-drop anywhere in the window
 * and via the file picker; browser warning when closing the tab with an unfinished case (story 66).
 */
import { plural } from '../../analysis/conclusion';
import { prepareFiles } from '../files/decode';
import { activeCase, type AppState, type CaseStore, type Progress, type SheetInput } from '../state/case-store';
import { mountAnimalsDialog } from './animals-dialog';
import { batchNotice } from './batch-notice';
import { mountCasePanel } from './case-panel';
import { h } from './dom';
import { buildEmptyScreen } from './empty-screen';
import { mountSheetStrip } from './sheet-strip';

export interface AppShellDeps {
  prepareFile(file: File): Promise<SheetInput>;
  loadExample(): Promise<File>;
}

export interface MountedShell {
  /** Mount point for the sheet with its overlay (task 11). */
  sheetHost: HTMLElement;
  /** Mount point for the table and conclusion (task 12). */
  resultsHost: HTMLElement;
  addFiles(files: File[]): Promise<void>;
}


function progressText(p: Progress): string {
  if (p.total === 0) return '';
  const failed = p.failed ? `, с ошибкой: ${p.failed}` : '';
  if (p.running + p.queued > 0) return `Распознавание: готово ${p.done} из ${p.total}${failed}`;
  return `Готово: ${p.done} из ${p.total} ${plural(p.total, ['листа', 'листов', 'листов'])}${failed}`;
}

export function mountApp(root: HTMLElement, store: CaseStore, deps: AppShellDeps): MountedShell {
  const fileInput = h('input', {
    id: 'file-input',
    type: 'file',
    multiple: true,
    accept: 'image/jpeg,image/png,.jpg,.jpeg,.png',
    class: 'hidden',
    'data-testid': 'file-input',
  });
  const progress = h('span', { class: 'text-sm', 'data-testid': 'progress' });
  const notice = h('span', { class: 'text-sm text-warning', 'data-testid': 'notice' });
  const newCase = h('button', { class: 'btn btn-sm btn-outline', type: 'button', 'data-testid': 'new-case' }, 'Новый случай');
  const tabs = h('div', { role: 'tablist', class: 'tabs tabs-box mx-4 mt-2 hidden', 'data-testid': 'case-tabs' });

  const sheetsHost = h('aside', { id: 'sheets' });
  const sheetHost = h('div', {
    id: 'sheet',
    class: 'min-h-[60vh] rounded-box border border-dashed border-base-300 flex items-center justify-center text-base-content/50',
  });
  const resultsHost = h('div', { id: 'results' });
  const panelHost = h('aside', { id: 'case-panel' });
  const caseScreen = h(
    'main',
    { id: 'case', class: 'hidden flex-1 gap-4 p-4 lg:grid', style: 'grid-template-columns: 220px minmax(0, 1fr) 320px' },
    sheetsHost,
    h('section', { class: 'flex flex-col gap-4 min-w-0' }, sheetHost, resultsHost),
    panelHost,
  );

  const pickFiles = (): void => fileInput.click();
  const addFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    notice.textContent = batchNotice(files.length);
    progress.textContent = `Загрузка ${files.length} ${plural(files.length, ['файла', 'файлов', 'файлов'])}…`;
    const inputs = await prepareFiles(files, (file) => deps.prepareFile(file));
    store.addSheets(inputs);
  };
  const tryExample = async (): Promise<void> => {
    try {
      await addFiles([await deps.loadExample()]);
    } catch (error: unknown) {
      notice.textContent = `Пример не загрузился: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const emptyScreen = buildEmptyScreen({ pickFiles, tryExample: () => void tryExample() });
  const dialog = mountAnimalsDialog(store);

  root.replaceChildren(
    h(
      'div',
      { class: 'min-h-screen flex flex-col' },
      h(
        'header',
        { class: 'navbar bg-base-200 px-4 gap-4' },
        h('span', { class: 'text-xl font-semibold' }, 'VetECG 2'),
        h('span', { class: 'text-sm opacity-70 hidden md:inline' }, 'анализ ЭКГ собак и кошек по экспортам «Поли-Спектр.NET»'),
        h('div', { class: 'ml-auto flex items-center gap-3' }, notice, progress, newCase),
      ),
      tabs,
      emptyScreen,
      caseScreen,
      dialog,
      fileInput,
    ),
  );

  mountSheetStrip(sheetsHost, store, { pickFiles });
  mountCasePanel(panelHost, store);

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    void addFiles(files);
  });
  newCase.addEventListener('click', () => {
    if (store.getState().phase === 'case' && !window.confirm('Начать новый случай? Текущие листы и результаты будут сброшены.')) return;
    store.newCase();
  });

  // Drag-and-drop of files anywhere in the window.
  const dropHighlight = (on: boolean): void => {
    root.classList.toggle('ring-4', on);
  };
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      dropHighlight(true);
    }
  });
  window.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) dropHighlight(false);
  });
  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dropHighlight(false);
    void addFiles(Array.from(event.dataTransfer.files));
  });

  window.addEventListener('beforeunload', (event) => {
    if (store.getState().phase !== 'case') return;
    event.preventDefault();
    event.returnValue = '';
  });

  const render = (state: AppState): void => {
    const empty = state.phase === 'empty';
    emptyScreen.classList.toggle('hidden', !empty);
    caseScreen.classList.toggle('hidden', empty);
    caseScreen.classList.toggle('lg:grid', !empty);
    progress.textContent = progressText(state.progress);
    tabs.classList.toggle('hidden', state.cases.length < 2);
    if (state.cases.length >= 2) {
      tabs.replaceChildren(
        ...state.cases.map((c) => {
          const tab = h(
            'button',
            { role: 'tab', type: 'button', class: `tab ${c.id === state.activeCaseId ? 'tab-active' : ''}`, 'data-case-id': c.id },
            `${c.title} · ${c.sheets.length} ${plural(c.sheets.length, ['лист', 'листа', 'листов'])}`,
          );
          tab.addEventListener('click', () => store.selectCase(c.id));
          return tab;
        }),
      );
    }
    document.title = empty ? 'VetECG 2 — анализ ЭКГ собак и кошек' : `${activeCase(state).title} — VetECG 2`;
  };
  store.subscribe(render);
  render(store.getState());

  return { sheetHost, resultsHost, addFiles };
}
