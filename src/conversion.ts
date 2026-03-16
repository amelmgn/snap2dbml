import { parseSnapshot } from './parser.js';
import { transformSnapshot } from './transformer.js';
import { generateDBML } from './generator.js';
import { generateMarkdown } from './md-generator.js';
import { LIBRARY_VERSION } from './version.js';
import type {
  ConvertOptions,
  ConversionMetadata,
  ConversionStats,
  ConversionWarning,
  DirectusSnapshot,
  TransformResult,
} from './types.js';

export interface ConversionArtifacts {
  dbml: string;
  markdown?: string;
  warnings: ConversionWarning[];
  stats: ConversionStats;
  metadata: ConversionMetadata;
}

export function buildConversionArtifacts(
  snapshot: DirectusSnapshot,
  options?: ConvertOptions,
  includeMarkdown = false,
): ConversionArtifacts {
  const parsed = parseSnapshot(snapshot, {
    maxSizeBytes: options?.maxSizeBytes,
    maxDepth: options?.maxDepth,
  });

  return buildConversionArtifactsFromParsedSnapshot(parsed, options, includeMarkdown);
}

export function buildConversionArtifactsFromParsedSnapshot(
  snapshot: DirectusSnapshot,
  options?: ConvertOptions,
  includeMarkdown = false,
): ConversionArtifacts {
  const startTime = performance.now();

  const transformResult = transformSnapshot(snapshot, {
    includeSystem: options?.includeSystem,
    includeComments: options?.includeComments,
    failOnCircularReference: options?.failOnCircularReference,
  });

  const dbml = generateDBML(transformResult.schema, {
    includeComments: options?.includeComments,
  });

  const markdown = includeMarkdown
    ? generateMarkdown(transformResult.schema, {
      includeComments: options?.includeComments,
    })
    : undefined;

  return {
    dbml,
    ...(markdown !== undefined ? { markdown } : {}),
    warnings: transformResult.warnings,
    stats: buildStats(transformResult, performance.now() - startTime),
    metadata: buildMetadata(transformResult),
  };
}

function buildStats(transformResult: TransformResult, durationMs: number): ConversionStats {
  let fieldsProcessed = 0;
  for (const table of transformResult.schema.tables) {
    fieldsProcessed += table.columns.length;
  }

  return {
    tablesProcessed: transformResult.schema.tables.length,
    tablesExcluded: transformResult.tablesExcluded,
    fieldsProcessed,
    fieldsSkipped: transformResult.fieldsSkipped,
    relationsProcessed: transformResult.schema.references.length,
    circularReferences: transformResult.circularReferences.length,
    durationMs,
  };
}

function buildMetadata(transformResult: TransformResult): ConversionMetadata {
  return {
    directusVersion: transformResult.schema.metadata.directusVersion,
    snapshotVersion: transformResult.schema.metadata.snapshotVersion,
    generatedAt: transformResult.schema.metadata.generatedAt,
    snap2dbmlVersion: LIBRARY_VERSION,
  };
}
