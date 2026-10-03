import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageWorkerClient } from '../src/app/worker/client';
import type { WorkerResponse } from '../src/app/worker/protocol';
import { createGrayImage } from '../src/core/image';
import type { PageResult } from '../src/types/contracts';

/** `Worker` stub for Node: records posted messages; replies and errors are triggered by the test. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: { id: number }[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: { id: number }): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const sentinel = { issues: ['sentinel'] } as unknown as PageResult;

describe('worker client (Worker stubbed)', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('analyze sends a request and receives the result by its id', async () => {
    const client = createPageWorkerClient();
    const worker = FakeWorker.instances[0];

    const promise = client.analyze(createGrayImage(2, 2));
    expect(worker.posted).toHaveLength(1);
    worker.reply({ type: 'pageResult', id: worker.posted[0].id, result: sentinel });

    await expect(promise).resolves.toBe(sentinel);
  });

  it('after terminate analyze rejects immediately instead of hanging; pending requests are rejected too', async () => {
    const client = createPageWorkerClient();
    const worker = FakeWorker.instances[0];
    const pendingBefore = client.analyze(createGrayImage(2, 2));

    client.terminate();

    expect(worker.terminated).toBe(true);
    await expect(pendingBefore).rejects.toThrow();
    await expect(client.analyze(createGrayImage(2, 2))).rejects.toThrow();
    expect(worker.posted).toHaveLength(1);
  }, 1000);

  it('a pageError response rejects the request with the worker message', async () => {
    const client = createPageWorkerClient();
    const worker = FakeWorker.instances[0];

    const promise = client.analyze(createGrayImage(2, 2));
    worker.reply({ type: 'pageError', id: worker.posted[0].id, message: 'Неизвестный тип запроса: x' });

    await expect(promise).rejects.toThrow('Неизвестный тип запроса: x');
  });

  it('an error of the worker itself rejects all pending requests', async () => {
    const client = createPageWorkerClient();
    const worker = FakeWorker.instances[0];

    const a = client.analyze(createGrayImage(2, 2));
    const b = client.analyze(createGrayImage(2, 2));
    worker.fail('Воркер упал');

    await expect(a).rejects.toThrow('Воркер упал');
    await expect(b).rejects.toThrow('Воркер упал');
  });
});
