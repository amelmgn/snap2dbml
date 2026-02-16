import type {
  DirectusSnapshot,
  DirectusField,
  DirectusRelation,
  TransformOptions,
  TransformResult,
  TableModel,
  ColumnModel,
  ReferenceModel,
  SchemaModel,
  ConversionWarning,
} from './types.js';
import { CircularReferenceError } from './errors.js';
import { SYSTEM_COLLECTION_PREFIX, WARNING_CODES } from './constants.js';
import { mapDirectusType, SKIP_TYPES } from './type-map.js';

/**
 * Transform a validated Directus snapshot into the intermediate schema model.
 */
export function transformSnapshot(
  snapshot: DirectusSnapshot,
  options?: TransformOptions,
): TransformResult {
  const includeSystem = options?.includeSystem ?? false;
  const includeComments = options?.includeComments ?? false;
  const failOnCircular = options?.failOnCircularReference ?? false;

  const warnings: ConversionWarning[] = [];
  let tablesExcluded = 0;
  let fieldsSkipped = 0;

  // Filter collections
  const filteredCollections = snapshot.collections.filter((col) => {
    // Exclude system collections (directus_*) unless includeSystem is set
    if (!includeSystem && col.collection.startsWith(SYSTEM_COLLECTION_PREFIX)) {
      tablesExcluded++;
      return false;
    }
    // Exclude virtual folder collections (schema is null)
    if (col.schema === null || col.schema === undefined) {
      tablesExcluded++;
      return false;
    }
    return true;
  });

  const tableNameSet = new Set(filteredCollections.map((c) => c.collection));

  // Group fields by collection (single pass)
  const fieldsByCollection = new Map<string, DirectusField[]>();
  for (const field of snapshot.fields) {
    if (!fieldsByCollection.has(field.collection)) {
      fieldsByCollection.set(field.collection, []);
    }
    fieldsByCollection.get(field.collection)!.push(field);
  }

  // Relationship specials that indicate a virtual field worth annotating
  const RELATION_SPECIALS = new Set(['o2m', 'm2m', 'translations']);

  // Build lookup: (collection, one_field) -> related collection name
  // This maps alias fields like "price" on "units" to "unit_prices"
  const aliasRelationTarget = new Map<string, string>();
  for (const rel of snapshot.relations) {
    if (rel.meta?.one_field && rel.meta.one_collection) {
      const key = `${rel.meta.one_collection}.${rel.meta.one_field}`;
      aliasRelationTarget.set(key, rel.meta.many_collection);
    }
  }

  // Build tables
  const tables: TableModel[] = [];
  for (const col of filteredCollections) {
    const collectionFields = fieldsByCollection.get(col.collection) ?? [];
    const columns: ColumnModel[] = [];
    const virtualFields: { name: string; kind: string; relatedCollection?: string }[] = [];

    for (const field of collectionFields) {
      // Check skip types
      if (SKIP_TYPES.has(field.type)) {
        fieldsSkipped++;

        // Collect relationship aliases as virtual fields
        if (field.type === 'alias' && field.meta?.special) {
          const relKind = field.meta.special.find((s) => RELATION_SPECIALS.has(s));
          if (relKind) {
            const target = aliasRelationTarget.get(`${col.collection}.${field.field}`);
            virtualFields.push({ name: field.field, kind: relKind, relatedCollection: target });
          }
        }

        continue;
      }

      const typeResult = mapDirectusType(
        field.type,
        field.schema?.data_type ?? null,
      );

      if (typeResult.skipped) {
        fieldsSkipped++;
        continue;
      }

      if (typeResult.warning) {
        warnings.push({
          code: WARNING_CODES.UNKNOWN_FIELD_TYPE,
          message: typeResult.warning,
          collection: field.collection,
          field: field.field,
        });
      }

      const column: ColumnModel = {
        name: field.field,
        type: typeResult.dbmlType,
        isPrimaryKey: field.schema?.is_primary_key ?? false,
        isNullable: field.schema?.is_nullable ?? true,
      };

      // Default value
      if (field.schema?.default_value !== undefined && field.schema.default_value !== null) {
        column.defaultValue = formatDefaultValue(field.schema.default_value);
      }

      // Comment from meta.note
      if (includeComments && field.meta?.note) {
        column.comment = field.meta.note;
      }

      columns.push(column);
    }

    const table: TableModel = {
      name: col.collection,
      columns,
      isSystem: col.collection.startsWith(SYSTEM_COLLECTION_PREFIX),
      ...(virtualFields.length > 0 ? { virtualFields } : {}),
    };

    if (includeComments && col.meta?.note) {
      table.comment = col.meta.note;
    }

    tables.push(table);
  }

  // Resolve relationships
  const { references, warnings: relWarnings } = resolveRelationships(
    snapshot.relations,
    tableNameSet,
    tables,
  );
  warnings.push(...relWarnings);

  // Detect circular references
  const circularRefs = detectCircularReferences(references);

  if (circularRefs.length > 0) {
    if (failOnCircular) {
      throw new CircularReferenceError(circularRefs[0].split(' -> '));
    }
    for (const cycle of circularRefs) {
      warnings.push({
        code: WARNING_CODES.CIRCULAR_REFERENCE_DETECTED,
        message: `Circular reference detected: ${cycle}`,
      });
    }
  }

  const schema: SchemaModel = {
    tables,
    references,
    metadata: {
      directusVersion: snapshot.directus,
      snapshotVersion: snapshot.version,
      vendor: snapshot.vendor,
      generatedAt: new Date().toISOString(),
    },
  };

  return {
    schema,
    warnings,
    circularReferences: circularRefs,
    tablesExcluded,
    fieldsSkipped,
  };
}

