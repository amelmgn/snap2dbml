#!/usr/bin/env node

/**
 * Generate a large Directus snapshot fixture for performance testing.
 * Creates 200 collections with ~10 fields each (2000+ fields) and ~100 relations.
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const COLLECTIONS_COUNT = 200;
const FIELDS_PER_TABLE = 10;
const RELATION_COUNT = 100;

const fieldTypes = ['uuid', 'string', 'text', 'integer', 'boolean', 'timestamp', 'json', 'float', 'date', 'time'];
const dataTypes = ['uuid', 'varchar(255)', 'text', 'integer', 'boolean', 'timestamp', 'json', 'float', 'date', 'time'];

const collections = [];
const fields = [];
const relations = [];

for (let i = 0; i < COLLECTIONS_COUNT; i++) {
  const name = `table_${String(i + 1).padStart(3, '0')}`;
  collections.push({
    collection: name,
    meta: { collection: name, icon: null, note: `Table ${i + 1}`, hidden: false, singleton: false },
    schema: { name },
  });

  // Primary key
  fields.push({
    collection: name,
    field: 'id',
    type: 'uuid',
    meta: { id: i * FIELDS_PER_TABLE + 1, collection: name, field: 'id' },
    schema: { name: 'id', table: name, data_type: 'uuid', is_nullable: false, is_primary_key: true },
  });

  // Additional fields
  for (let j = 1; j < FIELDS_PER_TABLE; j++) {
    const typeIdx = j % fieldTypes.length;
    const fieldName = `field_${j}`;
    fields.push({
      collection: name,
      field: fieldName,
      type: fieldTypes[typeIdx],
      meta: { id: i * FIELDS_PER_TABLE + j + 1, collection: name, field: fieldName },
      schema: {
        name: fieldName,
        table: name,
        data_type: dataTypes[typeIdx],
        is_nullable: j % 3 === 0,
        is_primary_key: false,
        ...(j === 1 ? { default_value: 'default_value' } : {}),
      },
    });
  }
}

// Create M2O relations between tables
for (let i = 0; i < RELATION_COUNT; i++) {
  const fromIdx = (i + 1) % COLLECTIONS_COUNT;
  const toIdx = i % COLLECTIONS_COUNT;
  const fromTable = `table_${String(fromIdx + 1).padStart(3, '0')}`;
  const toTable = `table_${String(toIdx + 1).padStart(3, '0')}`;
  const fkField = `fk_${toTable}`;

  // Add FK field
  fields.push({
    collection: fromTable,
    field: fkField,
    type: 'uuid',
    meta: { id: COLLECTIONS_COUNT * FIELDS_PER_TABLE + i + 1, collection: fromTable, field: fkField },
    schema: { name: fkField, table: fromTable, data_type: 'uuid', is_nullable: true, is_primary_key: false },
  });

  relations.push({
    collection: fromTable,
    field: fkField,
    related_collection: toTable,
    meta: {
      many_collection: fromTable,
      many_field: fkField,
      one_collection: toTable,
      one_field: null,
    },
  });
}

const snapshot = {
  version: 1,
  directus: '10.10.0',
  collections,
  fields,
  relations,
};

const outputPath = resolve(__dirname, 'large-schema.json');
writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf-8');
console.log(`Generated large fixture: ${COLLECTIONS_COUNT} collections, ${fields.length} fields, ${relations.length} relations`);
console.log(`Written to: ${outputPath}`);
