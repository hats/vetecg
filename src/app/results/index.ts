/**
 * `app/results` submodule (stories 14, 26–27, 58, 67–72): parameter table with species norm and colour, conclusion
 * with notes, «Скопировать» ("Copy": table TSV + notes + text to the clipboard; without a clipboard — a manual-copy
 * dialog) and «Печать» ("Print": the standard browser dialog, `print.css` styles). Data — `buildResultsView` over the
 * store's active case; re-rendered on every state change (species, calibration, edits). The skeleton — buttons, the
 * «скопировано» ("copied") badge, the manual-copy dialog — is built once: only the table, notes and text are
 * re-rendered, so an open dialog and the badge timer survive while queued sheets change state.
 */
import './print.css';
import { activeCase, getCaseStore, type AppState, type CaseState } from '../state/case-store';
import { h, SPECIES_LABEL } from '../ui/dom';
import { manualCopyMessage, writeClipboard, type ClipboardOutcome } from './clipboard';
import { buildResultsView, toClipboardText, verdictText, type ResultRow, type ResultsView, type RowTone } from './model';

const TONE_BADGE: Readonly<Record<RowTone, string>> = {
  norm: 'badge-success',
  border: 'badge-warning',
  abnormal: 'badge-error',
  none: 'badge-ghost',
  unreliable: 'badge-ghost',
};

const TONE_VALUE_CLASS: Readonly<Record<RowTone, string>> = {
  norm: 'text-success font-medium',
  border: 'text-warning font-semibold',
  abnormal: 'text-error font-semibold',
  none: '',
  unreliable: 'italic opacity-70',
};

const PLACEHOLDER: Readonly<Record<ResultsView['status'], string>> = {
  empty: '',
  pending: 'Результаты появятся, когда листы будут распознаны',
  failed: 'Ни один лист не распознан — результатов нет',
  ready: '',
};

const DOG_SIZE_LABEL = { small: 'мелкая', large: 'крупная' } as const;

/** Print version caption: case, species, calibration, number of sheets, recording date. */
function printHeaderText(c: CaseState): string {
  const s = c.settings;
  const size = s.species === 'dog' && s.dogSize ? `, ${DOG_SIZE_LABEL[s.dogSize]}` : '';
  const pages = c.result?.analyzed?.length ?? c.result?.perPage.length ?? 0;
  const date = c.result?.perPage.map((p) => p.meta?.headerDate).find((d) => !!d);
  const parts = [
    `VetECG 2 — ${c.title}: ${SPECIES_LABEL[s.species]}${size}`,
    `калибровка ${s.calib.mmPerS} мм/с, ${s.calib.mmPerMv} мм/мВ`,
    `листов учтено: ${pages}`,
  ];
  if (date) parts.push(`дата записи ${date}`);
  parts.push(`напечатано ${new Date().toLocaleString('ru-RU')}`);
  return parts.join('; ');
}

/**
 * Sheet aspect ratio for print (`print.css`, `--sheet-aspect` variable): from the first overlay canvas in `#sheet`
 * (task 11; read only, never changed), otherwise the variant A default stays. Updated on re-render and before printing.
 */
function updateSheetAspect(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#sheet canvas');
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    document.documentElement.style.setProperty('--sheet-aspect', `${canvas.width} / ${canvas.height}`);
  }
}

function renderRow(row: ResultRow): HTMLTableRowElement {
  const verdict = verdictText(row);
  return h(
    'tr',
    { 'data-key': row.key, 'data-tone': row.tone },
    h('th', { class: 'font-medium whitespace-nowrap' }, row.label),
    h('td', { class: TONE_VALUE_CLASS[row.tone] }, row.value),
    h('td', { class: 'opacity-80' }, row.norm),
    h('td', {}, verdict ? h('span', { class: `badge badge-sm ${TONE_BADGE[row.tone]}` }, verdict) : ''),
    h('td', { class: 'text-xs opacity-80' }, row.note),
  );
}

export { writeClipboard, manualCopyMessage, type ClipboardOutcome } from './clipboard';

