/**
 * Case panel (stories 10–15, §5): species with a source tag, dog size, calibration with a tag, drugs, monitoring minutes
 * with the «по листам» (from sheets) tag, "analyze together", confidence and precision ceiling of the active sheet, case
 * warnings. The form is built once; on state changes only values are updated (the focused field is left untouched).
 */
import { DEFAULT_CALIBRATION, type Calibration, type DogSize, type Species } from '../../types/contracts';
import { activeCase, type AppState, type CaseStore } from '../state/case-store';
import { h, percent, SPECIES_LABEL } from './dom';

const SOURCE_LABEL = {
  manual: 'вручную',
  header: 'из шапки',
  footer: 'из футера',
  default: 'по умолчанию',
  pages: 'по листам',
} as const;

const formatNumber = (value: number, digits: number): string => value.toFixed(digits).replace(/\.?0+$/, '');

function select(options: readonly (readonly [string, string])[], testId: string): HTMLSelectElement {
  const el = h('select', { class: 'select select-sm w-full', 'data-testid': testId });
  for (const [value, label] of options) el.append(h('option', { value }, label));
  return el;
}

function badge(testId: string): HTMLSpanElement {
  return h('span', { class: 'badge badge-sm badge-ghost', 'data-testid': testId });
}

function field(label: string, control: HTMLElement, ...extra: (HTMLElement | null)[]): HTMLElement {
  return h(
    'label',
    { class: 'form-control w-full gap-1' },
    h('span', { class: 'label-text text-xs flex items-center gap-2' }, label, ...extra),
    control,
  );
}

const focused = (el: HTMLElement): boolean => document.activeElement === el;

