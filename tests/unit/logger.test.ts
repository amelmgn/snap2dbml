import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/logger.js';
import type { LogRecord } from '../../src/logger.js';

function captureStream(): { write: (chunk: unknown) => boolean; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write: (chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    },
  };
}

describe('createLogger', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('emits one JSON object per line with time, level, and msg', () => {
    const stream = captureStream();
    const logger = createLogger({ level: 'info', stream });

    logger.info('hello', { count: 3 });

    expect(stream.lines).toHaveLength(1);
    const record = JSON.parse(stream.lines[0]) as LogRecord;
    expect(record).toMatchObject({ level: 'info', msg: 'hello', count: 3 });
    expect(new Date(record.time).toISOString()).toBe(record.time);
    expect(record.scope).toBeUndefined();
  });

  it('filters records below the configured level', () => {
    const stream = captureStream();
    const logger = createLogger({ level: 'warn', stream });

    logger.debug('nope');
    logger.info('nope');
    logger.warn('yes');
    logger.error('yes');

    expect(stream.lines).toHaveLength(2);
    expect(JSON.parse(stream.lines[0]).level).toBe('warn');
    expect(JSON.parse(stream.lines[1]).level).toBe('error');
  });

  it('adds the child scope to records', () => {
    const stream = captureStream();
    const logger = createLogger({ level: 'info', stream }).child('sync:demo');

    logger.info('working');

    expect(JSON.parse(stream.lines[0]).scope).toBe('sync:demo');
  });

  it('serializes Error fields as message and stack', () => {
    const stream = captureStream();
    const logger = createLogger({ level: 'info', stream });

    logger.error('failed', { err: new Error('boom') });

    const record = JSON.parse(stream.lines[0]);
    expect(record.err.message).toBe('boom');
    expect(record.err.stack).toContain('boom');
  });

  it('formats text output with timestamp, level, scope, and extra fields', () => {
    const stream = captureStream();
    const logger = createLogger({ level: 'info', format: 'text', stream }).child('http');

    logger.info('Request', { status: 200 });

    expect(stream.lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO {2}\[http\] Request \{"status":200\}\n$/,
    );
  });

  it('invokes onRecord for every emitted record but not for filtered ones', () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      level: 'info',
      stream: captureStream(),
      onRecord: (r) => records.push(r),
    });

    logger.debug('filtered');
    logger.info('kept');

    expect(records).toHaveLength(1);
    expect(records[0].msg).toBe('kept');
  });

  it('reads the level from LOG_LEVEL', () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    const stream = captureStream();
    const logger = createLogger({ stream });

    logger.debug('visible');

    expect(stream.lines).toHaveLength(1);
  });

  it('falls back to info and warns once on an invalid LOG_LEVEL', () => {
    vi.stubEnv('LOG_LEVEL', 'loud');
    const stream = captureStream();
    const logger = createLogger({ stream });

    logger.debug('filtered');
    logger.info('kept');

    expect(stream.lines).toHaveLength(2);
    expect(JSON.parse(stream.lines[0])).toMatchObject({
      level: 'warn',
      msg: 'Invalid LOG_LEVEL "loud", falling back to "info"',
    });
    expect(JSON.parse(stream.lines[1]).msg).toBe('kept');
  });
});
