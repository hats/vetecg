import { describe, expect, it } from 'vitest';
import { classifyFile, fileProblemMessage, MIN_SHEET_WIDTH } from '../src/app/files/classify';
import { prepareFiles } from '../src/app/files/decode';
import { hashBytes } from '../src/app/files/hash';
import type { SheetInput } from '../src/app/state/case-store';
import { loadFixtureBytes } from './fixtures';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('file classification before recognition', () => {
  it('JPEG and PNG are recognized by signature even if MIME is empty', () => {
    expect(classifyFile({ name: 'лист.jpg', type: '', head: bytes(0xff, 0xd8, 0xff, 0xe0) })).toBe('jpeg');
    expect(classifyFile({ name: 'лист', type: 'image/jpeg', head: bytes(0xff, 0xd8, 0xff, 0xe1) })).toBe('jpeg');
    expect(classifyFile({ name: 'лист.png', type: 'image/png', head: bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) })).toBe('png');
    expect(classifyFile({ name: 'a-01.jpg', type: 'image/jpeg', head: loadFixtureBytes('a-01').subarray(0, 16) })).toBe('jpeg');
  });

  it('PDF is recognized by signature, MIME or extension; anything else is not an image', () => {
    expect(classifyFile({ name: 'экг.pdf', type: 'application/pdf', head: bytes(0x25, 0x50, 0x44, 0x46, 0x2d) })).toBe('pdf');
    expect(classifyFile({ name: 'экг.PDF', type: '', head: bytes(0, 0, 0, 0) })).toBe('pdf');
    expect(classifyFile({ name: 'заметки.txt', type: 'text/plain', head: bytes(0x41, 0x42, 0x43) })).toBe('unknown');
    expect(classifyFile({ name: 'лист.jpg', type: 'image/jpeg', head: bytes(0x41, 0x42, 0x43) })).toBe('unknown');
    expect(classifyFile({ name: 'пусто', type: '', head: bytes() })).toBe('unknown');
  });

  it('per-file error texts are in Russian and name the cause', () => {
    expect(fileProblemMessage({ kind: 'not_image' })).toBe('Это не изображение — нужен JPEG или PNG');
    expect(fileProblemMessage({ kind: 'pdf' })).toBe('В этой версии PDF не поддерживается — сохраните лист как изображение (JPEG или PNG)');
    expect(fileProblemMessage({ kind: 'corrupt' })).toBe('Файл повреждён или не читается как изображение');
    expect(fileProblemMessage({ kind: 'too_narrow', width: 640 })).toBe(`Изображение слишком маленькое: ширина 640 px, нужно не меньше ${MIN_SHEET_WIDTH} px`);
    expect(MIN_SHEET_WIDTH).toBe(800);
  });
});

describe('preparing a batch of files', () => {
  it('a failure to prepare one file yields an "error" sheet with text, the others are prepared, order is preserved', async () => {
    const files = [new File(['a'], 'первый.jpg'), new File(['b'], 'второй.jpg'), new File(['c'], 'третий.jpg')];
    const prepare = async (file: File): Promise<SheetInput> => {
      if (file.name === 'второй.jpg') throw new Error('NotReadableError: файл недоступен');
      return { name: file.name, hash: file.name };
    };

    const inputs = await prepareFiles(files, prepare);

    expect(inputs.map((i) => i.name)).toEqual(['первый.jpg', 'второй.jpg', 'третий.jpg']);
    expect(inputs[0].problem).toBeUndefined();
    expect(inputs[2].problem).toBeUndefined();
    expect(inputs[1].problem).toEqual({ kind: 'unreadable' });
    expect(fileProblemMessage({ kind: 'unreadable' })).toBe('Файл не удалось прочитать — выберите его снова');
  });
});

describe('file byte hash (byte-for-byte duplicates)', () => {
  it('identical bytes — same hash; a difference in one byte or in length — a different one', () => {
    const a = loadFixtureBytes('a-01');
    const copy = new Uint8Array(a);
    const changed = new Uint8Array(a);
    changed[changed.length >> 1] ^= 0x01;

    expect(hashBytes(copy)).toBe(hashBytes(a));
    expect(hashBytes(changed)).not.toBe(hashBytes(a));
    expect(hashBytes(a.subarray(0, a.length - 1))).not.toBe(hashBytes(a));
    expect(hashBytes(loadFixtureBytes('a-02'))).not.toBe(hashBytes(a));
    expect(hashBytes(a)).toMatch(/^[0-9a-f:]+$/);
  });
});
