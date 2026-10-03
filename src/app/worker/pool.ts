/**
 * Recognition worker pool (decisions §1, story 30): up to `size` workers (default 3), a sheet queue,
 * a failed sheet is retried at most `maxRetries` times (default 2 — three attempts total), then the sheet is rejected
 * with `PageAnalysisFailed` (the UI shows «ошибка распознавания, лист пропущен» — recognition error, sheet skipped).
 *
 * A sheet failure is one rule: the client rejected the request (the worker crashed or replied `pageError`) **or** the
 * result carries the root cause `exception:*` in `issues` (a step exception inside `analyzePage` or `exception:worker`).
 * A crashed worker is stopped and replaced by a new client; a worker that returned a result stays in the pool.
 *
 * The worker gets a copy of the sheet `data`: the protocol transfers the buffer, and the app still needs the original
 * image (`analyzeCase(…, {images})` for separators, the overlay, sheet retry).
 */
import type { GrayImage, PageOptions, PageResult } from '../../types/contracts';
import { createPageWorkerClient, type PageWorkerClient } from './client';

export const DEFAULT_POOL_SIZE = 3;
export const DEFAULT_MAX_RETRIES = 2;

export interface WorkerPoolOptions {
  /** Number of workers, default 3. */
  size?: number;
  /** How many times to retry a failed sheet, default 2. */
  maxRetries?: number;
  /** Client factory (tests inject a fake). */
  createClient?: () => PageWorkerClient;
  /** Result is treated as a sheet failure and retried; default: has an `exception:*` issue. */
  isFailure?: (result: PageResult) => boolean;
}

export interface AnalyzeEvents {
  /** Start of attempt `attempt` (1…maxRetries + 1): the sheet was sent to a worker. */
  onAttempt?(attempt: number): void;
}

/** Sheet not recognized after all attempts; `lastResult` is the last result with `exception:*`, if the worker replied. */
export class PageAnalysisFailed extends Error {
  readonly attempts: number;
  readonly lastResult?: PageResult;

  constructor(message: string, attempts: number, lastResult?: PageResult) {
    super(message);
    this.name = 'PageAnalysisFailed';
    this.attempts = attempts;
    this.lastResult = lastResult;
  }
}

export interface WorkerPool {
  readonly size: number;
  /** Queues a sheet and awaits the result; `image` stays intact (the worker gets a copy). */
  analyze(image: GrayImage, options?: PageOptions, events?: AnalyzeEvents): Promise<PageResult>;
  /** Sheets queued and in progress. */
  pending(): number;
  /** Stops all workers; queued and in-progress work is rejected. */
  terminate(): void;
}

interface Job {
  image: GrayImage;
  options?: PageOptions;
  events?: AnalyzeEvents;
  attempt: number;
  resolve(result: PageResult): void;
  reject(error: PageAnalysisFailed): void;
}

const TERMINATED_MESSAGE = 'Пул воркеров остановлен';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const defaultIsFailure = (result: PageResult): boolean => result.issues.some((code) => code.startsWith('exception:'));

export function createWorkerPool(options: WorkerPoolOptions = {}): WorkerPool {
  const size = Math.max(1, options.size ?? DEFAULT_POOL_SIZE);
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const createClient = options.createClient ?? createPageWorkerClient;
  const isFailure = options.isFailure ?? defaultIsFailure;

  const clients = new Set<PageWorkerClient>();
  const idle: PageWorkerClient[] = [];
  const queue: Job[] = [];
  let active = 0;
  let terminated = false;

  const spawn = (): PageWorkerClient => {
    const client = createClient();
    clients.add(client);
    return client;
  };

  const pump = (): void => {
    if (terminated) return;
    while (queue.length > 0 && (idle.length > 0 || clients.size < size)) {
      const client = idle.pop() ?? spawn();
      void run(client, queue.shift() as Job);
    }
  };

  async function run(client: PageWorkerClient, job: Job): Promise<void> {
    active++;
    job.attempt++;
    job.events?.onAttempt?.(job.attempt);
    const copy: GrayImage = { width: job.image.width, height: job.image.height, data: job.image.data.slice() };
    let result: PageResult | undefined;
    let failure: string | undefined;
    let broken = false;
    try {
      result = await client.analyze(copy, job.options);
      if (isFailure(result)) failure = result.issues.find((code) => code.startsWith('exception:')) ?? 'exception';
    } catch (error: unknown) {
      failure = messageOf(error);
      broken = true;
    }
    active--;
    if (terminated) {
      job.reject(new PageAnalysisFailed(TERMINATED_MESSAGE, job.attempt, result));
      return;
    }
    if (broken) {
      clients.delete(client);
      client.terminate();
    } else idle.push(client);

    if (failure === undefined && result) job.resolve(result);
    else if (job.attempt <= maxRetries) {
      console.warn(`Лист не распознан (попытка ${job.attempt}): ${failure}. Повтор.`);
      queue.unshift(job);
    } else job.reject(new PageAnalysisFailed(failure ?? 'ошибка распознавания', job.attempt, result));
    pump();
  }

  return {
    size,
    analyze(image, options, events) {
      if (terminated) return Promise.reject(new PageAnalysisFailed(TERMINATED_MESSAGE, 0));
      return new Promise<PageResult>((resolve, reject) => {
        queue.push({ image, options, events, attempt: 0, resolve, reject });
        pump();
      });
    },
    pending: () => queue.length + active,
    terminate() {
      if (terminated) return;
      terminated = true;
      for (const job of queue.splice(0)) job.reject(new PageAnalysisFailed(TERMINATED_MESSAGE, job.attempt));
      for (const client of clients) client.terminate();
      clients.clear();
      idle.length = 0;
    },
  };
}
