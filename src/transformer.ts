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

  // Columns with a unique (or primary key) constraint — used to detect true O2O relations
  const uniqueColumns = new Set<string>();
  for (const field of snapshot.fields) {
    if (field.schema?.is_unique || field.schema?.is_primary_key) {
      uniqueColumns.add(`${field.collection}.${field.field}`);
    }
  }

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

    const pkCount = columns.filter((c) => c.isPrimaryKey).length;
    if (pkCount > 1) {
      warnings.push({
        code: WARNING_CODES.MULTIPLE_PRIMARY_KEYS,
        message: `Collection '${col.collection}' has ${pkCount} primary key columns.`,
        collection: col.collection,
      });
    }

    // Drop virtual fields whose name collides with a real column (would produce duplicate
    // column lines in the DBML table block)
    const columnNames = new Set(columns.map((c) => c.name.toLowerCase()));
    const safeVirtualFields = virtualFields.filter((vf) => {
      if (columnNames.has(vf.name.toLowerCase())) {
        warnings.push({
          code: WARNING_CODES.DUPLICATE_VIRTUAL_FIELD,
          message: `Alias field '${vf.name}' in collection '${col.collection}' collides with a real column, skipping virtual field.`,
          collection: col.collection,
          field: vf.name,
        });
        return false;
      }
      return true;
    });

    const table: TableModel = {
      name: col.collection,
      columns,
      isSystem: col.collection.startsWith(SYSTEM_COLLECTION_PREFIX),
      ...(safeVirtualFields.length > 0 ? { virtualFields: safeVirtualFields } : {}),
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
    uniqueColumns,
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
 * Algorithm:
 * - If meta.junction_field exists -> M2M (create reference from junction FK to related PK)
 * - Else if meta.many_collection and meta.one_collection both exist:
 *   - If meta.many_field is null -> O2M (skip, covered by M2O side)
 *   - Else if the FK column has a unique (or PK) constraint -> O2O
 *   - Else -> M2O (meta.one_field merely indicates a reverse O2M alias field)
 * - Else -> Skip (incomplete), log warning
 */
function resolveRelationships(
  relations: DirectusRelation[],
  tableNameSet: Set<string>,
  tables: TableModel[],
  uniqueColumns: Set<string>,
): { references: ReferenceModel[]; warnings: ConversionWarning[] } {
  const references: ReferenceModel[] = [];
  const warnings: ConversionWarning[] = [];
  const seenReferenceKeys = new Set<string>();

  function addReference(reference: ReferenceModel): void {
    const key = `${reference.fromTable}.${reference.fromColumn}${reference.relation}${reference.toTable}.${reference.toColumn}`;
    if (seenReferenceKeys.has(key)) {
      return;
    }

    seenReferenceKeys.add(key);
    references.push(reference);
  }

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
        addReference({
          fromTable: junctionTable,
          fromColumn: junctionFK,
          toTable: relatedTable,
          toColumn: relatedPK,
          relation: '>',
        });
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

    // M2O or O2O: many_collection.many_field [relation] one_collection.PK
    // A relation is O2O only when the FK column itself is unique — meta.one_field
    // alone just means a reverse O2M alias field exists on the "one" side.
    const isO2O = uniqueColumns.has(`${meta.many_collection}.${meta.many_field}`);
    const onePK = findPrimaryKey(tables, meta.one_collection);
    if (onePK) {
      addReference({
        fromTable: meta.many_collection,
        fromColumn: meta.many_field,
        toTable: meta.one_collection,
        toColumn: onePK,
        relation: isO2O ? '-' : '>',
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

  // Iterative DFS (explicit stack) so very long reference chains cannot overflow the call stack
  const cycles: string[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  for (const root of adjacency.keys()) {
    if (visited.has(root)) continue;

    const path: string[] = [root];
    const stack: Array<{ node: string; nextIndex: number }> = [{ node: root, nextIndex: 0 }];
    visited.add(root);
    inStack.add(root);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = adjacency.get(frame.node) ?? [];

      if (frame.nextIndex < neighbors.length) {
        const neighbor = neighbors[frame.nextIndex++];
        if (inStack.has(neighbor)) {
          // Found a cycle
          const cycleStart = path.indexOf(neighbor);
          cycles.push([...path.slice(cycleStart), neighbor].join(' -> '));
        } else if (!visited.has(neighbor)) {
          visited.add(neighbor);
          inStack.add(neighbor);
          path.push(neighbor);
          stack.push({ node: neighbor, nextIndex: 0 });
        }
      } else {
        stack.pop();
        path.pop();
        inStack.delete(frame.node);
      }
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
    return `'${escapeDefaultString(value)}'`;
  }
  if (typeof value === 'boolean') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'object' && value !== null) {
    return `'${escapeDefaultString(JSON.stringify(value))}'`;
  }
  return `'${escapeDefaultString(String(value))}'`;
}

/** Escape a default value string for safe embedding in DBML single quotes */
function escapeDefaultString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
}
