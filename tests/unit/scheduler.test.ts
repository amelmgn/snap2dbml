import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseField, getNextRunMs } from '../../src/scheduler.js';

describe('parseField', () => {
  it('should parse a single value', () => {
    expect([...parseField('5', 0, 59, 'minute')]).toEqual([5]);
  });

  it('should parse a wildcard', () => {
    expect(parseField('*', 0, 23, 'hour').size).toBe(24);
  });

  it('should parse a range', () => {
    expect([...parseField('1-5', 0, 6, 'day-of-week')].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('should parse a list', () => {
    expect([...parseField('1,3,5', 0, 6, 'day-of-week')].sort()).toEqual([1, 3, 5]);
  });

  it('should parse wildcard steps', () => {
    expect([...parseField('*/15', 0, 59, 'minute')].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it('should parse range steps', () => {
    expect([...parseField('10-20/5', 0, 59, 'minute')].sort((a, b) => a - b)).toEqual([10, 15, 20]);
  });

  it('should throw on a zero step instead of looping forever', () => {
    expect(() => parseField('*/0', 0, 59, 'minute')).toThrow(/Invalid step/);
  });

  it('should throw on a non-numeric step', () => {
    expect(() => parseField('*/abc', 0, 59, 'minute')).toThrow(/Invalid step/);
  });

  it('should throw on non-numeric values', () => {
    expect(() => parseField('abc', 0, 59, 'minute')).toThrow(/Invalid minute value/);
  });

  it('should throw on out-of-range values', () => {
    expect(() => parseField('75', 0, 59, 'minute')).toThrow(/expected 0-59/);
    expect(() => parseField('24', 0, 23, 'hour')).toThrow(/expected 0-23/);
  });

  it('should throw on inverted ranges', () => {
    expect(() => parseField('30-10', 0, 59, 'minute')).toThrow(/start is greater than end/);
  });
});

describe('getNextRunMs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday 2026-06-10 12:00:00 local time
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should find the next matching minute', () => {
    // Next 12:30 is 30 minutes away
    expect(getNextRunMs('30 * * * *')).toBe(30 * 60 * 1000);
  });

  it('should roll over to the next day', () => {
    // Next 09:00 is tomorrow morning
    expect(getNextRunMs('0 9 * * *')).toBe(21 * 60 * 60 * 1000);
  });

  it('should respect day-of-week', () => {
    // Next Friday (from Wednesday noon) at 00:00 is in 36 hours
    expect(getNextRunMs('0 0 * * 5')).toBe(36 * 60 * 60 * 1000);
  });

  it('should accept 7 as Sunday', () => {
    expect(getNextRunMs('0 0 * * 7')).toBe(getNextRunMs('0 0 * * 0'));
  });

  it('should throw on day-of-month or month fields', () => {
    expect(() => getNextRunMs('0 0 1 * *')).toThrow(/not supported/);
    expect(() => getNextRunMs('0 0 * 6 *')).toThrow(/not supported/);
  });

  it('should throw on the wrong number of fields', () => {
    expect(() => getNextRunMs('0 0 * *')).toThrow(/expected 5 fields/);
  });

  it('should throw on invalid values instead of silently never firing', () => {
    expect(() => getNextRunMs('61 * * * *')).toThrow(/Invalid minute/);
    expect(() => getNextRunMs('* * * * 8')).toThrow(/Invalid day-of-week/);
  });
});
