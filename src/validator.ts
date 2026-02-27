import type { DirectusSnapshot, DirectusCollection, DirectusField } from './types.js';
import { InvalidSnapshotError } from './errors.js';
import { SUPPORTED_SNAPSHOT_VERSIONS } from './constants.js';
import { SKIP_TYPES } from './type-map.js';

export function validateIsObject(input: unknown): asserts input is Record<string, unknown> {
  if (input === null || input === undefined) {
    throw new InvalidSnapshotError("Snapshot is null or undefined.", {
      path: 'root',
      suggestion: 'Provide a valid Directus snapshot object.',
    });
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidSnapshotError(`Snapshot must be an object, got ${Array.isArray(input) ? 'array' : typeof input}.`, {
      path: 'root',
      suggestion: 'Provide a valid Directus snapshot object.',
    });
  }
}

export function validateVersion(obj: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(obj, 'version')) {
    throw new InvalidSnapshotError("Snapshot missing required 'version' property.", {
      path: 'root.version',
    });
  }
  const version = obj.version;
  if (typeof version !== 'number' || !SUPPORTED_SNAPSHOT_VERSIONS.includes(version as 1 | 4)) {
    throw new InvalidSnapshotError(
      `Unsupported snapshot version: ${JSON.stringify(version)}. Supported versions: ${SUPPORTED_SNAPSHOT_VERSIONS.join(', ')}.`,
      {
        path: 'root.version',
        suggestion: 'Ensure this snapshot was exported from Directus 10.x (version: 1) or 11.x (version: 4).',
      },
    );
  }
}

export function validateDirectusProperty(obj: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(obj, 'directus')) {
    throw new InvalidSnapshotError("Snapshot missing required 'directus' property.", {
      path: 'root.directus',
    });
  }
  if (typeof obj.directus !== 'string' || obj.directus.length === 0) {
    throw new InvalidSnapshotError("Snapshot 'directus' property must be a non-empty string.", {
      path: 'root.directus',
    });
  }
}

export function validateCollectionsArray(obj: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(obj, 'collections')) {
    throw new InvalidSnapshotError("Snapshot missing required 'collections' array.", {
      path: 'root.collections',
    });
  }
  if (!Array.isArray(obj.collections)) {
    throw new InvalidSnapshotError("Snapshot 'collections' must be an array.", {
      path: 'root.collections',
    });
  }
}

export function validateFieldsArray(obj: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(obj, 'fields')) {
    throw new InvalidSnapshotError("Snapshot missing required 'fields' array.", {
      path: 'root.fields',
    });
  }
  if (!Array.isArray(obj.fields)) {
    throw new InvalidSnapshotError("Snapshot 'fields' must be an array.", {
      path: 'root.fields',
    });
  }
}

export function validateRelationsArray(obj: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(obj, 'relations')) {
    throw new InvalidSnapshotError("Snapshot missing required 'relations' array.", {
      path: 'root.relations',
    });
  }
  if (!Array.isArray(obj.relations)) {
    throw new InvalidSnapshotError("Snapshot 'relations' must be an array.", {
      path: 'root.relations',
    });
  }
}

export function validateCollectionShape(collection: unknown, index: number): asserts collection is DirectusCollection {
  if (collection === null || typeof collection !== 'object') {
    throw new InvalidSnapshotError(`Collection at index ${index} must be an object.`, {
      path: `root.collections[${index}]`,
    });
  }
  const col = collection as Record<string, unknown>;
  if (typeof col.collection !== 'string' || col.collection.length === 0) {
    throw new InvalidSnapshotError(`Collection at index ${index} must have a non-empty 'collection' string property.`, {
      path: `root.collections[${index}].collection`,
    });
  }
  // meta can be null or object
  if (col.meta !== null && (typeof col.meta !== 'object' || Array.isArray(col.meta))) {
    throw new InvalidSnapshotError(`Collection '${col.collection}' has invalid 'meta': must be an object or null.`, {
      path: `root.collections[${index}].meta`,
    });
  }
}

