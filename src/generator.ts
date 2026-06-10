import type { SchemaModel, TableModel, ColumnModel, ReferenceModel, GeneratorOptions } from './types.js';

/**
 * Generate a deterministic DBML string from the intermediate schema model.
 *
 * Determinism guarantees:
 * - Tables sorted alphabetically (case-insensitive, locale 'en')
 * - Columns: primary keys first (original order), then alphabetical
 * - References sorted by `${fromTable}.${fromColumn}`
 * - 2-space indentation, LF-only line endings, no trailing whitespace
 */
export function generateDBML(schema: SchemaModel, options?: GeneratorOptions): string {
  const parts: string[] = [];

  // Sort tables alphabetically (case-insensitive)
  const sortedTables = [...schema.tables].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );

  // Generate each table block
  for (let i = 0; i < sortedTables.length; i++) {
    if (i > 0) {
      parts.push('');
    }
    parts.push(generateTable(sortedTables[i], options));
  }

  // Sort references by `${fromTable}.${fromColumn}`
  const sortedRefs = [...schema.references].sort((a, b) => {
    const aKey = `${a.fromTable}.${a.fromColumn}`;
    const bKey = `${b.fromTable}.${b.fromColumn}`;
    return aKey.localeCompare(bKey, 'en', { sensitivity: 'base' });
  });

  // Generate Ref lines
  if (sortedRefs.length > 0) {
    parts.push('');
    for (const ref of sortedRefs) {
      parts.push(generateRef(ref));
    }
  }

  return parts.join('\n') + '\n';
}

function generateTable(table: TableModel, options?: GeneratorOptions): string {
  const lines: string[] = [];
  const tableName = needsQuoting(table.name) ? `"${table.name}"` : table.name;

  lines.push(`Table ${tableName} {`);

  // Sort columns: PKs first (preserve original order), then non-PKs alphabetically
  const pks = table.columns.filter((c) => c.isPrimaryKey);
  const nonPks = [...table.columns.filter((c) => !c.isPrimaryKey)].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );
  const sortedColumns = [...pks, ...nonPks];

  for (const col of sortedColumns) {
    lines.push(`  ${generateColumn(col, options)}`);
  }

  // Virtual fields (alias relationships) as visible columns
  if (table.virtualFields && table.virtualFields.length > 0) {
    const sorted = [...table.virtualFields].sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    );
    for (const vf of sorted) {
      const vfName = needsQuoting(vf.name) ? `"${vf.name}"` : vf.name;
      const label = vf.relatedCollection
        ? `${vf.kind} → ${vf.relatedCollection}`
        : vf.kind;
      lines.push(`  ${vfName} virtual [note: '${escapeString(label)}']`);
    }
  }

  // Table-level note
  if (options?.includeComments && table.comment) {
    lines.push('');
    lines.push(`  Note: '${escapeString(table.comment)}'`);
  }

  lines.push('}');
  return lines.join('\n');
}

function generateColumn(col: ColumnModel, options?: GeneratorOptions): string {
  const colName = needsQuoting(col.name) ? `"${col.name}"` : col.name;
  const settings: string[] = [];

  if (col.isPrimaryKey) {
    settings.push('pk');
  }
  if (!col.isNullable && !col.isPrimaryKey) {
    settings.push('not null');
  }
  if (col.defaultValue !== undefined) {
    settings.push(`default: ${col.defaultValue}`);
  }
  if (options?.includeComments && col.comment) {
    settings.push(`note: '${escapeString(col.comment)}'`);
  }

  const settingsStr = settings.length > 0 ? ` [${settings.join(', ')}]` : '';
  return `${colName} ${col.type}${settingsStr}`;
}

function generateRef(ref: ReferenceModel): string {
  const fromTable = needsQuoting(ref.fromTable) ? `"${ref.fromTable}"` : ref.fromTable;
  const fromColumn = needsQuoting(ref.fromColumn) ? `"${ref.fromColumn}"` : ref.fromColumn;
  const toTable = needsQuoting(ref.toTable) ? `"${ref.toTable}"` : ref.toTable;
  const toColumn = needsQuoting(ref.toColumn) ? `"${ref.toColumn}"` : ref.toColumn;
  return `Ref: ${fromTable}.${fromColumn} ${ref.relation} ${toTable}.${toColumn}`;
}

/** Check if a name needs quoting (contains spaces, special chars, or is non-ASCII) */
function needsQuoting(name: string): boolean {
  // Quote if contains spaces, special characters, or non-ASCII
  return /[^a-zA-Z0-9_]/.test(name);
}

/** Escape special characters for DBML strings */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
}
