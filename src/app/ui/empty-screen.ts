/** Empty state (story 4): one sentence about the purpose, drop zone, «Попробовать на примере» (try an example). */
import { h } from './dom';

export interface EmptyScreenActions {
  pickFiles(): void;
  tryExample(): void;
}

export function buildEmptyScreen(actions: EmptyScreenActions): HTMLElement {
  const pick = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'pick-files' }, 'Выбрать файлы');
  const example = h('button', { class: 'btn btn-outline', type: 'button', 'data-testid': 'try-example' }, 'Попробовать на примере');
  pick.addEventListener('click', () => actions.pickFiles());
  example.addEventListener('click', () => actions.tryExample());

  return h(
    'section',
    { id: 'empty', class: 'flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center' },
    h(
      'p',
      { class: 'max-w-2xl text-lg' },
      'VetECG 2 распознаёт листы ЭКГ собак и кошек из экспортов «Поли-Спектр.NET», измеряет интервалы и амплитуды и составляет заключение для проверки врачом.',
    ),
    h(
      'div',
      {
        id: 'drop-zone',
        class: 'w-full max-w-2xl rounded-box border-2 border-dashed border-base-300 bg-base-200/40 p-10 flex flex-col items-center gap-4',
      },
      h('p', { class: 'text-base-content/80' }, 'Перетащите сюда один или несколько листов (JPEG или PNG)'),
      h('div', { class: 'flex flex-wrap justify-center gap-3' }, pick, example),
    ),
  );
}
