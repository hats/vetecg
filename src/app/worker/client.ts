/**
 * Main-thread client of the recognition worker: one worker, requests by id. The pool of up to 3 workers is `./pool.ts`.
 * The exception text from a response (`PageResultResponse.error`) goes to the console — diagnostics, never an issue code.
 */
import type { GrayImage, PageOptions, PageResult } from '../../types/contracts';
import { buildAnalyzeRequest, type WorkerResponse } from './protocol';

export interface PageWorkerClient {
  /**
   * Sends a sheet to the worker (the buffer is transferred, `image.data` on the main thread becomes empty — whoever keeps
   * the sheet sends a copy) and awaits `PageResult`. After `terminate()` it rejects immediately — no hang on a stopped worker.
   */
  analyze(image: GrayImage, options?: PageOptions): Promise<PageResult>;
  /** Stops the worker; all pending requests are rejected. */
  terminate(): void;
}

interface Pending {
  resolve(result: PageResult): void;
  reject(error: Error): void;
}

const TERMINATED_MESSAGE = 'Клиент воркера остановлен';

export function createPageWorkerClient(): PageWorkerClient {
  const worker = new Worker(new URL('./page-worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let terminated = false;

  const rejectAll = (error: Error): void => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.type === 'pageResult') {
      if (response.error) console.error('Исключение в распознавании листа:', response.error);
      waiter.resolve(response.result);
    } else waiter.reject(new Error(response.message));
  };

  worker.onerror = (event: ErrorEvent) => {
    rejectAll(new Error(event.message || 'Ошибка воркера'));
  };

  return {
    analyze(image, options) {
      if (terminated) return Promise.reject(new Error(TERMINATED_MESSAGE));
      const { message, transfer } = buildAnalyzeRequest(nextId++, image, options);
      return new Promise<PageResult>((resolve, reject) => {
        pending.set(message.id, { resolve, reject });
        worker.postMessage(message, transfer);
      });
    },
    terminate() {
      if (terminated) return;
      terminated = true;
      worker.terminate();
      rejectAll(new Error(TERMINATED_MESSAGE));
    },
  };
}
