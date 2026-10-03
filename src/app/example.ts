/**
 * Built-in example (story 5): sheet `a-01` from the fixture set, bundled by Vite as a static asset.
 * Goes through the same path as the vet's file (`prepareFile` → `addSheets`), so the result is indistinguishable.
 */
import exampleUrl from '../../fixtures/polyspectrum/a-01.jpg?url';

export const EXAMPLE_FILE_NAME = 'пример-лист-a-01.jpg';

export async function loadExampleFile(): Promise<File> {
  const response = await fetch(exampleUrl);
  if (!response.ok) throw new Error(`Пример не загрузился: HTTP ${response.status}`);
  const blob = await response.blob();
  return new File([blob], EXAMPLE_FILE_NAME, { type: 'image/jpeg' });
}