export function mountResults(host: HTMLElement): void {
  host.dataset.module = 'results';
  const store = getCaseStore();

  const copied = h('span', { class: 'badge badge-success badge-sm hidden', 'data-testid': 'copied' }, 'скопировано');
  const copyBtn = h('button', { class: 'btn btn-sm btn-primary', type: 'button', 'data-testid': 'copy' }, 'Скопировать');
  const printBtn = h('button', { class: 'btn btn-sm btn-outline', type: 'button', 'data-testid': 'print' }, 'Печать');
  const placeholder = h('p', { class: 'text-sm opacity-70', 'data-testid': 'results-placeholder' });
  const tbody = h('tbody');
  const table = h(
    'table',
    { class: 'table table-sm results-table', 'data-testid': 'results-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Параметр'), h('th', {}, 'Значение'), h('th', {}, 'Норма'), h('th', {}, 'Оценка'), h('th', {}, 'Примечание'))),
    tbody,
  );
  const tableWrap = h('div', { class: 'overflow-x-auto' }, table);
  const notes = h('ul', { class: 'text-xs flex flex-col gap-1 list-disc pl-5', 'data-testid': 'results-notes' });
  const conclusionTitle = h('h3', { class: 'font-semibold text-sm mt-2' }, 'Заключение');
  const conclusion = h('div', { class: 'text-sm flex flex-col gap-1', 'data-testid': 'conclusion' });
  const printHeader = h('div', { class: 'print-only text-sm mb-2', 'data-testid': 'print-header' });

  const dialogText = h('textarea', {
    class: 'textarea textarea-bordered w-full h-64 font-mono text-xs',
    readonly: true,
    'data-testid': 'copy-dialog-text',
  });
  const dialogReason = h('p', { class: 'text-sm mb-2', 'data-testid': 'copy-dialog-reason' });
  const dialogClose = h('button', { class: 'btn btn-sm', type: 'button', 'data-testid': 'copy-dialog-close' }, 'Закрыть');
  const dialog = h(
    'dialog',
    { class: 'modal', 'data-testid': 'copy-dialog' },
    h(
      'div',
      { class: 'modal-box max-w-3xl' },
      h('h3', { class: 'font-semibold mb-2' }, 'Скопируйте текст вручную'),
      dialogReason,
      dialogText,
      h('div', { class: 'modal-action' }, dialogClose),
    ),
  );

  host.replaceChildren(
    h(
      'section',
      { class: 'card bg-base-100 border border-base-300 results', 'data-testid': 'results' },
      h(
        'div',
        { class: 'card-body gap-3 p-4' },
        h(
          'div',
          { class: 'flex items-center gap-2 flex-wrap no-print' },
          h('h2', { class: 'card-title text-base' }, 'Результаты'),
          copied,
          h('div', { class: 'ml-auto flex gap-2' }, copyBtn, printBtn),
        ),
        printHeader,
        placeholder,
        tableWrap,
        notes,
        conclusionTitle,
        conclusion,
      ),
      dialog,
    ),
  );

  let view: ResultsView = buildResultsView(activeCase(store.getState()));
  let copiedTimer: number | undefined;

  const showCopied = (): void => {
    copied.classList.remove('hidden');
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => copied.classList.add('hidden'), 2500);
  };

  const openDialog = (text: string, outcome: Exclude<ClipboardOutcome, 'copied'>): void => {
    dialogReason.textContent = manualCopyMessage(outcome);
    dialogText.value = text;
    if (!dialog.open) dialog.showModal();
    dialogText.focus();
    dialogText.select();
  };

  const copy = async (): Promise<void> => {
    if (view.status !== 'ready') return;
    const text = toClipboardText(view);
    const outcome = await writeClipboard(text);
    if (outcome === 'copied') showCopied();
    else openDialog(text, outcome);
  };

  copyBtn.addEventListener('click', () => void copy());
  dialogClose.addEventListener('click', () => dialog.close());
  printBtn.addEventListener('click', () => window.print());
  window.addEventListener('beforeprint', updateSheetAspect);

  const render = (state: AppState): void => {
    const c = activeCase(state);
    view = buildResultsView(c);
    const ready = view.status === 'ready';
    host.classList.toggle('hidden', view.status === 'empty');
    copyBtn.disabled = !ready;
    printBtn.disabled = !ready;
    placeholder.textContent = PLACEHOLDER[view.status];
    placeholder.classList.toggle('hidden', ready);
    for (const el of [tableWrap, notes, conclusionTitle, conclusion, printHeader]) el.classList.toggle('hidden', !ready);
    if (!ready) return;
    tbody.replaceChildren(...view.rows.map(renderRow), ...view.extra.map(renderRow));
    notes.replaceChildren(...view.notes.map((text) => h('li', {}, text)));
    notes.classList.toggle('hidden', view.notes.length === 0);
    const lines = view.text.split('\n');
    conclusion.replaceChildren(
      ...lines.map((line, i) => {
        const last = i === lines.length - 1;
        const cls = last ? 'font-semibold' : view.impossible && i === 0 ? 'text-warning font-semibold' : '';
        return h('p', { class: cls, 'data-testid': last ? 'verification' : undefined }, line);
      }),
    );
    printHeader.textContent = printHeaderText(c);
    updateSheetAspect();
  };

  store.subscribe(render);
  render(store.getState());
}
