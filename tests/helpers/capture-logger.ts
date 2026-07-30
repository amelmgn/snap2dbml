import { createLogger } from '../../src/logger.js';
import type { Logger, LogLevel, LogRecord } from '../../src/logger.js';

/** A logger that records every emitted record and writes nothing. */
export function captureLogger(level: LogLevel = 'debug'): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const logger = createLogger({
    level,
    stream: { write: () => true },
    onRecord: (record) => records.push(record),
  });
  return { logger, records };
}
