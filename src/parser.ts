import type { DirectusSnapshot, ParserOptions } from './types.js';
import { InvalidSnapshotError, FileTooLargeError, ValidationError } from './errors.js';
import { DEFAULT_MAX_DEPTH, DEFAULT_MAX_SIZE_BYTES } from './constants.js';
import { validateSnapshot } from './validator.js';

/**
 * Parse and validate a Directus snapshot from a parsed JSON object.
 */
export function parseSnapshot(input: unknown, options?: ParserOptions): DirectusSnapshot {
  assertWithinMaxDepth(input, normalizeMaxDepth(options?.maxDepth));
  return validateSnapshot(input);
}

/**
 * Parse and validate a Directus snapshot from a JSON string.
 * Enforces size limits before parsing.
 */
export function parseSnapshotString(json: string, options?: ParserOptions): DirectusSnapshot {
  const maxSize = options?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

  // Check size before parsing (Buffer.byteLength avoids copying the whole string)
  const byteLength = Buffer.byteLength(json, 'utf-8');
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

function normalizeMaxDepth(maxDepth?: number): number {
  const normalized = maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new ValidationError(
      `Invalid maxDepth: ${JSON.stringify(maxDepth)}. Expected a positive integer.`,
      'Pass a positive integer for maxDepth, for example 100.',
    );
  }
  return normalized;
}

function assertWithinMaxDepth(input: unknown, maxDepth: number): void {
  const stack: Array<{ value: unknown; depth: number; path: string }> = [
    { value: input, depth: isContainer(input) ? 1 : 0, path: 'root' },
  ];
  const seen = new WeakSet<object>();

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (!isContainer(current.value)) {
      continue;
    }

    if (current.depth > maxDepth) {
      throw new ValidationError(
        `Input exceeds maximum nesting depth of ${maxDepth} at ${current.path}.`,
        'Increase maxDepth or simplify nested data in the snapshot.',
      );
    }

    if (seen.has(current.value)) {
      continue;
    }
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        const child = current.value[index];
        stack.push({
          value: child,
          depth: isContainer(child) ? current.depth + 1 : current.depth,
          path: `${current.path}[${index}]`,
        });
      }
      continue;
    }

    const entries = Object.entries(current.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      stack.push({
        value: child,
        depth: isContainer(child) ? current.depth + 1 : current.depth,
        path: `${current.path}.${key}`,
      });
    }
  }
}

function isContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
