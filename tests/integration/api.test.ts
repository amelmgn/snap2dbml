import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  convertSnapshot,
  convertSnapshotString,
  convertSnapshotWithStats,
  InvalidSnapshotError,
  FileTooLargeError,
  CircularReferenceError,
  Snap2DBMLError,
  ERROR_CODES,
  WARNING_CODES,
} from '../../src/index.js';
import type { DirectusSnapshot } from '../../src/types.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixtureJSON(name: string): DirectusSnapshot {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), 'utf-8'));
}

function loadFixtureString(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('convertSnapshot', () => {
  it('should return a DBML string for a valid snapshot', () => {
    const snapshot = loadFixtureJSON('basic.json');
    const result = convertSnapshot(snapshot, { suppressWarnings: true });
    expect(typeof result).toBe('string');
    expect(result).toContain('Table posts {');
  });

  it('should throw InvalidSnapshotError for invalid input', () => {
    expect(() => convertSnapshot({} as DirectusSnapshot, { suppressWarnings: true }))
      .toThrow(InvalidSnapshotError);
  });

  it('should respect includeSystem option', () => {
    const snapshot = loadFixtureJSON('with-system-tables.json');
    const without = convertSnapshot(snapshot, { suppressWarnings: true });
    const withSystem = convertSnapshot(snapshot, { includeSystem: true, suppressWarnings: true });
    expect(without).not.toContain('directus_users');
    expect(withSystem).toContain('directus_users');
  });

  it('should respect includeComments option', () => {
    const snapshot = loadFixtureJSON('basic.json');
    const without = convertSnapshot(snapshot, { suppressWarnings: true });
    const withComments = convertSnapshot(snapshot, { includeComments: true, suppressWarnings: true });
    expect(without).not.toContain('Note');
    expect(withComments).toContain('Blog posts');
  });

  it('should write warnings to stderr when not suppressed', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const snapshot = loadFixtureJSON('all-types.json');
    convertSnapshot(snapshot);
    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('UNKNOWN_FIELD_TYPE'))).toBe(true);
    spy.mockRestore();
  });

  it('should not write warnings when suppressWarnings is true', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const snapshot = loadFixtureJSON('all-types.json');
    convertSnapshot(snapshot, { suppressWarnings: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should throw CircularReferenceError when failOnCircularReference is true', () => {
    const snapshot = loadFixtureJSON('circular-refs.json');
    expect(() => convertSnapshot(snapshot, { failOnCircularReference: true, suppressWarnings: true }))
      .toThrow(CircularReferenceError);
  });
});

describe('convertSnapshotString', () => {
  it('should accept a JSON string and return DBML', () => {
    const json = loadFixtureString('basic.json');
    const result = convertSnapshotString(json, { suppressWarnings: true });
    expect(result).toContain('Table posts {');
  });

  it('should throw InvalidSnapshotError for invalid JSON', () => {
    expect(() => convertSnapshotString('not json', { suppressWarnings: true }))
      .toThrow(InvalidSnapshotError);
  });

  it('should throw InvalidSnapshotError for valid JSON but invalid snapshot', () => {
    expect(() => convertSnapshotString('{"foo": 1}', { suppressWarnings: true }))
      .toThrow(InvalidSnapshotError);
  });

  it('should throw FileTooLargeError when maxSizeBytes is exceeded', () => {
    const json = loadFixtureString('basic.json');
    expect(() => convertSnapshotString(json, { maxSizeBytes: 10, suppressWarnings: true }))
      .toThrow(FileTooLargeError);
  });
});

describe('convertSnapshotWithStats', () => {
  it('should return DBML in the result', () => {
    const snapshot = loadFixtureJSON('basic.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(result.dbml).toContain('Table posts {');
  });

  it('should return correct table count', () => {
    const snapshot = loadFixtureJSON('basic.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(result.stats.tablesProcessed).toBe(1);
  });

  it('should return correct fields count', () => {
    const snapshot = loadFixtureJSON('basic.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(result.stats.fieldsProcessed).toBe(5);
  });

  it('should return correct relations count for M2O', () => {
    const snapshot = loadFixtureJSON('relationships-m2o.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(result.stats.relationsProcessed).toBe(1);
  });

  it('should return correct relations count for M2M', () => {
    const snapshot = loadFixtureJSON('relationships-m2m.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(result.stats.relationsProcessed).toBe(2);
  });

  it('should track excluded tables', () => {
    const snapshot = loadFixtureJSON('with-system-tables.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(result.stats.tablesExcluded).toBe(2);
  });

  it('should track skipped fields', () => {
    const snapshot = loadFixtureJSON('all-types.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(result.stats.fieldsSkipped).toBeGreaterThan(0);
  });

  it('should have a positive durationMs', () => {
    const snapshot = loadFixtureJSON('basic.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(result.stats.durationMs).toBeGreaterThan(0);
  });

  it('should populate metadata', () => {
    const snapshot = loadFixtureJSON('basic.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(result.metadata.directusVersion).toBe('10.10.0');
    expect(result.metadata.snapshotVersion).toBe(1);
    expect(result.metadata.snap2dbmlVersion).toBe('1.0.0');
    expect(result.metadata.generatedAt).toBeDefined();
  });

  it('should include warnings array', () => {
    const snapshot = loadFixtureJSON('all-types.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should track circular references', () => {
    const snapshot = loadFixtureJSON('circular-refs.json');
    const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
    expect(result.stats.circularReferences).toBeGreaterThan(0);
  });
});

describe('re-exports', () => {
  it('should export error classes', () => {
    expect(Snap2DBMLError).toBeDefined();
    expect(InvalidSnapshotError).toBeDefined();
    expect(CircularReferenceError).toBeDefined();
    expect(FileTooLargeError).toBeDefined();
  });

  it('should export error codes', () => {
    expect(ERROR_CODES.INVALID_SNAPSHOT).toBe('INVALID_SNAPSHOT');
    expect(ERROR_CODES.FILE_TOO_LARGE).toBe('FILE_TOO_LARGE');
  });

  it('should export warning codes', () => {
    expect(WARNING_CODES.UNKNOWN_FIELD_TYPE).toBe('UNKNOWN_FIELD_TYPE');
    expect(WARNING_CODES.INCOMPLETE_RELATION).toBe('INCOMPLETE_RELATION');
  });
});
