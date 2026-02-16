import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateDBML } from '../../src/generator.js';
import { transformSnapshot } from '../../src/transformer.js';
import { parseSnapshot } from '../../src/parser.js';
import type { SchemaModel, TableModel, ColumnModel, ReferenceModel, DirectusSnapshot } from '../../src/types.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): DirectusSnapshot {
  const raw = readFileSync(resolve(fixturesDir, name), 'utf-8');
  return parseSnapshot(JSON.parse(raw));
}

function fullPipeline(fixtureName: string, options?: { includeComments?: boolean; includeSystem?: boolean }): string {
  const snapshot = loadFixture(fixtureName);
  const result = transformSnapshot(snapshot, options);
  return generateDBML(result.schema, options);
}

function makeSchema(tables: TableModel[], references: ReferenceModel[] = []): SchemaModel {
  return {
    tables,
    references,
    metadata: { directusVersion: '10.0.0', snapshotVersion: 1, generatedAt: '2024-01-01' },
  };
}

function makeTable(name: string, columns: ColumnModel[], comment?: string): TableModel {
  return { name, columns, isSystem: false, comment };
}

function makeCol(name: string, type: string, opts: Partial<ColumnModel> = {}): ColumnModel {
  return { name, type, isPrimaryKey: false, isNullable: true, ...opts };
}

