/** Web Worker entry point: receives a sheet, replies with `PageResult` per the `./protocol.ts` protocol. */
import { analyzePage } from '../../core/page';
import { POLYSPECTRUM } from '../../core/profile';
import { handleRequest, type PageAnalyzer, type WorkerRequest, type WorkerResponse } from './protocol';

/**
 * Own worker scope declaration instead of `/// <reference lib="webworker" />`: `tsconfig` sets `lib: DOM`
 * (the main thread is in the same project), and the `DOM` and `WebWorker` libs declare conflicting globals.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const scope = self as unknown as WorkerScope;
const analyze: PageAnalyzer = (image, options) => analyzePage(image, POLYSPECTRUM, options);

scope.onmessage = (event) => {
  scope.postMessage(handleRequest(event.data, analyze));
};
