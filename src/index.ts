import { parseSnapshot, parseSnapshotString } from './parser.js';
import { transformSnapshot } from './transformer.js';
import { generateDBML } from './generator.js';
import type {
  DirectusSnapshot,
  ConvertOptions,
  ConvertResult,
  ConversionWarning,
} from './types.js';

const VERSION = '1.0.0';

/**
 * Convert a parsed Directus snapshot object to a DBML string.
 */
export function convertSnapshot(snapshot: DirectusSnapshot, options?: ConvertOptions): string {
  const parsed = parseSnapshot(snapshot, {
    maxSizeBytes: options?.maxSizeBytes,
    maxDepth: options?.maxDepth,
  });

  const transformResult = transformSnapshot(parsed, {
    includeSystem: options?.includeSystem,
    includeComments: options?.includeComments,
    failOnCircularReference: options?.failOnCircularReference,
  });

  if (!options?.suppressWarnings) {
    for (const w of transformResult.warnings) {
      process.stderr.write(`snap2dbml warning: [${w.code}] ${w.message}\n`);
    }
  }

  return generateDBML(transformResult.schema, {
    includeComments: options?.includeComments,
  });
}

/**
 * Convert a JSON string containing a Directus snapshot to a DBML string.
 */
export function convertSnapshotString(json: string, options?: ConvertOptions): string {
  const parsed = parseSnapshotString(json, {
    maxSizeBytes: options?.maxSizeBytes,
    maxDepth: options?.maxDepth,
  });

  return convertSnapshot(parsed, options);
}

/**
 * Convert a Directus snapshot to DBML with detailed statistics and metadata.
 */
export function convertSnapshotWithStats(
  snapshot: DirectusSnapshot,
  options?: ConvertOptions,
): ConvertResult {
  const startTime = performance.now();

  const parsed = parseSnapshot(snapshot, {
    maxSizeBytes: options?.maxSizeBytes,
    maxDepth: options?.maxDepth,
  });

  const transformResult = transformSnapshot(parsed, {
    includeSystem: options?.includeSystem,
    includeComments: options?.includeComments,
    failOnCircularReference: options?.failOnCircularReference,
  });

  const dbml = generateDBML(transformResult.schema, {
    includeComments: options?.includeComments,
  });

  const durationMs = performance.now() - startTime;

  // Count fields processed
  let fieldsProcessed = 0;
  for (const table of transformResult.schema.tables) {
    fieldsProcessed += table.columns.length;
  }

  return {
    dbml,
    warnings: transformResult.warnings,
    stats: {
      tablesProcessed: transformResult.schema.tables.length,
      tablesExcluded: transformResult.tablesExcluded,
      fieldsProcessed,
      fieldsSkipped: transformResult.fieldsSkipped,
      relationsProcessed: transformResult.schema.references.length,
      circularReferences: transformResult.circularReferences.length,
      durationMs,
    },
    metadata: {
      directusVersion: transformResult.schema.metadata.directusVersion,
      snapshotVersion: transformResult.schema.metadata.snapshotVersion,
      generatedAt: new Date().toISOString(),
      snap2dbmlVersion: VERSION,
    },
  };
}

// Re-export types
export type {
  DirectusSnapshot,
  DirectusCollection,
  DirectusField,
  DirectusRelation,
  SchemaModel,
  TableModel,
  ColumnModel,
  ReferenceModel,
  ConvertOptions,
  ConvertResult,
  ConversionWarning,
  ConversionStats,
  ConversionMetadata,
} from './types.js';

// Re-export errors
export {
  Snap2DBMLError,
  InvalidSnapshotError,
  UnsupportedFieldError,
  CircularReferenceError,
  ValidationError,
  FileTooLargeError,
} from './errors.js';

// Re-export constants
export { ERROR_CODES, WARNING_CODES } from './constants.js';