export function mountCasePanel(host: HTMLElement, store: CaseStore): void {
  host.className = 'flex flex-col gap-3 min-w-0';

  const species = select(
    [
      ['dog', SPECIES_LABEL.dog],
      ['cat', SPECIES_LABEL.cat],
    ],
    'species',
  );
  const speciesSource = badge('species-source');
  const speciesAuto = h('button', { class: 'btn btn-ghost btn-xs', type: 'button' }, 'авто');
  const dogSize = select(
    [
      ['', 'не указан (нормы крупной собаки)'],
      ['small', 'мелкая'],
      ['large', 'крупная'],
    ],
    'dog-size',
  );
  const mmPerS = h('input', { class: 'input input-sm w-full', type: 'number', min: '1', step: '1', 'data-testid': 'mm-per-s' });
  const mmPerMv = h('input', { class: 'input input-sm w-full', type: 'number', min: '1', step: '1', 'data-testid': 'mm-per-mv' });
  const calibSource = badge('calib-source');
  const calibAuto = h('button', { class: 'btn btn-ghost btn-xs', type: 'button' }, 'авто');
  const drugs = h('input', { class: 'input input-sm w-full', type: 'text', placeholder: 'не указано', 'data-testid': 'drugs' });
  const minutes = h('input', { class: 'input input-sm w-full', type: 'number', min: '0', step: '0.1', 'data-testid': 'minutes' });
  const minutesSource = badge('minutes-source');
  const minutesAuto = h('button', { class: 'btn btn-ghost btn-xs', type: 'button' }, 'по листам');
  const together = h('input', { class: 'checkbox checkbox-sm', type: 'checkbox', 'data-testid': 'analyze-together' });
  const togetherRow = h('label', { class: 'flex items-center gap-2 text-sm hidden' }, together, 'Анализировать листы разных животных вместе');
  const sheetInfo = h('div', { class: 'text-xs flex flex-col gap-1', 'data-testid': 'sheet-info' });
  const warnings = h('div', { class: 'flex flex-col gap-2', 'data-testid': 'case-warnings' });
  const confidence = h('div', { class: 'text-sm', 'data-testid': 'case-confidence' });

  host.append(
    h('h2', { class: 'text-sm font-semibold' }, 'Случай'),
    warnings,
    field('Вид животного', species, speciesSource, speciesAuto),
    field('Размер собаки', dogSize),
    h(
      'div',
      { class: 'flex flex-col gap-1' },
      h('span', { class: 'label-text text-xs flex items-center gap-2' }, 'Калибровка', calibSource, calibAuto),
      h(
        'div',
        { class: 'grid grid-cols-2 gap-2' },
        h('label', { class: 'flex items-center gap-1 text-xs' }, mmPerS, 'мм/с'),
        h('label', { class: 'flex items-center gap-1 text-xs' }, mmPerMv, 'мм/мВ'),
      ),
    ),
    field('Препараты', drugs),
    field('Минуты мониторинга', minutes, minutesSource, minutesAuto),
    togetherRow,
    h('div', { class: 'divider my-1' }),
    confidence,
    sheetInfo,
  );

  species.addEventListener('change', () => store.setSpecies(species.value as Species));
  speciesAuto.addEventListener('click', () => store.setSpecies(null));
  dogSize.addEventListener('change', () => store.setDogSize(dogSize.value === '' ? undefined : (dogSize.value as DogSize)));
  const applyCalibration = (): void => {
    const calib: Calibration = { mmPerS: Number(mmPerS.value), mmPerMv: Number(mmPerMv.value) };
    if (calib.mmPerS > 0 && calib.mmPerMv > 0) store.setCalibration(calib);
  };
  mmPerS.addEventListener('change', applyCalibration);
  mmPerMv.addEventListener('change', applyCalibration);
  calibAuto.addEventListener('click', () => store.setCalibration(null));
  drugs.addEventListener('change', () => store.setDrugs(drugs.value.trim()));
  minutes.addEventListener('change', () => {
    const value = Number(minutes.value.replace(',', '.'));
    store.setMonitoringMinutes(minutes.value.trim() === '' || !Number.isFinite(value) ? null : value);
  });
  minutesAuto.addEventListener('click', () => store.setMonitoringMinutes(null));
  together.addEventListener('change', () => store.setAnalyzeTogether(together.checked));

  const update = (state: AppState): void => {
    const c = activeCase(state);
    const s = c.settings;
    if (!focused(species)) species.value = s.species;
    speciesSource.textContent = SOURCE_LABEL[s.speciesSource];
    speciesAuto.classList.toggle('hidden', s.speciesSource !== 'manual');
    dogSize.disabled = s.species !== 'dog';
    if (!focused(dogSize)) dogSize.value = s.dogSize ?? '';
    const calib = s.calib ?? DEFAULT_CALIBRATION;
    if (!focused(mmPerS)) mmPerS.value = String(calib.mmPerS);
    if (!focused(mmPerMv)) mmPerMv.value = String(calib.mmPerMv);
    calibSource.textContent = SOURCE_LABEL[s.calibSource];
    calibAuto.classList.toggle('hidden', s.calibSource !== 'manual');
    if (!focused(drugs)) drugs.value = s.drugs;
    if (!focused(minutes)) minutes.value = s.monitoringMinutes === undefined ? '' : formatNumber(s.monitoringMinutes, 1);
    minutesSource.textContent = SOURCE_LABEL[s.minutesSource];
    minutesAuto.classList.toggle('hidden', s.minutesSource !== 'manual');
    const multiple = (c.result?.issues ?? []).includes('multiple_animals');
    togetherRow.classList.toggle('hidden', !multiple && !s.analyzeTogether);
    together.checked = s.analyzeTogether;

    warnings.replaceChildren(...c.warnings.map((text) => h('div', { class: 'alert alert-warning text-xs py-2 px-3', role: 'alert' }, text)));

    confidence.textContent = c.result ? `Уверенность случая: ${percent(c.result.confidence)}` : 'Случай ещё не рассчитан';

    const sheet = c.sheets.find((x) => x.id === c.activeSheetId);
    const index = sheet ? c.caseSheets.indexOf(sheet.id) : -1;
    const page = index >= 0 ? c.result?.perPage[index] : undefined;
    const rows: HTMLElement[] = [];
    if (sheet) {
      rows.push(h('div', { class: 'font-semibold truncate' }, `Лист: ${sheet.name}`));
      if (page) {
        rows.push(h('div', {}, `Уверенность листа: ${percent(page.confidence)}`));
        rows.push(h('div', {}, `Калибровка листа: ${page.calib.mmPerS} мм/с, ${page.calib.mmPerMv} мм/мВ (${SOURCE_LABEL[page.calibSource]})`));
        if (page.precision.mvPerPx > 0) {
          rows.push(
            h('div', {}, `Потолок точности: 1 px = ${formatNumber(page.precision.mvPerPx * 1000, 0)} мкВ, ${formatNumber(page.precision.msPerPx, 1)} мс`),
          );
        }
        if (page.meta.headerDate) rows.push(h('div', {}, `Дата записи: ${page.meta.headerDate}`));
        if (sheet.analysisMs !== undefined) {
          const queued = sheet.elapsedMs !== undefined ? ` (с ожиданием очереди ${formatNumber(sheet.elapsedMs / 1000, 1)} с)` : '';
          rows.push(h('div', { class: 'opacity-60' }, `Распознан за ${formatNumber(sheet.analysisMs / 1000, 1)} с${queued}`));
        }
      } else if (sheet.error) rows.push(h('div', { class: 'text-error' }, sheet.error));
    }
    sheetInfo.replaceChildren(...rows);
  };

  store.subscribe(update);
  update(store.getState());
}