export function validateFieldShape(field: unknown, index: number): asserts field is DirectusField {
  if (field === null || typeof field !== 'object') {
    throw new InvalidSnapshotError(`Field at index ${index} must be an object.`, {
      path: `root.fields[${index}]`,
    });
  }
  const f = field as Record<string, unknown>;
  if (typeof f.collection !== 'string' || f.collection.length === 0) {
    throw new InvalidSnapshotError(`Field at index ${index} must have a non-empty 'collection' string property.`, {
      path: `root.fields[${index}].collection`,
    });
  }
  if (typeof f.field !== 'string' || f.field.length === 0) {
    throw new InvalidSnapshotError(`Field at index ${index} must have a non-empty 'field' string property.`, {
      path: `root.fields[${index}].field`,
    });
  }
  if (typeof f.type !== 'string') {
    throw new InvalidSnapshotError(`Field '${f.collection}.${f.field}' must have a 'type' string property.`, {
      path: `root.fields[${index}].type`,
    });
  }
  // meta can be null or object
  if (f.meta !== null && f.meta !== undefined && (typeof f.meta !== 'object' || Array.isArray(f.meta))) {
    throw new InvalidSnapshotError(`Field '${f.collection}.${f.field}' has invalid 'meta': must be an object or null.`, {
      path: `root.fields[${index}].meta`,
    });
  }
  // schema can be null or object
  if (f.schema !== null && f.schema !== undefined && (typeof f.schema !== 'object' || Array.isArray(f.schema))) {
    throw new InvalidSnapshotError(`Field '${f.collection}.${f.field}' has invalid 'schema': must be an object or null.`, {
      path: `root.fields[${index}].schema`,
    });
  }
}

export function validateNoDuplicateCollections(collections: DirectusCollection[]): void {
  const seen = new Set<string>();
  for (const col of collections) {
    const key = col.collection.toLowerCase();
    if (seen.has(key)) {
      throw new InvalidSnapshotError(`Duplicate collection name: '${col.collection}' (case-insensitive).`, {
        path: `root.collections`,
        suggestion: 'Remove duplicate collection entries from the snapshot.',
      });
    }
    seen.add(key);
  }
}

export function validateNoDuplicateFields(fields: DirectusField[]): void {
  const seen = new Map<string, Set<string>>();
  for (const field of fields) {
    // Alias/presentation/group fields are UI-only and have no DB column — skip them
    if (SKIP_TYPES.has(field.type)) continue;
    const colKey = field.collection.toLowerCase();
    const fieldKey = field.field.toLowerCase();
    if (!seen.has(colKey)) {
      seen.set(colKey, new Set());
    }
    const colFields = seen.get(colKey)!;
    if (colFields.has(fieldKey)) {
      throw new InvalidSnapshotError(
        `Duplicate field name '${field.field}' in collection '${field.collection}' (case-insensitive).`,
        {
          path: `root.fields`,
          suggestion: 'Remove duplicate field entries from the snapshot.',
        },
      );
    }
    colFields.add(fieldKey);
  }
}

/** Run all validation rules in sequence. Returns the validated snapshot. */
export function validateSnapshot(input: unknown): DirectusSnapshot {
  validateIsObject(input);

  // Unwrap Directus `{"data": {...}}` envelope if present
  const obj = input as Record<string, unknown>;
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    const inner = obj.data as Record<string, unknown>;
    if (inner.version !== undefined && inner.collections !== undefined) {
      return validateSnapshot(inner);
    }
  }

  validateVersion(input);
  validateDirectusProperty(input);
  validateCollectionsArray(input);
  validateFieldsArray(input);
  validateRelationsArray(input);

  const collections = obj.collections as unknown[];
  const fields = obj.fields as unknown[];

  // Validate individual shapes
  for (let i = 0; i < collections.length; i++) {
    validateCollectionShape(collections[i], i);
  }
  for (let i = 0; i < fields.length; i++) {
    validateFieldShape(fields[i], i);
  }

  // Validate no duplicates
  validateNoDuplicateCollections(obj.collections as DirectusCollection[]);
  validateNoDuplicateFields(obj.fields as DirectusField[]);

  return input as unknown as DirectusSnapshot;
}
