import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSnapshot } from '../../src/transformer.js';
import { parseSnapshot } from '../../src/parser.js';
import { CircularReferenceError } from '../../src/errors.js';
import { WARNING_CODES } from '../../src/constants.js';
import type { DirectusSnapshot } from '../../src/types.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): DirectusSnapshot {
  const raw = readFileSync(resolve(fixturesDir, name), 'utf-8');
  return parseSnapshot(JSON.parse(raw));
}

describe('transformSnapshot', () => {
  describe('table building', () => {
    it('should create tables from collections', () => {
      const snapshot = loadFixture('basic.json');
      const result = transformSnapshot(snapshot);
      expect(result.schema.tables).toHaveLength(1);
      expect(result.schema.tables[0].name).toBe('posts');
    });

    it('should create columns from fields', () => {
      const snapshot = loadFixture('basic.json');
      const result = transformSnapshot(snapshot);
      const posts = result.schema.tables[0];
      expect(posts.columns.length).toBeGreaterThan(0);
      expect(posts.columns.find((c) => c.name === 'id')).toBeDefined();
      expect(posts.columns.find((c) => c.name === 'title')).toBeDefined();
    });

    it('should identify primary keys', () => {
      const snapshot = loadFixture('basic.json');
      const result = transformSnapshot(snapshot);
      const posts = result.schema.tables[0];
      const idCol = posts.columns.find((c) => c.name === 'id')!;
      expect(idCol.isPrimaryKey).toBe(true);
      const titleCol = posts.columns.find((c) => c.name === 'title')!;
      expect(titleCol.isPrimaryKey).toBe(false);
    });

    it('should set nullable correctly', () => {
      const snapshot = loadFixture('basic.json');
      const result = transformSnapshot(snapshot);
      const posts = result.schema.tables[0];
      const idCol = posts.columns.find((c) => c.name === 'id')!;
      expect(idCol.isNullable).toBe(false);
      const bodyCol = posts.columns.find((c) => c.name === 'body')!;
      expect(bodyCol.isNullable).toBe(true);
    });

    it('should extract default values', () => {
      const snapshot = loadFixture('basic.json');
      const result = transformSnapshot(snapshot);
      const posts = result.schema.tables[0];
      const publishedCol = posts.columns.find((c) => c.name === 'published')!;
      expect(publishedCol.defaultValue).toBe('false');
      const createdAtCol = posts.columns.find((c) => c.name === 'created_at')!;
      expect(createdAtCol.defaultValue).toBe('`now()`');
    });

    it('should map field types correctly', () => {
      const snapshot = loadFixture('basic.json');
      const result = transformSnapshot(snapshot);
      const posts = result.schema.tables[0];
      expect(posts.columns.find((c) => c.name === 'id')!.type).toBe('uuid');
      expect(posts.columns.find((c) => c.name === 'title')!.type).toBe('varchar(255)');
      expect(posts.columns.find((c) => c.name === 'body')!.type).toBe('text');
      expect(posts.columns.find((c) => c.name === 'published')!.type).toBe('boolean');
    });
  });

  describe('system collection filtering', () => {
    it('should exclude system collections by default', () => {
      const snapshot = loadFixture('with-system-tables.json');
      const result = transformSnapshot(snapshot);
      expect(result.schema.tables).toHaveLength(1);
      expect(result.schema.tables[0].name).toBe('products');
      expect(result.tablesExcluded).toBe(2);
    });

    it('should include system collections when includeSystem is true', () => {
      const snapshot = loadFixture('with-system-tables.json');
      const result = transformSnapshot(snapshot, { includeSystem: true });
      expect(result.schema.tables).toHaveLength(3);
      expect(result.tablesExcluded).toBe(0);
    });

    it('should mark system tables as isSystem', () => {
      const snapshot = loadFixture('with-system-tables.json');
      const result = transformSnapshot(snapshot, { includeSystem: true });
      const systemTable = result.schema.tables.find((t) => t.name === 'directus_users')!;
      expect(systemTable.isSystem).toBe(true);
      const userTable = result.schema.tables.find((t) => t.name === 'products')!;
      expect(userTable.isSystem).toBe(false);
    });
  });

  describe('comments', () => {
    it('should not include comments by default', () => {
      const snapshot = loadFixture('basic.json');
      const result = transformSnapshot(snapshot);
      expect(result.schema.tables[0].comment).toBeUndefined();
    });

    it('should include table comments when includeComments is true', () => {
      const snapshot = loadFixture('basic.json');
      const result = transformSnapshot(snapshot, { includeComments: true });
      expect(result.schema.tables[0].comment).toBe('Blog posts');
    });
  });

  describe('skip types', () => {
    it('should skip alias, group, and presentation fields', () => {
      const snapshot = loadFixture('all-types.json');
      const result = transformSnapshot(snapshot);
      const table = result.schema.tables[0];
      expect(table.columns.find((c) => c.name === 'alias_field')).toBeUndefined();
      expect(table.columns.find((c) => c.name === 'group_field')).toBeUndefined();
      expect(result.fieldsSkipped).toBeGreaterThanOrEqual(2);
    });

    it('should warn about unknown field types', () => {
      const snapshot = loadFixture('all-types.json');
      const result = transformSnapshot(snapshot);
      const unknownWarning = result.warnings.find(
        (w) => w.code === WARNING_CODES.UNKNOWN_FIELD_TYPE && w.field === 'unknown_field',
      );
      expect(unknownWarning).toBeDefined();
    });

    it('should map unknown types to text', () => {
      const snapshot = loadFixture('all-types.json');
      const result = transformSnapshot(snapshot);
      const table = result.schema.tables[0];
      const unknownCol = table.columns.find((c) => c.name === 'unknown_field')!;
      expect(unknownCol.type).toBe('text');
    });
  });

  describe('virtual fields (alias relationships)', () => {
    it('should collect o2m alias fields as virtualFields', () => {
      const snapshot: DirectusSnapshot = {
        version: 1,
        directus: '10.10.0',
        collections: [
          { collection: 'brokers', meta: { collection: 'brokers', hidden: false, singleton: false }, schema: { name: 'brokers' } },
        ],
        fields: [
          { collection: 'brokers', field: 'id', type: 'integer', meta: { id: 1, collection: 'brokers', field: 'id' }, schema: { name: 'id', table: 'brokers', data_type: 'integer', is_nullable: false, is_primary_key: true } },
          { collection: 'brokers', field: 'deals_id', type: 'alias', meta: { id: 2, collection: 'brokers', field: 'deals_id', special: ['o2m'] }, schema: null },
        ],
        relations: [],
      };
      const result = transformSnapshot(snapshot);
      const table = result.schema.tables[0];
      expect(table.columns.find((c) => c.name === 'deals_id')).toBeUndefined();
      expect(table.virtualFields).toHaveLength(1);
      expect(table.virtualFields![0]).toEqual({ name: 'deals_id', kind: 'o2m' });
    });

    it('should collect m2m alias fields as virtualFields', () => {
      const snapshot: DirectusSnapshot = {
        version: 1,
        directus: '10.10.0',
        collections: [
          { collection: 'posts', meta: { collection: 'posts', hidden: false, singleton: false }, schema: { name: 'posts' } },
        ],
        fields: [
          { collection: 'posts', field: 'id', type: 'uuid', meta: { id: 1, collection: 'posts', field: 'id' }, schema: { name: 'id', table: 'posts', data_type: 'uuid', is_nullable: false, is_primary_key: true } },
          { collection: 'posts', field: 'tags', type: 'alias', meta: { id: 2, collection: 'posts', field: 'tags', special: ['m2m'] }, schema: null },
        ],
        relations: [],
      };
      const result = transformSnapshot(snapshot);
      const table = result.schema.tables[0];
      expect(table.virtualFields).toHaveLength(1);
      expect(table.virtualFields![0]).toEqual({ name: 'tags', kind: 'm2m' });
    });

    it('should collect translations alias fields as virtualFields', () => {
      const snapshot: DirectusSnapshot = {
        version: 1,
        directus: '10.10.0',
        collections: [
          { collection: 'pages', meta: { collection: 'pages', hidden: false, singleton: false }, schema: { name: 'pages' } },
        ],
        fields: [
          { collection: 'pages', field: 'id', type: 'uuid', meta: { id: 1, collection: 'pages', field: 'id' }, schema: { name: 'id', table: 'pages', data_type: 'uuid', is_nullable: false, is_primary_key: true } },
          { collection: 'pages', field: 'translations', type: 'alias', meta: { id: 2, collection: 'pages', field: 'translations', special: ['translations'] }, schema: null },
        ],
        relations: [],
      };
      const result = transformSnapshot(snapshot);
      const table = result.schema.tables[0];
      expect(table.virtualFields).toHaveLength(1);
      expect(table.virtualFields![0]).toEqual({ name: 'translations', kind: 'translations' });
    });

    it('should NOT collect UI group aliases as virtualFields', () => {
      const snapshot: DirectusSnapshot = {
        version: 1,
        directus: '10.10.0',
        collections: [
          { collection: 'items', meta: { collection: 'items', hidden: false, singleton: false }, schema: { name: 'items' } },
        ],
        fields: [
          { collection: 'items', field: 'id', type: 'uuid', meta: { id: 1, collection: 'items', field: 'id' }, schema: { name: 'id', table: 'items', data_type: 'uuid', is_nullable: false, is_primary_key: true } },
          { collection: 'items', field: 'Files', type: 'alias', meta: { id: 2, collection: 'items', field: 'Files', special: ['alias', 'no-data', 'group'] }, schema: null },
        ],
        relations: [],
      };
      const result = transformSnapshot(snapshot);
      const table = result.schema.tables[0];
      expect(table.virtualFields).toBeUndefined();
    });

    it('should not set virtualFields when there are no relationship aliases', () => {
      const snapshot = loadFixture('basic.json');
      const result = transformSnapshot(snapshot);
      const table = result.schema.tables[0];
      expect(table.virtualFields).toBeUndefined();
    });
  });

  describe('M2O relationships', () => {
    it('should create M2O reference with > symbol', () => {
      const snapshot = loadFixture('relationships-m2o.json');
      const result = transformSnapshot(snapshot);
      expect(result.schema.references).toHaveLength(1);
      const ref = result.schema.references[0];
      expect(ref.fromTable).toBe('posts');
      expect(ref.fromColumn).toBe('author_id');
      expect(ref.toTable).toBe('authors');
      expect(ref.toColumn).toBe('id');
      expect(ref.relation).toBe('>');
    });
  });

  describe('M2M relationships', () => {
    it('should create two references from junction table', () => {
      const snapshot = loadFixture('relationships-m2m.json');
      const result = transformSnapshot(snapshot);
      expect(result.schema.references).toHaveLength(2);

      const postsRef = result.schema.references.find((r) => r.toTable === 'posts');
      expect(postsRef).toBeDefined();
      expect(postsRef!.fromTable).toBe('posts_tags');
      expect(postsRef!.fromColumn).toBe('posts_id');
      expect(postsRef!.relation).toBe('>');

      const tagsRef = result.schema.references.find((r) => r.toTable === 'tags');
      expect(tagsRef).toBeDefined();
      expect(tagsRef!.fromTable).toBe('posts_tags');
      expect(tagsRef!.fromColumn).toBe('tags_id');
      expect(tagsRef!.relation).toBe('>');
    });

    it('should represent junction table as a full table with all columns', () => {
      const snapshot = loadFixture('relationships-m2m.json');
      const result = transformSnapshot(snapshot);
      const junction = result.schema.tables.find((t) => t.name === 'posts_tags')!;
      expect(junction).toBeDefined();
      expect(junction.columns.find((c) => c.name === 'id')).toBeDefined();
      expect(junction.columns.find((c) => c.name === 'posts_id')).toBeDefined();
      expect(junction.columns.find((c) => c.name === 'tags_id')).toBeDefined();
      expect(junction.columns.find((c) => c.name === 'sort_order')).toBeDefined();
    });
  });

  describe('incomplete and dangling relations', () => {
    it('should warn about relations with no meta', () => {
      const snapshot: DirectusSnapshot = {
        version: 1,
        directus: '10.10.0',
        collections: [
          { collection: 'a', meta: { collection: 'a', hidden: false, singleton: false }, schema: { name: 'a' } },
        ],
        fields: [
          { collection: 'a', field: 'id', type: 'uuid', meta: { id: 1, collection: 'a', field: 'id' }, schema: { name: 'id', table: 'a', data_type: 'uuid', is_nullable: false, is_primary_key: true } },
        ],
        relations: [
          { collection: 'a', field: 'b_id', related_collection: 'b', meta: null },
        ],
      };
      const result = transformSnapshot(snapshot);
      expect(result.warnings.some((w) => w.code === WARNING_CODES.INCOMPLETE_RELATION)).toBe(true);
    });

    it('should warn about dangling relations (filtered-out collection)', () => {
      const snapshot: DirectusSnapshot = {
        version: 1,
        directus: '10.10.0',
        collections: [
          { collection: 'posts', meta: { collection: 'posts', hidden: false, singleton: false }, schema: { name: 'posts' } },
          { collection: 'directus_users', meta: { collection: 'directus_users', hidden: true, singleton: false }, schema: { name: 'directus_users' } },
        ],
        fields: [
          { collection: 'posts', field: 'id', type: 'uuid', meta: { id: 1, collection: 'posts', field: 'id' }, schema: { name: 'id', table: 'posts', data_type: 'uuid', is_nullable: false, is_primary_key: true } },
          { collection: 'posts', field: 'user_id', type: 'uuid', meta: { id: 2, collection: 'posts', field: 'user_id' }, schema: { name: 'user_id', table: 'posts', data_type: 'uuid', is_nullable: true, is_primary_key: false } },
          { collection: 'directus_users', field: 'id', type: 'uuid', meta: { id: 3, collection: 'directus_users', field: 'id' }, schema: { name: 'id', table: 'directus_users', data_type: 'uuid', is_nullable: false, is_primary_key: true } },
        ],
        relations: [
          { collection: 'posts', field: 'user_id', related_collection: 'directus_users', meta: { many_collection: 'posts', many_field: 'user_id', one_collection: 'directus_users', one_field: null } },
        ],
      };
      const result = transformSnapshot(snapshot);
      expect(result.warnings.some((w) => w.code === WARNING_CODES.DANGLING_RELATION)).toBe(true);
      expect(result.schema.references).toHaveLength(0);
    });
  });

  describe('circular reference detection', () => {
    it('should detect circular references', () => {
      const snapshot = loadFixture('circular-refs.json');
      const result = transformSnapshot(snapshot);
      expect(result.circularReferences.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.code === WARNING_CODES.CIRCULAR_REFERENCE_DETECTED)).toBe(true);
    });

    it('should not report circular references when there are none', () => {
      const snapshot = loadFixture('relationships-m2o.json');
      const result = transformSnapshot(snapshot);
      expect(result.circularReferences).toHaveLength(0);
    });

    it('should throw CircularReferenceError when failOnCircularReference is true', () => {
      const snapshot = loadFixture('circular-refs.json');
      expect(() => transformSnapshot(snapshot, { failOnCircularReference: true }))
        .toThrow(CircularReferenceError);
    });
  });

  describe('metadata', () => {
    it('should populate metadata from snapshot', () => {
      const snapshot = loadFixture('basic.json');
      const result = transformSnapshot(snapshot);
      expect(result.schema.metadata.directusVersion).toBe('10.10.0');
      expect(result.schema.metadata.snapshotVersion).toBe(1);
      expect(result.schema.metadata.generatedAt).toBeDefined();
    });

    it('should handle v11 metadata', () => {
      const snapshot = loadFixture('directus-11.json');
      const result = transformSnapshot(snapshot);
      expect(result.schema.metadata.directusVersion).toBe('11.0.0');
      expect(result.schema.metadata.snapshotVersion).toBe(4);
    });
  });

  describe('UTF-8 names', () => {
    it('should handle non-ASCII collection and field names', () => {
      const snapshot = loadFixture('utf8-names.json');
      const result = transformSnapshot(snapshot);
      expect(result.schema.tables.find((t) => t.name === 'categorías')).toBeDefined();
      expect(result.schema.tables.find((t) => t.name === '製品')).toBeDefined();
      const cat = result.schema.tables.find((t) => t.name === 'categorías')!;
      expect(cat.columns.find((c) => c.name === 'nombre')).toBeDefined();
    });
  });
});
