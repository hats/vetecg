import { describe, expect, it } from 'vitest';
import type { PageWorkerClient } from '../src/app/worker/client';
import { createWorkerPool, PageAnalysisFailed } from '../src/app/worker/pool';
import { placeholderPageResult } from '../src/app/worker/protocol';
import { createGrayImage } from '../src/core/image';
import type { GrayImage, PageOptions, PageResult } from '../src/types/contracts';

interface Inflight {
  client: FakeClient;
  image: GrayImage;
  options?: PageOptions;
  resolve(result: PageResult): void;
  reject(error: Error): void;
}

interface FakeClient extends PageWorkerClient {
  terminated: boolean;
}

/** Fake client factory: each request waits for the test to settle it in `inflight`. */
function fakeFactory() {
  const inflight: Inflight[] = [];
  const clients: FakeClient[] = [];
  const createClient = (): PageWorkerClient => {
    const client: FakeClient = {
      terminated: false,
      analyze(image, options) {
        return new Promise<PageResult>((resolve, reject) => {
          inflight.push({ client, image, options, resolve, reject });
        });
      },
      terminate() {
        client.terminated = true;
      },
    };
    clients.push(client);
    return client;
  };
  return { inflight, clients, createClient };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const okResult = () => placeholderPageResult([]);
const brokenResult = () => placeholderPageResult(['exception:layout:boom']);

describe('recognition worker pool', () => {
  it('at most size sheets and at most size clients in flight at once; the queue advances as responses arrive', async () => {
    const { inflight, clients, createClient } = fakeFactory();
    const pool = createWorkerPool({ size: 3, createClient });

    const jobs = Array.from({ length: 5 }, () => pool.analyze(createGrayImage(2, 2)));
    await tick();
    expect(inflight).toHaveLength(3);
    expect(clients).toHaveLength(3);
    expect(pool.pending()).toBe(5);

    inflight[0].resolve(okResult());
    await tick();
    expect(inflight).toHaveLength(4);
    expect(clients).toHaveLength(3);

    for (const job of inflight.slice(1)) job.resolve(okResult());
    await tick();
    expect(inflight).toHaveLength(5);
    inflight[4].resolve(okResult());
    await Promise.all(jobs);
    expect(pool.pending()).toBe(0);
    pool.terminate();
  });

  it('the worker receives a copy of the sheet: the original buffer stays with the app', async () => {
    const { inflight, createClient } = fakeFactory();
    const pool = createWorkerPool({ size: 1, createClient });
    const image = createGrayImage(3, 2, 7);
    image.data[4] = 42;

    const job = pool.analyze(image, { calib: { mmPerS: 25, mmPerMv: 10 } });
    await tick();
    expect(inflight[0].image.data.buffer).not.toBe(image.data.buffer);
    expect(Array.from(inflight[0].image.data)).toEqual(Array.from(image.data));
    expect(inflight[0].options).toEqual({ calib: { mmPerS: 25, mmPerMv: 10 } });

    inflight[0].resolve(okResult());
    await job;
    expect(image.data.length).toBe(6);
    pool.terminate();
  });

  it('result with exception:* — sheet failure: retry; second attempt succeeds → its result, attempts 1 and 2', async () => {
    const { inflight, createClient } = fakeFactory();
    const pool = createWorkerPool({ size: 1, createClient });
    const attempts: number[] = [];

    const job = pool.analyze(createGrayImage(2, 2), undefined, { onAttempt: (k) => attempts.push(k) });
    await tick();
    inflight[0].resolve(brokenResult());
    await tick();
    expect(inflight).toHaveLength(2);
    const good = okResult();
    inflight[1].resolve(good);

    await expect(job).resolves.toBe(good);
    expect(attempts).toEqual([1, 2]);
    pool.terminate();
  });

  it('a crashed worker is replaced by a new client; after two retries the sheet is rejected with PageAnalysisFailed and three attempts', async () => {
    const { inflight, clients, createClient } = fakeFactory();
    const pool = createWorkerPool({ size: 1, maxRetries: 2, createClient });

    const job = pool.analyze(createGrayImage(2, 2));
    for (let k = 0; k < 3; k++) {
      await tick();
      expect(inflight).toHaveLength(k + 1);
      inflight[k].reject(new Error('Воркер упал'));
    }

    const error = await job.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PageAnalysisFailed);
    expect((error as PageAnalysisFailed).attempts).toBe(3);
    expect(clients).toHaveLength(3);
    expect(clients.slice(0, 3).every((c) => c.terminated)).toBe(true);
    pool.terminate();
  });

  it('deterministic failure (exception:* three times) → PageAnalysisFailed with the last result', async () => {
    const { inflight, createClient } = fakeFactory();
    const pool = createWorkerPool({ size: 2, createClient });

    const job = pool.analyze(createGrayImage(2, 2));
    for (let k = 0; k < 3; k++) {
      await tick();
      inflight[k].resolve(brokenResult());
    }

    const error = await job.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PageAnalysisFailed);
    expect((error as PageAnalysisFailed).lastResult?.issues).toEqual(['exception:layout:boom']);
    expect(inflight).toHaveLength(3);
    pool.terminate();
  });

  it('terminate stops the clients and rejects pending sheets', async () => {
    const { inflight, clients, createClient } = fakeFactory();
    const pool = createWorkerPool({ size: 1, createClient });

    const running = pool.analyze(createGrayImage(2, 2));
    const queued = pool.analyze(createGrayImage(2, 2));
    await tick();
    pool.terminate();

    expect(clients[0].terminated).toBe(true);
    await expect(queued).rejects.toThrow();
    inflight[0].reject(new Error('Клиент воркера остановлен'));
    await expect(running).rejects.toThrow();
    expect(pool.pending()).toBe(0);
  });
});
