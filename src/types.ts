// === Directus Snapshot Input Types ===

export interface DirectusSnapshot {
  version: number;
  directus: string;
  vendor?: string;
  collections: DirectusCollection[];
  fields: DirectusField[];
  relations: DirectusRelation[];
}

export interface DirectusCollection {
  collection: string;
  meta: {
    collection: string;
    icon?: string | null;
    note?: string | null;
    hidden: boolean;
    singleton: boolean;
  } | null;
  schema?: {
    name: string;
  } | null;
}

export interface DirectusField {
  collection: string;
  field: string;
  type: string;
  meta: {
    id: number;
    collection: string;
    field: string;
    special?: string[] | null;
    required?: boolean;
    note?: string | null;
  } | null;
  schema: {
    name: string;
    table: string;
    data_type: string;
    default_value?: unknown;
    is_nullable: boolean;
    is_primary_key: boolean;
    has_auto_increment?: boolean;
    max_length?: number | null;
    numeric_precision?: number | null;
    numeric_scale?: number | null;
  } | null;
}

export interface DirectusRelation {
  collection: string;
  field: string;
  related_collection: string | null;
  meta: {
    many_collection: string;
    many_field: string;
    one_collection: string | null;
    one_field: string | null;
    junction_field?: string | null;
  } | null;
  schema?: {
    constraint_name: string;
    table: string;
    column: string;
    foreign_key_table: string;
    foreign_key_column: string;
    on_update: string;
    on_delete: string;
  } | null;
}

// === Intermediate Schema Model ===

export interface SchemaModel {
  tables: TableModel[];
  references: ReferenceModel[];
  metadata: SchemaMetadata;
}

export interface TableModel {
  name: string;
  columns: ColumnModel[];
  comment?: string;
  isSystem: boolean;
  virtualFields?: { name: string; kind: string; relatedCollection?: string }[];
}

export interface ColumnModel {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
  defaultValue?: string;
  comment?: string;
}

export interface ReferenceModel {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  relation: '>' | '<' | '-';
}

export interface SchemaMetadata {
  directusVersion: string;
  snapshotVersion: number;
  vendor?: string;
  generatedAt: string;
}

// === Public API Types ===

export interface ConvertOptions {
  /** Include directus_* system collections. Default: false */
  includeSystem?: boolean;
  /** Include table/column comments from meta.note. Default: false */
  includeComments?: boolean;
  /** Maximum input size in bytes. Default: 52428800 (50MB) */
  maxSizeBytes?: number;
  /** Maximum JSON nesting depth. Default: 100 */
  maxDepth?: number;
  /** Suppress warnings to console. Default: false */
  suppressWarnings?: boolean;
  /** Throw error on circular reference. Default: false (warning) */
  failOnCircularReference?: boolean;
}

export interface ConvertResult {
  dbml: string;
  warnings: ConversionWarning[];
  stats: ConversionStats;
  metadata: ConversionMetadata;
}

export interface ConversionWarning {
  code: string;
  message: string;
  collection?: string;
  field?: string;
  path?: string;
}

export interface ConversionStats {
  tablesProcessed: number;
  tablesExcluded: number;
  fieldsProcessed: number;
  fieldsSkipped: number;
  relationsProcessed: number;
  circularReferences: number;
  durationMs: number;
}

export interface ConversionMetadata {
  directusVersion: string;
  snapshotVersion: number;
  generatedAt: string;
  snap2dbmlVersion: string;
}

// === Internal Types ===

export interface ParserOptions {
  includeSystem?: boolean;
  maxSizeBytes?: number;
  maxDepth?: number;
}

export interface TransformOptions {
  includeSystem?: boolean;
  includeComments?: boolean;
  failOnCircularReference?: boolean;
}

export interface TransformResult {
  schema: SchemaModel;
  warnings: ConversionWarning[];
  circularReferences: string[];
  tablesExcluded: number;
  fieldsSkipped: number;
}

export interface GeneratorOptions {
  includeComments?: boolean;
}

export type RelationType = 'M2O' | 'O2M' | 'M2M' | 'O2O';
