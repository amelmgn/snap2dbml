import { describe, it, expect } from 'vitest';
import { TYPE_MAP, SKIP_TYPES, mapDirectusType } from '../../src/type-map.js';

describe('TYPE_MAP', () => {
  it('should map all documented Directus types', () => {
    expect(TYPE_MAP.uuid).toBe('uuid');
    expect(TYPE_MAP.string).toBe('varchar(255)');
    expect(TYPE_MAP.text).toBe('text');
    expect(TYPE_MAP.integer).toBe('int');
    expect(TYPE_MAP.bigInteger).toBe('bigint');
    expect(TYPE_MAP.float).toBe('float');
    expect(TYPE_MAP.decimal).toBe('decimal(10,2)');
    expect(TYPE_MAP.boolean).toBe('boolean');
    expect(TYPE_MAP.timestamp).toBe('timestamp');
    expect(TYPE_MAP.dateTime).toBe('datetime');
    expect(TYPE_MAP.date).toBe('date');
    expect(TYPE_MAP.time).toBe('time');
    expect(TYPE_MAP.json).toBe('json');
    expect(TYPE_MAP.csv).toBe('text');
    expect(TYPE_MAP.hash).toBe('varchar(255)');
  });
});

describe('SKIP_TYPES', () => {
  it('should contain alias, presentation, and group', () => {
    expect(SKIP_TYPES.has('alias')).toBe(true);
    expect(SKIP_TYPES.has('presentation')).toBe(true);
    expect(SKIP_TYPES.has('group')).toBe(true);
  });

  it('should not contain regular types', () => {
    expect(SKIP_TYPES.has('string')).toBe(false);
    expect(SKIP_TYPES.has('integer')).toBe(false);
  });
});

describe('mapDirectusType', () => {
  describe('skip types', () => {
    it('should return skipped for alias type', () => {
      const result = mapDirectusType('alias');
      expect(result.skipped).toBe(true);
    });

    it('should return skipped for presentation type', () => {
      const result = mapDirectusType('presentation');
      expect(result.skipped).toBe(true);
    });

    it('should return skipped for group type', () => {
      const result = mapDirectusType('group');
      expect(result.skipped).toBe(true);
    });
  });

  describe('schema.data_type priority', () => {
    it('should prefer schema.data_type when available', () => {
      const result = mapDirectusType('string', 'varchar(100)');
      expect(result.dbmlType).toBe('varchar(100)');
      expect(result.skipped).toBe(false);
    });

    it('should fall back to TYPE_MAP when schema.data_type is null', () => {
      const result = mapDirectusType('string', null);
      expect(result.dbmlType).toBe('varchar(255)');
    });

    it('should fall back to TYPE_MAP when schema.data_type is unrecognized', () => {
      const result = mapDirectusType('string', 'completely_unknown_sql_type');
      expect(result.dbmlType).toBe('varchar(255)');
    });
  });

  describe('TYPE_MAP lookups', () => {
    it.each(Object.entries(TYPE_MAP))('should map Directus type "%s" to "%s"', (directusType, expected) => {
      const result = mapDirectusType(directusType);
      expect(result.dbmlType).toBe(expected);
      expect(result.skipped).toBe(false);
      expect(result.warning).toBeUndefined();
    });
  });

  describe('unknown types', () => {
    it('should return text with warning for unknown type', () => {
      const result = mapDirectusType('customWidget');
      expect(result.dbmlType).toBe('text');
      expect(result.skipped).toBe(false);
      expect(result.warning).toContain('customWidget');
    });

    it('should include data_type in warning when available', () => {
      const result = mapDirectusType('customWidget', 'weird_sql_type');
      expect(result.warning).toContain('customWidget');
      expect(result.warning).toContain('weird_sql_type');
    });
  });

  describe('SQL data_type normalization', () => {
    it('should normalize character varying to varchar', () => {
      const result = mapDirectusType('string', 'character varying(100)');
      expect(result.dbmlType).toBe('varchar(100)');
    });

    it('should normalize character varying without length', () => {
      const result = mapDirectusType('string', 'character varying');
      expect(result.dbmlType).toBe('varchar(255)');
    });

    it('should normalize timestamp with time zone', () => {
      const result = mapDirectusType('timestamp', 'timestamp with time zone');
      expect(result.dbmlType).toBe('timestamp');
    });

    it('should normalize boolean/bool', () => {
      expect(mapDirectusType('boolean', 'bool').dbmlType).toBe('boolean');
      expect(mapDirectusType('boolean', 'boolean').dbmlType).toBe('boolean');
    });

    it('should normalize numeric with precision', () => {
      const result = mapDirectusType('decimal', 'numeric(8, 2)');
      expect(result.dbmlType).toBe('decimal(8,2)');
    });

    it('should handle case-insensitive data types', () => {
      expect(mapDirectusType('uuid', 'UUID').dbmlType).toBe('uuid');
      expect(mapDirectusType('integer', 'INTEGER').dbmlType).toBe('int');
    });
  });
});
