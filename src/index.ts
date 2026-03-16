import { parseSnapshotString } from './parser.js';
import {
  buildConversionArtifacts,
  buildConversionArtifactsFromParsedSnapshot,
} from './conversion.js';
import type {
  DirectusSnapshot,
  ConvertOptions,
  ConvertResult,
  MarkdownConvertResult,
} from './types.js';

/**
 * Convert a parsed Directus snapshot object to a DBML string.
 */
export function convertSnapshot(snapshot: DirectusSnapshot, options?: ConvertOptions): string {
  const result = buildConversionArtifacts(snapshot, options);
  emitWarnings(result.warnings, options?.suppressWarnings);
  return result.dbml;
}

/**
 * Convert a JSON string containing a Directus snapshot to a DBML string.
 */
export function convertSnapshotString(json: string, options?: ConvertOptions): string {
  const parsed = parseSnapshotString(json, {
    maxSizeBytes: options?.maxSizeBytes,
    maxDepth: options?.maxDepth,
  });

  const result = buildConversionArtifactsFromParsedSnapshot(parsed, options);
  emitWarnings(result.warnings, options?.suppressWarnings);
  return result.dbml;
}

/**
 * Convert a Directus snapshot to a Markdown document describing all collections.
 */
export function convertSnapshotToMarkdown(
  snapshot: DirectusSnapshot,
  options?: ConvertOptions,
): MarkdownConvertResult {
  const result = buildConversionArtifacts(snapshot, options, true);

  return {
    markdown: result.markdown!,
    warnings: result.warnings,
    stats: result.stats,
    metadata: result.metadata,
  };
}

/**
 * Convert a Directus snapshot to DBML with detailed statistics and metadata.
 */
export function convertSnapshotWithStats(
  snapshot: DirectusSnapshot,
  options?: ConvertOptions,
): ConvertResult {
  const result = buildConversionArtifacts(snapshot, options);

  return {
    dbml: result.dbml,
    warnings: result.warnings,
    stats: result.stats,
    metadata: result.metadata,
  };
}

function emitWarnings(
  warnings: ConvertResult['warnings'],
  suppressWarnings = false,
): void {
  if (suppressWarnings) {
    return;
  }

  for (const warning of warnings) {
    process.stderr.write(`snap2dbml warning: [${warning.code}] ${warning.message}\n`);
  }
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
  MarkdownConvertResult,
  ConversionWarning,
  ConversionStats,
  ConversionMetadata,
} from './types.js';

// Re-export markdown generator (for programmatic use)
export { generateMarkdown } from './md-generator.js';
export type { MdGeneratorOptions } from './md-generator.js';

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
