/**
 * Clipboard for «Скопировать» ("Copy") (story 71, "Failure" elaboration). The failure reason is named only when it
 * is established: "not HTTPS and not localhost" — only when `!window.isSecureContext`; a browser refusal, an exception
 * or a missing API on a secure page get a neutral text with no guessing about the cause.
 */

/** Write outcome: `copied` — written; `insecure` — page is not in a secure context; `denied` — browser refused access. */
export type ClipboardOutcome = 'copied' | 'insecure' | 'denied';

const SELECTED_HINT = 'Текст уже выделен — нажмите Ctrl+C (⌘C на Mac).';

const MANUAL_COPY_MESSAGE: Readonly<Record<Exclude<ClipboardOutcome, 'copied'>, string>> = {
  insecure: `Буфер обмена недоступен: страница открыта не по HTTPS и не с localhost. ${SELECTED_HINT}`,
  denied: `Браузер не дал доступ к буферу обмена — скопируйте текст вручную. ${SELECTED_HINT}`,
};

/** Writes text to the clipboard; a browser exception is not rethrown but becomes the `denied` outcome. */
export async function writeClipboard(text: string): Promise<ClipboardOutcome> {
  if (!window.isSecureContext) return 'insecure';
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') return 'denied';
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch (error: unknown) {
    console.warn('Браузер не дал доступ к буферу обмена, показываем текст для ручного копирования:', error instanceof Error ? error.message : error);
    return 'denied';
  }
}

/** Explanation in the manual-copy dialog for an outcome where the write failed. */
export function manualCopyMessage(outcome: Exclude<ClipboardOutcome, 'copied'>): string {
  return MANUAL_COPY_MESSAGE[outcome];
}