/** Find the primary key column name for a table */
function findPrimaryKey(tables: TableModel[], tableName: string): string | null {
  const table = tables.find((t) => t.name === tableName);
  if (!table) return null;
  const pkCol = table.columns.find((c) => c.isPrimaryKey);
  return pkCol?.name ?? null;
}

/**
 * Resolve Directus relations into DBML reference models.
 *
 * Algorithm from spec:
 * - If meta.junction_field exists -> M2M (create reference from junction FK to related PK)
 * - Else if meta.many_collection and meta.one_collection both exist:
 *   - If meta.one_field is null -> M2O
 *   - Else if meta.many_field is null -> O2M (skip, covered by M2O side)
 *   - Else -> O2O
 * - Else -> Skip (incomplete), log warning
 */
function resolveRelationships(
  relations: DirectusRelation[],
  tableNameSet: Set<string>,
  tables: TableModel[],
): { references: ReferenceModel[]; warnings: ConversionWarning[] } {
  const references: ReferenceModel[] = [];
  const warnings: ConversionWarning[] = [];
  // Track M2M refs to avoid duplicates (each M2M pair generates two relations)
  const seenM2MRefs = new Set<string>();

  for (const rel of relations) {
    if (!rel.meta) {
      warnings.push({
        code: WARNING_CODES.INCOMPLETE_RELATION,
        message: `Relation on '${rel.collection}.${rel.field}' has no meta, skipping.`,
        collection: rel.collection,
        field: rel.field,
      });
      continue;
    }

    const meta = rel.meta;

    // M2M: junction_field is present
    if (meta.junction_field) {
      // This is a M2M relation - the current collection is the junction table
      const junctionTable = meta.many_collection;
      const junctionFK = meta.many_field;
      const relatedTable = meta.one_collection;

      if (!relatedTable) {
        warnings.push({
          code: WARNING_CODES.INCOMPLETE_RELATION,
          message: `M2M relation on '${junctionTable}.${junctionFK}' has no one_collection, skipping.`,
          collection: junctionTable,
          field: junctionFK,
        });
        continue;
      }

      // Check if both tables are in our filtered set
      if (!tableNameSet.has(junctionTable)) {
        warnings.push({
          code: WARNING_CODES.DANGLING_RELATION,
          message: `Junction table '${junctionTable}' was filtered out, skipping M2M relation.`,
          collection: junctionTable,
        });
        continue;
      }
      if (!tableNameSet.has(relatedTable)) {
        warnings.push({
          code: WARNING_CODES.DANGLING_RELATION,
          message: `Related table '${relatedTable}' was filtered out, skipping M2M relation.`,
          collection: relatedTable,
        });
        continue;
      }

      // Create reference: junction.FK > related.PK
      const relatedPK = findPrimaryKey(tables, relatedTable);
      if (relatedPK) {
        const refKey = `${junctionTable}.${junctionFK}>${relatedTable}.${relatedPK}`;
        if (!seenM2MRefs.has(refKey)) {
          seenM2MRefs.add(refKey);
          references.push({
            fromTable: junctionTable,
            fromColumn: junctionFK,
            toTable: relatedTable,
            toColumn: relatedPK,
            relation: '>',
          });
        }
      }
      continue;
    }

    // Non-M2M: check many_collection and one_collection
    if (!meta.many_collection || !meta.one_collection) {
      warnings.push({
        code: WARNING_CODES.INCOMPLETE_RELATION,
        message: `Relation on '${rel.collection}.${rel.field}' is incomplete (missing many_collection or one_collection), skipping.`,
        collection: rel.collection,
        field: rel.field,
      });
      continue;
    }

    // Check if collections are in filtered set
    if (!tableNameSet.has(meta.many_collection)) {
      warnings.push({
        code: WARNING_CODES.DANGLING_RELATION,
        message: `Collection '${meta.many_collection}' was filtered out, skipping relation.`,
        collection: meta.many_collection,
      });
      continue;
    }
    if (!tableNameSet.has(meta.one_collection)) {
      warnings.push({
        code: WARNING_CODES.DANGLING_RELATION,
        message: `Collection '${meta.one_collection}' was filtered out, skipping relation.`,
        collection: meta.one_collection,
      });
      continue;
    }

    // The FK is always on the "many" side (meta.many_field)
    // meta.one_field is a virtual field in Directus - it has no real column
    if (meta.many_field === null || meta.many_field === undefined) {
      // O2M without FK field on many side - skip, the M2O side will cover it
      continue;
    }

    // M2O or O2O: many_collection.many_field > one_collection.PK
    const onePK = findPrimaryKey(tables, meta.one_collection);
    if (onePK) {
      references.push({
        fromTable: meta.many_collection,
        fromColumn: meta.many_field,
        toTable: meta.one_collection,
        toColumn: onePK,
        relation: '>',
      });
    }
  }

  return { references, warnings };
}

/** Detect circular references in the relationship graph using DFS */
function detectCircularReferences(references: ReferenceModel[]): string[] {
  const adjacency = new Map<string, string[]>();
  for (const ref of references) {
    if (!adjacency.has(ref.fromTable)) {
      adjacency.set(ref.fromTable, []);
    }
    adjacency.get(ref.fromTable)!.push(ref.toTable);
  }

  const cycles: string[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node);
      const cycle = [...path.slice(cycleStart), node];
      cycles.push(cycle.join(' -> '));
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      dfs(neighbor, path);
    }

    path.pop();
    inStack.delete(node);
  }

  for (const node of adjacency.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return cycles;
}

/** Format a default value for DBML output */
function formatDefaultValue(value: unknown): string {
  if (typeof value === 'string') {
    // If it looks like a function call (e.g., "now()"), wrap in backticks
    if (/^\w+\(.*\)$/.test(value)) {
      return `\`${value}\``;
    }
    return `'${value}'`;
  }
  if (typeof value === 'boolean') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  return `'${String(value)}'`;
}
