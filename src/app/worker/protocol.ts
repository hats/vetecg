/**
 * Message protocol between the main thread ↔ recognition worker. Pure functions without DOM:
 * building a request with transferable buffers and handling a request into a response. Tested in Node.
 */
import { DEFAULT_CALIBRATION, type GrayImage, type PageOptions, type PageResult } from '../../types/contracts';
import { isNotImplemented } from '../../core/errors';

export interface AnalyzePageRequest {
  type: 'analyzePage';
  id: number;
  image: GrayImage;
  options?: PageOptions;
}

export type WorkerRequest = AnalyzePageRequest;

export interface PageResultResponse {
  type: 'pageResult';
  id: number;
  result: PageResult;
  /**
   * Analyzer exception text (diagnostics for console/report) when the sheet was not parsed and `result.issues`
   * carries the stable code `exception:worker` or `not_implemented:<unit>`. The text never enters issue codes.
   */
  error?: string;
}

export interface PageErrorResponse {
  type: 'pageError';
  id: number;
  message: string;
}

export type WorkerResponse = PageResultResponse | PageErrorResponse;

/** Sheet analyzer; in the worker it is `analyzePage` with a profile, in tests a stub. */
export type PageAnalyzer = (image: GrayImage, options?: PageOptions) => PageResult;

/** Worker request and the list of buffers to transfer without copying. After sending, `image.data` on the main thread is empty. */
export function buildAnalyzeRequest(
  id: number,
  image: GrayImage,
  options?: PageOptions,
): { message: AnalyzePageRequest; transfer: ArrayBuffer[] } {
  const message: AnalyzePageRequest = { type: 'analyzePage', id, image };
  if (options) message.options = options;
  const buffer = image.data.buffer;
  const transfer = buffer instanceof ArrayBuffer ? [buffer] : [];
  return { message, transfer };
}

/** Stable issue code for an exception that escaped the analyzer past its own catch blocks. */
export const WORKER_EXCEPTION_ISSUE = 'exception:worker';

/**
 * Request handling in the worker: an analyzer exception does not crash the sheet but becomes an `issue` of a placeholder
 * result (stable code `exception:worker` / `not_implemented:<unit>`); the exception text goes to the response `error`.
 */
export function handleRequest(request: WorkerRequest, analyze: PageAnalyzer): WorkerResponse {
  switch (request.type) {
    case 'analyzePage':
      try {
        return { type: 'pageResult', id: request.id, result: analyze(request.image, request.options) };
      } catch (error: unknown) {
        return {
          type: 'pageResult',
          id: request.id,
          result: placeholderPageResult([issueFromError(error)]),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    default: {
      const unknown = request as { type?: unknown; id?: unknown };
      const id = typeof unknown.id === 'number' ? unknown.id : -1;
      return { type: 'pageError', id, message: `Неизвестный тип запроса: ${String(unknown.type)}` };
    }
  }
}

function issueFromError(error: unknown): string {
  if (isNotImplemented(error)) return `not_implemented:${error.unit}`;
  return WORKER_EXCEPTION_ISSUE;
}

/** Empty `PageResult` with zero confidence — the response when the sheet could not be parsed. */
export function placeholderPageResult(issues: string[]): PageResult {
  return {
    layout: {
      variant: 'A',
      frame: { x: 0, y: 0, width: 0, height: 0 },
      grid: { pxPerMmX: 0, pxPerMmY: 0, phaseX: 0, phaseY: 0, confidence: 0 },
      zones: {},
      expectedBaselines: [0, 0, 0, 0, 0, 0],
      confidence: 0,
      issues: [],
    },
    leads: [],
    signals: [],
    meta: {
      hrRow: [],
      timeLabels: [],
      leadLabels: [],
      headerNameCrop: { width: 0, height: 0, data: new Uint8Array(0) },
      confidence: 0,
      issues: [],
    },
    calib: { ...DEFAULT_CALIBRATION },
    calibSource: 'default',
    precision: { mvPerPx: 0, msPerPx: 0 },
    confidence: 0,
    issues: [...issues],
  };
}
