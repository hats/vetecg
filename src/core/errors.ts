/**
 * Stub error: the function is declared by the contract but not implemented yet.
 * Inside the pipeline such exceptions are caught and become an `issue` of the result instead of failing the sheet.
 */
export class NotImplementedError extends Error {
  readonly unit: string;

  constructor(unit: string) {
    super(`Не реализовано: ${unit}`);
    this.name = 'NotImplemented';
    this.unit = unit;
  }
}

export function notImplemented(unit: string): never {
  throw new NotImplementedError(unit);
}

export function isNotImplemented(error: unknown): error is NotImplementedError {
  return error instanceof NotImplementedError;
}
