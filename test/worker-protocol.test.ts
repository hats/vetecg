import { describe, expect, it } from 'vitest';
import { buildAnalyzeRequest, handleRequest, type WorkerRequest } from '../src/app/worker/protocol';
import { NotImplementedError } from '../src/core/errors';
import { createGrayImage } from '../src/core/image';
import type { PageResult } from '../src/types/contracts';

describe('worker protocol (smoke test without a browser)', () => {
  it('request carries the sheet, parameters and a transfer buffer', () => {
    const image = createGrayImage(4, 3);
    const calib = { mmPerS: 25, mmPerMv: 10 };

    const { message, transfer } = buildAnalyzeRequest(7, image, { calib });

    expect(message).toMatchObject({ type: 'analyzePage', id: 7, options: { calib } });
    expect(message.image).toBe(image);
    expect(transfer).toEqual([image.data.buffer]);
  });

  it('an analyzer exception becomes an issue of a placeholder result with the same id, not a crash', () => {
    const { message } = buildAnalyzeRequest(3, createGrayImage(4, 3));
    const analyze = () => {
      throw new NotImplementedError('page.analyzePage');
    };

    const response = handleRequest(message, analyze);

    expect(response.type).toBe('pageResult');
    expect(response.id).toBe(3);
    if (response.type !== 'pageResult') throw new Error('expected pageResult');
    expect(response.result.leads).toEqual([]);
    expect(response.result.signals).toEqual([]);
    expect(response.result.confidence).toBe(0);
    expect(response.result.calibSource).toBe('default');
    expect(response.result.issues).toContain('not_implemented:page.analyzePage');
    expect(response.result.meta.confidence).toBe(0);
    expect(response.result.meta.issues).toEqual([]);
  });

  it('analyzer result passes through with the same id', () => {
    const { message } = buildAnalyzeRequest(11, createGrayImage(2, 2));
    const sentinel = { issues: ['sentinel'] } as unknown as PageResult;

    const response = handleRequest(message, () => sentinel);

    expect(response).toEqual({ type: 'pageResult', id: 11, result: sentinel });
  });

  it('a plain exception gives the stable code exception:worker, and the exception text goes to the response error field', () => {
    const { message } = buildAnalyzeRequest(5, createGrayImage(2, 2));
    const analyze = () => {
      throw new Error('Cannot read properties of undefined');
    };

    const response = handleRequest(message, analyze);

    expect(response.type).toBe('pageResult');
    expect(response.id).toBe(5);
    if (response.type !== 'pageResult') throw new Error('expected pageResult');
    expect(response.result.issues).toEqual(['exception:worker']);
    expect(response.result.confidence).toBe(0);
    expect(response.error).toBe('Cannot read properties of undefined');
  });

  it('unknown request type with id → pageError with the same id', () => {
    const response = handleRequest({ type: 'x', id: 5 } as unknown as WorkerRequest, () => {
      throw new Error('analyzer must not be called');
    });

    expect(response.type).toBe('pageError');
    expect(response.id).toBe(5);
    if (response.type !== 'pageError') throw new Error('expected pageError');
    expect(response.message).toContain('x');
  });

  it('unknown request type without id → pageError with id −1', () => {
    const response = handleRequest({ type: 'x' } as unknown as WorkerRequest, () => {
      throw new Error('analyzer must not be called');
    });

    expect(response).toMatchObject({ type: 'pageError', id: -1 });
  });
});
