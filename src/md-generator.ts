import type { SchemaModel, TableModel, ColumnModel, ReferenceModel } from './types.js';

export interface MdGeneratorOptions {
  includeComments?: boolean;
}

/**
 * Generate a Markdown document describing all collections and their fields.
 *
 * Each collection gets a `### \`name\`` heading followed by a GFM table:
 *   | Field | Type | Required | Relation | Settings |
 *
 * Sorting mirrors generateDBML: tables alphabetically, PKs first then fields alphabetically.
 */
export function generateMarkdown(schema: SchemaModel, options?: MdGeneratorOptions): string {
  // Build FK lookup: "table.column" -> reference details
  const fkLookup = new Map<string, ReferenceModel>();
  for (const ref of schema.references) {
    fkLookup.set(`${ref.fromTable}.${ref.fromColumn}`, ref);
  }

  const sortedTables = [...schema.tables].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );

  const sections: string[] = [];
  for (const table of sortedTables) {
    sections.push(generateTableSection(table, fkLookup, options));
  }

  return sections.join('\n\n') + '\n';
}

function generateTableSection(
  table: TableModel,
  fkLookup: Map<string, ReferenceModel>,
  options?: MdGeneratorOptions,
): string {
  const lines: string[] = [];

  lines.push(`### ${formatInlineCode(table.name)}`);

  if (options?.includeComments && table.comment) {
    lines.push('');
    lines.push(table.comment);
  }

  lines.push('');
  lines.push('| Field | Type | Required | Relation | Settings |');
  lines.push('| ----- | ---- | -------- | -------- | -------- |');

  // PKs first (preserve original order), then non-PKs alphabetically
  const pks = table.columns.filter((c) => c.isPrimaryKey);
  const nonPks = [...table.columns.filter((c) => !c.isPrimaryKey)].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );

  for (const col of [...pks, ...nonPks]) {
    lines.push(generateColumnRow(col, table.name, fkLookup, options));
  }

  // Virtual fields (O2M / M2M aliases)
  if (table.virtualFields && table.virtualFields.length > 0) {
    const sorted = [...table.virtualFields].sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    );
    for (const vf of sorted) {
      const relation = vf.relatedCollection
        ? `${vf.kind.toUpperCase()} → ${vf.relatedCollection}`
        : vf.kind.toUpperCase();
      lines.push(
        `| ${formatInlineCode(vf.name)} | virtual | -- | ${escapeMarkdownTableCell(relation)} | -- |`,
      );
    }
  }

  return lines.join('\n');
}

function generateColumnRow(
  col: ColumnModel,
  tableName: string,
  fkLookup: Map<string, ReferenceModel>,
  options?: MdGeneratorOptions,
): string {
  const required = !col.isNullable ? 'Yes' : 'No';

  let relation = '--';
  const settingsParts: string[] = [];

  if (col.isPrimaryKey) {
    relation = 'Primary key';
    settingsParts.push('Auto-generated');
  } else {
    const reference = fkLookup.get(`${tableName}.${col.name}`);
    if (reference) {
      relation = reference.relation === '-'
        ? `O2O to ${reference.toTable}`
        : `M2O to ${reference.toTable}`;
      settingsParts.push('Foreign Key');
    }
  }

  if (col.defaultValue !== undefined && !col.isPrimaryKey) {
    settingsParts.push(`Default: ${col.defaultValue}`);
  }

  if (options?.includeComments && col.comment) {
    settingsParts.push(col.comment);
  }

  const settings = settingsParts.length > 0 ? settingsParts.join('; ') : '--';

  return `| ${formatInlineCode(col.name)} | ${escapeMarkdownTableCell(col.type)} | ${required} | ${escapeMarkdownTableCell(relation)} | ${escapeMarkdownTableCell(settings)} |`;
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/\n/g, '<br>')
    .replace(/\|/g, '\\|');
}

function formatInlineCode(value: string): string {
  const sanitized = escapeMarkdownTableCell(value);
  const backtickRuns = sanitized.match(/`+/g);
  const fenceLength = backtickRuns
    ? Math.max(...backtickRuns.map((run) => run.length)) + 1
    : 1;
  const fence = '`'.repeat(fenceLength);
  const padded = sanitized.startsWith('`') || sanitized.endsWith('`')
    ? ` ${sanitized} `
    : sanitized;

  return `${fence}${padded}${fence}`;
}
