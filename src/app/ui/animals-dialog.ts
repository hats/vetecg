/**
 * "Different animals" dialog (story 7): list of sheet groups and three actions — «Разделить на отдельные случаи»
 * (split into separate cases), «Убрать лишние» (remove the extra ones), «Анализировать вместе всё равно» (analyze together
 * anyway); «Решить позже» (decide later) postpones the choice (the main group is analyzed).
 */
import { plural } from '../../analysis/conclusion';
import { activeCase, type AnimalsDecision, type AppState, type CaseStore } from '../state/case-store';
import { h } from './dom';

export function mountAnimalsDialog(store: CaseStore): HTMLDialogElement {
  // The group list scrolls inside the window: with many sheets the action buttons stay visible without scrolling the modal.
  const list = h('div', { class: 'flex flex-col gap-3 max-h-[45vh] overflow-y-auto pr-1', 'data-testid': 'animals-groups' });
  const summary = h('p', { class: 'text-sm' });
  const button = (label: string, decision: AnimalsDecision, cls: string, testId: string): HTMLButtonElement => {
    const el = h('button', { class: `btn btn-sm ${cls}`, type: 'button', 'data-testid': testId }, label);
    el.addEventListener('click', () => store.resolveAnimals(decision));
    return el;
  };
  const dialog = h(
    'dialog',
    { id: 'animals-dialog', class: 'modal' },
    h(
      'div',
      { class: 'modal-box max-w-2xl flex flex-col gap-4' },
      h('h3', { class: 'text-lg font-semibold' }, 'На листах — разные животные'),
      summary,
      list,
      h(
        'div',
        { class: 'flex flex-wrap gap-2 justify-end' },
        button('Решить позже', 'dismiss', 'btn-ghost', 'animals-dismiss'),
        button('Разделить на отдельные случаи', 'split', 'btn-outline', 'animals-split'),
        button('Убрать лишние', 'remove', 'btn-outline', 'animals-remove'),
        button('Анализировать вместе всё равно', 'together', 'btn-primary', 'animals-together'),
      ),
    ),
  );
  // Esc closes the <dialog> by itself — treat it as "decide later".
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    store.resolveAnimals('dismiss');
  });

  const update = (state: AppState): void => {
    const c = activeCase(state);
    if (!c.dialog) {
      if (dialog.open) dialog.close();
      return;
    }
    const groups = c.dialog.groups;
    summary.textContent = `Листы разделились на ${groups.length} ${plural(groups.length, ['группу', 'группы', 'групп'])} по шапке (кличка и дата). Главная группа — первая; листы остальных групп отличаются. Что делать?`;
    list.replaceChildren(
      ...groups.map((ids, k) =>
        h(
          'div',
          { class: 'flex flex-col gap-1' },
          h('div', { class: 'text-xs font-semibold' }, k === 0 ? 'Главная группа' : `Отличающиеся листы (группа ${k + 1})`),
          h(
            'div',
            { class: 'flex flex-wrap gap-2' },
            ...ids.map((id) => {
              const sheet = c.sheets.find((s) => s.id === id);
              return h(
                'div',
                { class: 'flex items-center gap-2 border border-base-300 rounded-box p-1 pr-2' },
                sheet?.thumbnailUrl ? h('img', { src: sheet.thumbnailUrl, alt: '', class: 'h-10 rounded' }) : null,
                h('span', { class: 'text-xs' }, sheet?.name ?? id),
              );
            }),
          ),
        ),
      ),
    );
    if (!dialog.open) dialog.showModal();
  };

  store.subscribe(update);
  return dialog;
}
