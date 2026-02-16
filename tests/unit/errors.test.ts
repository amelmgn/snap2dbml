import { describe, it, expect } from 'vitest';
import {
  Snap2DBMLError,
  InvalidSnapshotError,
  UnsupportedFieldError,
  CircularReferenceError,
  FileTooLargeError,
  ValidationError,
} from '../../src/errors.js';

describe('Error Classes', () => {
  describe('InvalidSnapshotError', () => {
    it('should have correct code and exit code', () => {
      const err = new InvalidSnapshotError('test');
      expect(err.code).toBe('INVALID_SNAPSHOT');
      expect(err.getExitCode()).toBe(1);
    });

    it('should be an instance of Snap2DBMLError and Error', () => {
      const err = new InvalidSnapshotError('test');
      expect(err).toBeInstanceOf(Snap2DBMLError);
      expect(err).toBeInstanceOf(Error);
    });

    it('should include path and validation errors when provided', () => {
      const err = new InvalidSnapshotError('bad input', {
        path: 'root.collections',
        validationErrors: ['missing field', 'wrong type'],
      });
      expect(err.path).toBe('root.collections');
      expect(err.validationErrors).toEqual(['missing field', 'wrong type']);
    });

    it('should have a default suggestion', () => {
      const err = new InvalidSnapshotError('test');
      expect(err.suggestion).toBe('Ensure you are using a valid Directus snapshot file.');
    });

    it('should accept a custom suggestion', () => {
      const err = new InvalidSnapshotError('test', { suggestion: 'Custom suggestion' });
      expect(err.suggestion).toBe('Custom suggestion');
    });

    it('should set name to class name', () => {
      const err = new InvalidSnapshotError('test');
      expect(err.name).toBe('InvalidSnapshotError');
    });
  });

  describe('UnsupportedFieldError', () => {
    it('should have correct code and exit code (warning only)', () => {
      const err = new UnsupportedFieldError('myField', 'customType');
      expect(err.code).toBe('UNSUPPORTED_FIELD_TYPE');
      expect(err.getExitCode()).toBe(0);
    });

    it('should store field name and type', () => {
      const err = new UnsupportedFieldError('myField', 'customType');
      expect(err.fieldName).toBe('myField');
      expect(err.fieldType).toBe('customType');
    });

    it('should have a descriptive message', () => {
      const err = new UnsupportedFieldError('myField', 'customType');
      expect(err.message).toContain('customType');
      expect(err.message).toContain('myField');
    });

    it('should be an instance of Snap2DBMLError', () => {
      const err = new UnsupportedFieldError('f', 't');
      expect(err).toBeInstanceOf(Snap2DBMLError);
    });
  });

  describe('CircularReferenceError', () => {
    it('should have correct code and exit code', () => {
      const err = new CircularReferenceError(['A', 'B', 'A']);
      expect(err.code).toBe('CIRCULAR_REFERENCE');
      expect(err.getExitCode()).toBe(5);
    });

    it('should store the chain', () => {
      const chain = ['users', 'posts', 'comments', 'users'];
      const err = new CircularReferenceError(chain);
      expect(err.chain).toEqual(chain);
    });

    it('should format chain in message', () => {
      const err = new CircularReferenceError(['A', 'B', 'A']);
      expect(err.message).toContain('A -> B -> A');
    });
  });

  describe('FileTooLargeError', () => {
    it('should have correct code and exit code', () => {
      const err = new FileTooLargeError(100 * 1024 * 1024, 50 * 1024 * 1024);
      expect(err.code).toBe('FILE_TOO_LARGE');
      expect(err.getExitCode()).toBe(4);
    });

    it('should store actual and max sizes', () => {
      const err = new FileTooLargeError(100, 50);
      expect(err.actualSize).toBe(100);
      expect(err.maxSize).toBe(50);
    });

    it('should format sizes in MB in message', () => {
      const err = new FileTooLargeError(100 * 1024 * 1024, 50 * 1024 * 1024);
      expect(err.message).toContain('100.0MB');
      expect(err.message).toContain('50.0MB');
    });
  });

  describe('ValidationError', () => {
    it('should have correct code and exit code', () => {
      const err = new ValidationError('invalid');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.getExitCode()).toBe(1);
    });

    it('should accept custom suggestion', () => {
      const err = new ValidationError('invalid', 'fix it');
      expect(err.suggestion).toBe('fix it');
    });

    it('should be an instance of Snap2DBMLError', () => {
      const err = new ValidationError('invalid');
      expect(err).toBeInstanceOf(Snap2DBMLError);
    });
  });
});
