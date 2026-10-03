/**
 * File classification before recognition (story 2, «Неверный ввод» (invalid input) elaboration): JPEG/PNG — by byte
 * signature (the browser does not always fill MIME and extension), PDF — by the `%PDF` signature, MIME or extension;
 * anything else is «не изображение» (not an image). Per-file error texts live here too, in Russian. Pure functions,
 * tested in Node.
 */
export type FileKind = 'jpeg' | 'png' | 'pdf' | 'unknown';

export interface FileInfo {
  name: string;
  type: string;
  /** First bytes of the file (8 are enough). */
  head: Uint8Array;
}

/** Minimum sheet width, px: the device exports 1280 px; below 800 px the grid and digits are unreadable (story 2). */
export const MIN_SHEET_WIDTH = 800;

export type FileProblem =
  | { kind: 'not_image' }
  | { kind: 'pdf' }
  | { kind: 'corrupt' }
  | { kind: 'too_narrow'; width: number }
  /** The file could not be read (browser refused the read, file vanished) — only it errors, the rest proceed. */
  | { kind: 'unreadable' };

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // «%PDF»

const startsWith = (head: Uint8Array, magic: readonly number[]): boolean =>
  head.length >= magic.length && magic.every((byte, i) => head[i] === byte);

export function classifyFile(info: FileInfo): FileKind {
  if (startsWith(info.head, PDF_MAGIC) || info.type === 'application/pdf' || /\.pdf$/i.test(info.name)) return 'pdf';
  if (startsWith(info.head, JPEG_MAGIC)) return 'jpeg';
  if (startsWith(info.head, PNG_MAGIC)) return 'png';
  return 'unknown';
}

export function fileProblemMessage(problem: FileProblem): string {
  switch (problem.kind) {
    case 'not_image':
      return 'Это не изображение — нужен JPEG или PNG';
    case 'pdf':
      return 'В этой версии PDF не поддерживается — сохраните лист как изображение (JPEG или PNG)';
    case 'corrupt':
      return 'Файл повреждён или не читается как изображение';
    case 'too_narrow':
      return `Изображение слишком маленькое: ширина ${problem.width} px, нужно не меньше ${MIN_SHEET_WIDTH} px`;
    case 'unreadable':
      return 'Файл не удалось прочитать — выберите его снова';
  }
}
