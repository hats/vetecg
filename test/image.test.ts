import { describe, expect, it } from 'vitest';
import { fromImageData } from '../src/core/image';

describe('image.fromImageData', () => {
  it('neutral gray RGBA yields the same luminance, dimensions are preserved', () => {
    // Any luminance formula must return exactly v for R=G=B=v — an invariant independent of the coefficients.
    const levels = [0, 255, 200, 37];
    const rgba = new Uint8ClampedArray(levels.flatMap((v) => [v, v, v, 255]));

    const gray = fromImageData({ width: 2, height: 2, data: rgba });

    expect(gray.width).toBe(2);
    expect(gray.height).toBe(2);
    expect(Array.from(gray.data)).toEqual(levels);
  });
});
