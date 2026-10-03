import { describe, expect, it } from 'vitest';
import { batchNotice } from './batch-notice';

// Large batch text (stories 1–5): does not promise an unconfirmed duration.

describe('large batch notice', () => {
  it('up to 30 sheets inclusive — no notice', () => {
    expect(batchNotice(1)).toBe('');
    expect(batchNotice(30)).toBe('');
  });

  it('more than 30 sheets — warning without promising a specific duration', () => {
    const text = batchNotice(31);
    expect(text).toContain('Листов больше 30');
    expect(text).toContain('займёт больше времени');
    expect(text).not.toMatch(/минут|секунд|час/);
  });
});
