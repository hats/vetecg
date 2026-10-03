/**
 * VetECG 2 application entry point: recognition worker pool (`analyzePage` in a worker), case store,
 * screen shell, mount points for the overlay (`app/overlay`) and results (`app/results`).
 * Submodules get state via `getCaseStore()` from `./state/case-store`; for debugging the store is exposed as
 * `window.vetecg.store`.
 */
import './style.css';
import { loadExampleFile } from './example';
import { browserSupported, prepareFile } from './files/decode';
import { mountOverlay } from './overlay';
import { mountResults } from './results';
import { initCaseStore, type CaseStore } from './state/case-store';
import { mountApp } from './ui/app-shell';
import { createWorkerPool } from './worker/pool';

declare global {
  interface Window {
    vetecg?: { store: CaseStore };
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Нет элемента #app');

if (!browserSupported()) {
  app.textContent = 'Нужен современный браузер (Chrome, Safari 16.4+, Firefox)';
} else {
  const pool = createWorkerPool();
  const store = initCaseStore({
    analyzeSheet: (image, options, events) => pool.analyze(image, options, events),
    revokeUrl: (url) => URL.revokeObjectURL(url),
  });
  window.vetecg = { store };

  const shell = mountApp(app, store, { prepareFile, loadExample: loadExampleFile });
  mountOverlay(shell.sheetHost);
  mountResults(shell.resultsHost);
}
