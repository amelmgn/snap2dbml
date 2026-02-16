export const TYPE_MAP: Record<string, string> = {
  uuid: 'uuid',
  string: 'varchar(255)',
  text: 'text',
  integer: 'int',
  bigInteger: 'bigint',
  float: 'float',
  decimal: 'decimal(10,2)',
  boolean: 'boolean',
  timestamp: 'timestamp',
  dateTime: 'datetime',
  date: 'date',
  time: 'time',
  json: 'json',
  csv: 'text',
  hash: 'varchar(255)',
};

export const SKIP_TYPES = new Set(['alias', 'presentation', 'group']);

export interface TypeMapResult {
  dbmlType: string;
  skipped: boolean;
  warning?: string;
}

/**
 * Maps a Directus field type to a DBML type.
 *
 * Resolution priority:
 * 1. schema.data_type if available (maps common SQL types)
 * 2. Directus type field via TYPE_MAP
 * 3. Fallback to 'text' with warning
 */
export function mapDirectusType(directusType: string, schemaDataType?: string | null): TypeMapResult {
  if (SKIP_TYPES.has(directusType)) {
    return { dbmlType: '', skipped: true };
  }

  // Prefer schema.data_type when available
  if (schemaDataType) {
    const normalized = normalizeDataType(schemaDataType);
    if (normalized) {
      return { dbmlType: normalized, skipped: false };
    }
  }

  // Fall back to Directus type map
  const mapped = TYPE_MAP[directusType];
  if (mapped) {
    return { dbmlType: mapped, skipped: false };
  }

  // Unknown type: fallback to text with warning
  return {
    dbmlType: 'text',
    skipped: false,
    warning: `Unknown field type '${directusType}'${schemaDataType ? ` (data_type: '${schemaDataType}')` : ''}. Mapped to 'text'.`,
  };
}

/** Normalize common SQL data_type values to DBML types */
function normalizeDataType(dataType: string): string | null {
  const lower = dataType.toLowerCase();

  const directMap: Record<string, string> = {
    uuid: 'uuid',
    text: 'text',
    json: 'json',
    jsonb: 'jsonb',
    boolean: 'boolean',
    bool: 'boolean',
    int: 'int',
    integer: 'int',
    bigint: 'bigint',
    smallint: 'smallint',
    float: 'float',
    double: 'double',
    real: 'real',
    numeric: 'numeric',
    decimal: 'decimal',
    date: 'date',
    time: 'time',
    timestamp: 'timestamp',
    datetime: 'datetime',
    serial: 'serial',
    bigserial: 'bigserial',
    bytea: 'bytea',
    blob: 'blob',
  };

  if (directMap[lower]) {
    return directMap[lower];
  }

  // Handle varchar/character varying with length
  if (lower.startsWith('character varying') || lower.startsWith('varchar')) {
    const match = lower.match(/\((\d+)\)/);
    return match ? `varchar(${match[1]})` : 'varchar(255)';
  }

  if (lower.startsWith('char') && !lower.startsWith('character varying')) {
    const match = lower.match(/\((\d+)\)/);
    return match ? `char(${match[1]})` : 'char(1)';
  }

  // Handle timestamp variants (e.g., "timestamp with time zone")
  if (lower.startsWith('timestamp')) {
    return 'timestamp';
  }

  // Handle numeric/decimal with precision
  if (lower.startsWith('numeric') || lower.startsWith('decimal')) {
    const match = lower.match(/\((\d+),\s*(\d+)\)/);
    return match ? `decimal(${match[1]},${match[2]})` : 'decimal';
  }

  return null;
}
