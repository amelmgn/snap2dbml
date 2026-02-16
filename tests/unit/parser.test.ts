import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSnapshot, parseSnapshotString } from '../../src/parser.js';
import { InvalidSnapshotError, FileTooLargeError } from '../../src/errors.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

function loadFixtureJSON(name: string): unknown {
  return JSON.parse(loadFixture(name));
}

describe('parseSnapshot', () => {
  it('should parse a valid basic v10 snapshot', () => {
    const input = loadFixtureJSON('basic.json');
    const result = parseSnapshot(input);
    expect(result.version).toBe(1);
    expect(result.directus).toBe('10.10.0');
    expect(result.collections).toHaveLength(1);
    expect(result.fields).toHaveLength(5);
    expect(result.relations).toHaveLength(0);
  });

  it('should parse a valid v11 snapshot', () => {
    const input = loadFixtureJSON('directus-11.json');
    const result = parseSnapshot(input);
    expect(result.version).toBe(4);
    expect(result.directus).toBe('11.0.0');
  });

  it('should parse snapshot with relationships', () => {
    const input = loadFixtureJSON('relationships-m2o.json');
    const result = parseSnapshot(input);
    expect(result.collections).toHaveLength(2);
    expect(result.relations).toHaveLength(1);
  });

  it('should parse snapshot with M2M relationships', () => {
    const input = loadFixtureJSON('relationships-m2m.json');
    const result = parseSnapshot(input);
    expect(result.collections).toHaveLength(3);
    expect(result.relations).toHaveLength(2);
  });

  it('should parse snapshot with UTF-8 names', () => {
    const input = loadFixtureJSON('utf8-names.json');
    const result = parseSnapshot(input);
    expect(result.collections).toHaveLength(2);
    expect(result.collections[0].collection).toBe('categorías');
    expect(result.collections[1].collection).toBe('製品');
  });

  it('should throw InvalidSnapshotError for null input', () => {
    expect(() => parseSnapshot(null)).toThrow(InvalidSnapshotError);
  });

  it('should throw InvalidSnapshotError for undefined input', () => {
    expect(() => parseSnapshot(undefined)).toThrow(InvalidSnapshotError);
  });

  it('should throw InvalidSnapshotError for array input', () => {
    expect(() => parseSnapshot([])).toThrow(InvalidSnapshotError);
  });

  it('should throw InvalidSnapshotError for string input', () => {
    expect(() => parseSnapshot('hello')).toThrow(InvalidSnapshotError);
  });

  it('should throw for missing version', () => {
    expect(() => parseSnapshot({ directus: '10.0.0', collections: [], fields: [], relations: [] }))
      .toThrow(/version/);
  });

  it('should throw for unsupported version', () => {
    const input = loadFixtureJSON('malformed/wrong-version.json');
    expect(() => parseSnapshot(input)).toThrow(/Unsupported snapshot version/);
  });

  it('should throw for missing directus property', () => {
    expect(() => parseSnapshot({ version: 1, collections: [], fields: [], relations: [] }))
      .toThrow(/directus/);
  });

  it('should throw for missing collections', () => {
    const input = loadFixtureJSON('malformed/missing-collections.json');
    expect(() => parseSnapshot(input)).toThrow(/collections/);
  });

  it('should throw for missing fields', () => {
    const input = loadFixtureJSON('malformed/missing-fields.json');
    expect(() => parseSnapshot(input)).toThrow(/fields/);
  });

  it('should throw for missing relations', () => {
    const input = loadFixtureJSON('malformed/missing-relations.json');
    expect(() => parseSnapshot(input)).toThrow(/relations/);
  });

  it('should throw for duplicate collection names', () => {
    const input = loadFixtureJSON('malformed/duplicate-collections.json');
    expect(() => parseSnapshot(input)).toThrow(/Duplicate collection/);
  });

  it('should accept empty collections, fields, and relations arrays', () => {
    const input = { version: 1, directus: '10.10.0', collections: [], fields: [], relations: [] };
    const result = parseSnapshot(input);
    expect(result.collections).toHaveLength(0);
  });
});

describe('parseSnapshotString', () => {
  it('should parse a valid JSON string', () => {
    const json = loadFixture('basic.json');
    const result = parseSnapshotString(json);
    expect(result.version).toBe(1);
    expect(result.collections).toHaveLength(1);
  });

  it('should throw InvalidSnapshotError for invalid JSON', () => {
    expect(() => parseSnapshotString('not json at all')).toThrow(InvalidSnapshotError);
    expect(() => parseSnapshotString('not json at all')).toThrow(/not valid JSON/);
  });

  it('should throw InvalidSnapshotError for empty string', () => {
    expect(() => parseSnapshotString('')).toThrow(InvalidSnapshotError);
  });

  it('should throw FileTooLargeError when input exceeds max size', () => {
    const json = loadFixture('basic.json');
    expect(() => parseSnapshotString(json, { maxSizeBytes: 10 })).toThrow(FileTooLargeError);
  });

  it('should not throw when input is within max size', () => {
    const json = loadFixture('basic.json');
    expect(() => parseSnapshotString(json, { maxSizeBytes: 10 * 1024 * 1024 })).not.toThrow();
  });

  it('should throw for valid JSON but invalid snapshot', () => {
    expect(() => parseSnapshotString('{"foo": "bar"}')).toThrow(InvalidSnapshotError);
  });

  it('should throw for JSON null', () => {
    expect(() => parseSnapshotString('null')).toThrow(InvalidSnapshotError);
  });
});
