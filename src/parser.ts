import type { DirectusSnapshot, ParserOptions } from './types.js';
import { InvalidSnapshotError, FileTooLargeError } from './errors.js';
import { DEFAULT_MAX_SIZE_BYTES } from './constants.js';
import { validateSnapshot } from './validator.js';

/**
 * Parse and validate a Directus snapshot from a parsed JSON object.
 */
export function parseSnapshot(input: unknown, options?: ParserOptions): DirectusSnapshot {
  return validateSnapshot(input);
}

/**
 * Parse and validate a Directus snapshot from a JSON string.
 * Enforces size limits before parsing.
 */
export function parseSnapshotString(json: string, options?: ParserOptions): DirectusSnapshot {
  const maxSize = options?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

  // Check size before parsing
  const byteLength = new TextEncoder().encode(json).byteLength;
  if (byteLength > maxSize) {
    throw new FileTooLargeError(byteLength, maxSize);
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidSnapshotError('File is not valid JSON.', {
      suggestion: 'Ensure the input is a valid JSON file exported by Directus.',
    });
  }

  return parseSnapshot(parsed, options);
}
