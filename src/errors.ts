export abstract class Snap2DBMLError extends Error {
  abstract readonly code: string;
  abstract getExitCode(): number;
  readonly suggestion?: string;

  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = this.constructor.name;
    this.suggestion = suggestion;
  }
}

export class InvalidSnapshotError extends Snap2DBMLError {
  readonly code = 'INVALID_SNAPSHOT';
  readonly path?: string;
  readonly validationErrors?: string[];

  getExitCode(): number {
    return 1;
  }

  constructor(message: string, options?: { path?: string; validationErrors?: string[]; suggestion?: string }) {
    super(message, options?.suggestion ?? 'Ensure you are using a valid Directus snapshot file.');
    this.path = options?.path;
    this.validationErrors = options?.validationErrors;
  }
}

export class CircularReferenceError extends Snap2DBMLError {
  readonly code = 'CIRCULAR_REFERENCE';
  readonly chain: string[];

  getExitCode(): number {
    return 5;
  }

  constructor(chain: string[]) {
    super(
      `Circular reference detected: ${chain.join(' -> ')}`,
      'Use --fail-on-circular to treat this as an error, or review your schema relationships.',
    );
    this.chain = chain;
  }
}

export class FileTooLargeError extends Snap2DBMLError {
  readonly code = 'FILE_TOO_LARGE';
  readonly actualSize: number;
  readonly maxSize: number;

  getExitCode(): number {
    return 4;
  }

  constructor(actualSize: number, maxSize: number) {
    const actualMB = (actualSize / (1024 * 1024)).toFixed(1);
    const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
    super(
      `Input size (${actualMB}MB) exceeds maximum allowed size (${maxMB}MB).`,
      `Use --max-size to increase the limit.`,
    );
    this.actualSize = actualSize;
    this.maxSize = maxSize;
  }
}

export class ValidationError extends Snap2DBMLError {
  readonly code = 'VALIDATION_ERROR';

  getExitCode(): number {
    return 1;
  }

  constructor(message: string, suggestion?: string) {
    super(message, suggestion);
  }
}