describe('generateDBML', () => {
  describe('table generation', () => {
    it('should generate a simple table', () => {
      const schema = makeSchema([
        makeTable('users', [
          makeCol('id', 'uuid', { isPrimaryKey: true, isNullable: false }),
          makeCol('name', 'varchar(255)', { isNullable: false }),
        ]),
      ]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain('Table users {');
      expect(dbml).toContain('  id uuid [pk]');
      expect(dbml).toContain('  name varchar(255) [not null]');
      expect(dbml).toContain('}');
    });

    it('should sort tables alphabetically', () => {
      const schema = makeSchema([
        makeTable('zebras', [makeCol('id', 'int', { isPrimaryKey: true })]),
        makeTable('apples', [makeCol('id', 'int', { isPrimaryKey: true })]),
        makeTable('Bananas', [makeCol('id', 'int', { isPrimaryKey: true })]),
      ]);
      const dbml = generateDBML(schema);
      const tableOrder = [...dbml.matchAll(/Table (\w+) \{/g)].map((m) => m[1]);
      expect(tableOrder).toEqual(['apples', 'Bananas', 'zebras']);
    });

    it('should add blank line between tables', () => {
      const schema = makeSchema([
        makeTable('a', [makeCol('id', 'int', { isPrimaryKey: true })]),
        makeTable('b', [makeCol('id', 'int', { isPrimaryKey: true })]),
      ]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain('}\n\nTable');
    });
  });

  describe('column sorting', () => {
    it('should put primary keys first, then alphabetical', () => {
      const schema = makeSchema([
        makeTable('test', [
          makeCol('zebra', 'text'),
          makeCol('alpha', 'text'),
          makeCol('id', 'int', { isPrimaryKey: true }),
        ]),
      ]);
      const dbml = generateDBML(schema);
      const lines = dbml.split('\n').filter((l) => l.startsWith('  ') && !l.startsWith('  Note'));
      expect(lines[0]).toContain('id');
      expect(lines[1]).toContain('alpha');
      expect(lines[2]).toContain('zebra');
    });
  });

  describe('column settings', () => {
    it('should add [pk] for primary keys', () => {
      const schema = makeSchema([
        makeTable('t', [makeCol('id', 'int', { isPrimaryKey: true, isNullable: false })]),
      ]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain('id int [pk]');
    });

    it('should add [not null] for non-nullable, non-PK columns', () => {
      const schema = makeSchema([
        makeTable('t', [makeCol('name', 'text', { isNullable: false })]),
      ]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain('name text [not null]');
    });

    it('should not add [not null] redundantly on PK columns', () => {
      const schema = makeSchema([
        makeTable('t', [makeCol('id', 'int', { isPrimaryKey: true, isNullable: false })]),
      ]);
      const dbml = generateDBML(schema);
      expect(dbml).not.toContain('pk, not null');
    });

    it('should add default values', () => {
      const schema = makeSchema([
        makeTable('t', [makeCol('active', 'boolean', { defaultValue: 'true' })]),
      ]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain("default: true");
    });

    it('should combine multiple settings', () => {
      const schema = makeSchema([
        makeTable('t', [
          makeCol('email', 'varchar(255)', { isNullable: false, defaultValue: "'test@test.com'" }),
        ]),
      ]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain("[not null, default: 'test@test.com']");
    });

    it('should not add settings for nullable columns without defaults', () => {
      const schema = makeSchema([
        makeTable('t', [makeCol('notes', 'text')]),
      ]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain('  notes text\n');
    });
  });

  describe('comments/notes', () => {
    it('should not include notes by default', () => {
      const schema = makeSchema([
        makeTable('t', [makeCol('id', 'int', { isPrimaryKey: true })], 'A table comment'),
      ]);
      const dbml = generateDBML(schema);
      expect(dbml).not.toContain('Note');
    });

    it('should include table-level note when includeComments is true', () => {
      const schema = makeSchema([
        makeTable('t', [makeCol('id', 'int', { isPrimaryKey: true })], 'A table comment'),
      ]);
      const dbml = generateDBML(schema, { includeComments: true });
      expect(dbml).toContain("  Note: 'A table comment'");
    });

    it('should include column-level note when includeComments is true', () => {
      const schema = makeSchema([
        makeTable('t', [makeCol('id', 'int', { isPrimaryKey: true, comment: 'Primary key' })]),
      ]);
      const dbml = generateDBML(schema, { includeComments: true });
      expect(dbml).toContain("note: 'Primary key'");
    });

    it('should escape single quotes in notes', () => {
      const schema = makeSchema([
        makeTable('t', [makeCol('id', 'int', { isPrimaryKey: true })], "It's a test"),
      ]);
      const dbml = generateDBML(schema, { includeComments: true });
      expect(dbml).toContain("It\\'s a test");
    });
  });

  describe('virtual fields', () => {
    it('should render virtual fields as columns', () => {
      const table = makeTable('brokers', [makeCol('id', 'int', { isPrimaryKey: true })]);
      table.virtualFields = [{ name: 'deals_id', kind: 'o2m' }];
      const schema = makeSchema([table]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain("  deals_id virtual [note: 'o2m']");
    });

    it('should render virtual fields with related collection', () => {
      const table = makeTable('brokers', [makeCol('id', 'int', { isPrimaryKey: true })]);
      table.virtualFields = [{ name: 'deals_id', kind: 'o2m', relatedCollection: 'deals' }];
      const schema = makeSchema([table]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain("  deals_id virtual [note: 'o2m → deals']");
    });

    it('should sort virtual fields alphabetically', () => {
      const table = makeTable('brokers', [makeCol('id', 'int', { isPrimaryKey: true })]);
      table.virtualFields = [
        { name: 'transactions_id', kind: 'o2m' },
        { name: 'deals_id', kind: 'o2m' },
        { name: 'leads_id', kind: 'o2m' },
      ];
      const schema = makeSchema([table]);
      const dbml = generateDBML(schema);
      const virtualLines = dbml.split('\n').filter((l) => l.includes('virtual'));
      expect(virtualLines).toHaveLength(3);
      expect(virtualLines[0]).toContain('deals_id');
      expect(virtualLines[1]).toContain('leads_id');
      expect(virtualLines[2]).toContain('transactions_id');
    });

    it('should place virtual fields after regular columns', () => {
      const table = makeTable('brokers', [makeCol('id', 'int', { isPrimaryKey: true })]);
      table.virtualFields = [{ name: 'deals_id', kind: 'o2m' }];
      const schema = makeSchema([table]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain("id int [pk]\n  deals_id virtual [note: 'o2m']");
    });

    it('should not render virtual fields section when array is empty', () => {
      const table = makeTable('brokers', [makeCol('id', 'int', { isPrimaryKey: true })]);
      table.virtualFields = [];
      const schema = makeSchema([table]);
      const dbml = generateDBML(schema);
      expect(dbml).not.toContain('//');
    });

    it('should not render virtual fields section when undefined', () => {
      const table = makeTable('brokers', [makeCol('id', 'int', { isPrimaryKey: true })]);
      const schema = makeSchema([table]);
      const dbml = generateDBML(schema);
      expect(dbml).not.toContain('//');
    });
  });

  describe('references', () => {
    it('should generate M2O reference with >', () => {
      const schema = makeSchema(
        [
          makeTable('posts', [makeCol('id', 'int', { isPrimaryKey: true }), makeCol('author_id', 'int')]),
          makeTable('authors', [makeCol('id', 'int', { isPrimaryKey: true })]),
        ],
        [{ fromTable: 'posts', fromColumn: 'author_id', toTable: 'authors', toColumn: 'id', relation: '>' }],
      );
      const dbml = generateDBML(schema);
      expect(dbml).toContain('Ref: posts.author_id > authors.id');
    });

    it('should generate O2O reference with -', () => {
      const schema = makeSchema(
        [makeTable('a', [makeCol('id', 'int', { isPrimaryKey: true })]), makeTable('b', [makeCol('id', 'int', { isPrimaryKey: true })])],
        [{ fromTable: 'a', fromColumn: 'b_id', toTable: 'b', toColumn: 'id', relation: '-' }],
      );
      const dbml = generateDBML(schema);
      expect(dbml).toContain('Ref: a.b_id - b.id');
    });

    it('should sort references by fromTable.fromColumn', () => {
      const schema = makeSchema(
        [
          makeTable('a', [makeCol('id', 'int', { isPrimaryKey: true })]),
          makeTable('b', [makeCol('id', 'int', { isPrimaryKey: true })]),
        ],
        [
          { fromTable: 'b', fromColumn: 'a_id', toTable: 'a', toColumn: 'id', relation: '>' },
          { fromTable: 'a', fromColumn: 'b_id', toTable: 'b', toColumn: 'id', relation: '>' },
        ],
      );
      const dbml = generateDBML(schema);
      const refs = dbml.split('\n').filter((l) => l.startsWith('Ref:'));
      expect(refs[0]).toContain('a.b_id');
      expect(refs[1]).toContain('b.a_id');
    });

    it('should add blank line before refs section', () => {
      const schema = makeSchema(
        [makeTable('a', [makeCol('id', 'int', { isPrimaryKey: true })])],
        [{ fromTable: 'a', fromColumn: 'b_id', toTable: 'b', toColumn: 'id', relation: '>' }],
      );
      const dbml = generateDBML(schema);
      expect(dbml).toContain('}\n\nRef:');
    });
  });

  describe('quoting', () => {
    it('should quote names with special characters', () => {
      const schema = makeSchema([
        makeTable('my table', [makeCol('my column', 'text')]),
      ]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain('Table "my table"');
      expect(dbml).toContain('"my column"');
    });

    it('should quote non-ASCII names', () => {
      const dbml = fullPipeline('utf8-names.json');
      expect(dbml).toContain('"categorías"');
      expect(dbml).toContain('"製品"');
    });

    it('should not quote simple alphanumeric names', () => {
      const schema = makeSchema([makeTable('users', [makeCol('id', 'int', { isPrimaryKey: true })])]);
      const dbml = generateDBML(schema);
      expect(dbml).toContain('Table users {');
      expect(dbml).not.toContain('"users"');
    });
  });

  describe('determinism', () => {
    it('should produce identical output on multiple runs', () => {
      const output1 = fullPipeline('basic.json');
      const output2 = fullPipeline('basic.json');
      expect(output1).toBe(output2);
    });

    it('should produce identical output for relationships', () => {
      const output1 = fullPipeline('relationships-m2o.json');
      const output2 = fullPipeline('relationships-m2o.json');
      expect(output1).toBe(output2);
    });

    it('should produce identical output for M2M', () => {
      const output1 = fullPipeline('relationships-m2m.json');
      const output2 = fullPipeline('relationships-m2m.json');
      expect(output1).toBe(output2);
    });

    it('should use LF-only line endings', () => {
      const dbml = fullPipeline('basic.json');
      expect(dbml).not.toContain('\r');
    });

    it('should not have trailing whitespace on any line', () => {
      const dbml = fullPipeline('basic.json');
      for (const line of dbml.split('\n')) {
        expect(line).toBe(line.trimEnd());
      }
    });

    it('should end with a single trailing newline', () => {
      const dbml = fullPipeline('basic.json');
      expect(dbml.endsWith('\n')).toBe(true);
      expect(dbml.endsWith('\n\n')).toBe(false);
    });

    it('should use 2-space indentation', () => {
      const dbml = fullPipeline('basic.json');
      const indentedLines = dbml.split('\n').filter((l) => l.startsWith(' '));
      for (const line of indentedLines) {
        const indent = line.match(/^(\s*)/)?.[1] ?? '';
        expect(indent.length % 2).toBe(0);
        expect(indent).not.toContain('\t');
      }
    });
  });

  describe('full pipeline snapshots', () => {
    it('should generate valid DBML for basic fixture', () => {
      const dbml = fullPipeline('basic.json');
      expect(dbml).toContain('Table posts {');
      expect(dbml).toContain('id uuid [pk]');
      expect(dbml).toContain('title varchar(255) [not null]');
      expect(dbml).toContain('body text');
      expect(dbml).toContain('published boolean [not null, default: false]');
      expect(dbml).toContain('created_at timestamp [not null, default: `now()`]');
    });

    it('should generate valid DBML for M2O fixture', () => {
      const dbml = fullPipeline('relationships-m2o.json');
      expect(dbml).toContain('Table authors {');
      expect(dbml).toContain('Table posts {');
      expect(dbml).toContain('Ref: posts.author_id > authors.id');
    });

    it('should generate valid DBML for M2M fixture', () => {
      const dbml = fullPipeline('relationships-m2m.json');
      expect(dbml).toContain('Table posts {');
      expect(dbml).toContain('Table posts_tags {');
      expect(dbml).toContain('Table tags {');
      expect(dbml).toContain('Ref: posts_tags.posts_id > posts.id');
      expect(dbml).toContain('Ref: posts_tags.tags_id > tags.id');
    });

    it('should generate valid DBML for v11 fixture', () => {
      const dbml = fullPipeline('directus-11.json');
      expect(dbml).toContain('Table articles {');
      expect(dbml).toContain('id int [pk]');
    });

    it('should handle comments in full pipeline', () => {
      const dbml = fullPipeline('basic.json', { includeComments: true });
      expect(dbml).toContain("Note: 'Blog posts'");
    });
  });
});
