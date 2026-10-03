/**
 * JPEG decoding into `GrayImage` for Node and tests (via `jpeg-js`).
 * Not re-exported from `./index.ts`: in the browser images are decoded by canvas, not by this module,
 * and the `jpeg-js` dev dependency must not end up in the bundle.
 */
import { decode } from 'jpeg-js';
import type { GrayImage } from '../../types/contracts';
import { rgbaToGray } from './gray';

export function fromJpeg(bytes: Uint8Array): GrayImage {
  const { width, height, data } = decode(bytes, { useTArray: true, formatAsRGBA: true });
  return { width, height, data: rgbaToGray(data, width, height) };
}
