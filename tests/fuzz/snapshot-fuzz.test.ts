import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { convertSnapshot, Snap2DBMLError } from '../../src/index.js';
import type { DirectusSnapshot } from '../../src/types.js';

describe('fuzz tests', () => {
  it('should never throw an unhandled exception for arbitrary objects', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        try {
          convertSnapshot(input as DirectusSnapshot, { suppressWarnings: true });
          return true;
        } catch (e) {
          // Must be our error type, not an unhandled crash
          return e instanceof Snap2DBMLError;
        }
      }),
      { numRuns: 500 },
    );
  });

  it('should never throw an unhandled exception for arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        try {
          convertSnapshot(input as unknown as DirectusSnapshot, { suppressWarnings: true });
          return true;
        } catch (e) {
          return e instanceof Snap2DBMLError;
        }
      }),
      { numRuns: 500 },
    );
  });

  it('should handle objects with random properties', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.anything()), (input) => {
        try {
          convertSnapshot(input as unknown as DirectusSnapshot, { suppressWarnings: true });
          return true;
        } catch (e) {
          return e instanceof Snap2DBMLError;
        }
      }),
      { numRuns: 500 },
    );
  });

  it('should produce valid DBML for valid snapshots', () => {
    const arbitraryField = fc.record({
      collection: fc.constant('test_table'),
      field: fc.stringMatching(/^[a-z][a-z0-9_]{0,20}$/),
      type: fc.constantFrom('string', 'integer', 'boolean', 'text', 'uuid', 'timestamp'),
      meta: fc.record({
        id: fc.nat(),
        collection: fc.constant('test_table'),
        field: fc.stringMatching(/^[a-z][a-z0-9_]{0,20}$/),
      }),
      schema: fc.record({
        name: fc.stringMatching(/^[a-z][a-z0-9_]{0,20}$/),
        table: fc.constant('test_table'),
        data_type: fc.constantFrom('varchar(255)', 'integer', 'boolean', 'text', 'uuid', 'timestamp'),
        is_nullable: fc.boolean(),
        is_primary_key: fc.constant(false),
      }),
    });

    const arbitrarySnapshot = fc.record({
      version: fc.constantFrom(1, 4),
      directus: fc.constantFrom('10.10.0', '11.0.0'),
      collections: fc.constant([
        {
          collection: 'test_table',
          meta: { collection: 'test_table', hidden: false, singleton: false },
          schema: { name: 'test_table' },
        },
      ]),
      fields: fc.tuple(
        fc.constant({
          collection: 'test_table',
          field: 'id',
          type: 'uuid',
          meta: { id: 0, collection: 'test_table', field: 'id' },
          schema: { name: 'id', table: 'test_table', data_type: 'uuid', is_nullable: false, is_primary_key: true },
        }),
        fc.uniqueArray(arbitraryField, {
          maxLength: 10,
          selector: (f) => f.field,
          comparator: (a, b) => a === b,
        }),
      ).map(([pk, fields]) => {
        // Ensure no field conflicts with 'id'
        const filtered = fields.filter((f) => f.field !== 'id');
        return [pk, ...filtered];
      }),
      relations: fc.constant([]),
    });

    fc.assert(
      fc.property(arbitrarySnapshot as fc.Arbitrary<DirectusSnapshot>, (snapshot) => {
        const result = convertSnapshot(snapshot, { suppressWarnings: true });
        return typeof result === 'string' && result.length > 0 && result.includes('Table test_table {');
      }),
      { numRuns: 100 },
    );
  });
});
