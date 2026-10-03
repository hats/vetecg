import { afterEach, describe, expect, it, vi } from 'vitest';
import { manualCopyMessage, writeClipboard, type ClipboardOutcome } from './clipboard';

/** Outcome of a failed write — for the dialog text; "copied" here means the test fails. */
function failure(outcome: ClipboardOutcome): Exclude<ClipboardOutcome, 'copied'> {
  if (outcome === 'copied') throw new Error('ожидался отказ, а текст записан');
  return outcome;
}

// Manual-copy dialog (story 71, "Failure" elaboration): the "not HTTPS and not localhost" reason is named only
// when it is established (`!window.isSecureContext`); a browser refusal on a secure page gets a neutral text.

function stubBrowser(isSecureContext: boolean, writeText?: (text: string) => Promise<void>): void {
  vi.stubGlobal('window', { isSecureContext });
  vi.stubGlobal('navigator', writeText ? { clipboard: { writeText } } : {});
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('clipboard — outcome and manual-copy dialog text', () => {
  it('secure page, write succeeded — "copied", no dialog', async () => {
    const writeText = vi.fn(async () => {});
    stubBrowser(true, writeText);
    expect(await writeClipboard('текст')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('текст');
  });

  it('page not over HTTPS and not on localhost — the dialog names this reason', async () => {
    stubBrowser(false, vi.fn(async () => {}));
    const outcome = await writeClipboard('текст');
    expect(outcome).toBe('insecure');
    expect(manualCopyMessage(failure(outcome))).toContain('страница открыта не по HTTPS и не с localhost');
  });

  it('secure page, browser refused (exception) — neutral text with no mention of HTTPS', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubBrowser(true, vi.fn(async () => Promise.reject(new Error('NotAllowedError'))));
    const outcome = await writeClipboard('текст');
    expect(outcome).toBe('denied');
    const message = manualCopyMessage(failure(outcome));
    expect(message).toMatch(/браузер не дал доступ к буферу обмена — скопируйте текст вручную/i);
    expect(message).not.toMatch(/HTTPS|localhost/);
  });

  it('secure page without the clipboard API — neutral text as well', async () => {
    stubBrowser(true);
    const outcome = await writeClipboard('текст');
    expect(outcome).toBe('denied');
    expect(manualCopyMessage(failure(outcome))).not.toMatch(/HTTPS|localhost/);
  });
});
