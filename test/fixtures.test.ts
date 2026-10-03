import { describe, expect, it } from 'vitest';
import { listFixtures, loadFixture } from './fixtures';

const fixtures = listFixtures();

describe('polyspectrum fixtures', () => {
  it('all 10 sheets are listed: a-01…a-08 (1280×905) and b-01, b-02 (1280×883)', () => {
    expect(fixtures.map((f) => f.name)).toEqual([
      'a-01', 'a-02', 'a-03', 'a-04', 'a-05', 'a-06', 'a-07', 'a-08', 'b-01', 'b-02',
    ]);
    expect(fixtures.filter((f) => f.expected.variant === 'A')).toHaveLength(8);
    expect(fixtures.filter((f) => f.expected.variant === 'B')).toHaveLength(2);
  });

  describe.each(fixtures)('$name', (fixture) => {
    it('decodes into a GrayImage of the expected size', () => {
      const image = loadFixture(fixture);

      expect([image.width, image.height]).toEqual(fixture.expected.size);
      expect(image.data).toBeInstanceOf(Uint8Array);
      expect(image.data.length).toBe(image.width * image.height);
    });

    it('share of white pixels is above 70 %', () => {
      // White means luminance ≥ 236: above the upper bound of grid dots (180–235 per spike-results.md).
      const WHITE = 236;
      const image = loadFixture(fixture);

      let white = 0;
      for (const value of image.data) if (value >= WHITE) white++;
      const fraction = white / image.data.length;

      expect(fraction).toBeGreaterThan(0.7);
    });
  });
});
