export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  time: string;
  level: LogLevel;
  scope?: string;
  msg: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  /** Minimum level to emit. Default: LOG_LEVEL env var, falling back to "info". */
  level?: LogLevel;
  /** "json" emits one JSON object per line; "text" emits human-readable lines. Default: "json". */
  format?: 'json' | 'text';
  /** Destination stream. Default: process.stdout. */
  stream?: Pick<NodeJS.WritableStream, 'write'>;
  /** Called for every emitted record (after level filtering), e.g. to feed a ring buffer. */
  onRecord?: (record: LogRecord) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in LEVEL_ORDER;
}

/** Serialize field values so Error objects survive JSON.stringify. */
function normalizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = value instanceof Error ? { message: value.message, stack: value.stack } : value;
  }
  return result;
}

function formatText(record: LogRecord): string {
  const { time, level, scope, msg, ...fields } = record;
  const scopePart = scope ? ` [${scope}]` : '';
  const fieldsPart = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
  return `${time} ${level.toUpperCase().padEnd(5)}${scopePart} ${msg}${fieldsPart}\n`;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const stream = options.stream ?? process.stdout;
  const format = options.format ?? 'json';
  const onRecord = options.onRecord;

  let minLevel: LogLevel;
  if (options.level !== undefined) {
    minLevel = options.level;
  } else {
    const envLevel = process.env.LOG_LEVEL;
    if (envLevel === undefined || envLevel === '') {
      minLevel = 'info';
    } else if (isLogLevel(envLevel)) {
      minLevel = envLevel;
    } else {
      minLevel = 'info';
      const warning: LogRecord = {
        time: new Date().toISOString(),
        level: 'warn',
        msg: `Invalid LOG_LEVEL "${envLevel}", falling back to "info"`,
      };
      stream.write(format === 'json' ? `${JSON.stringify(warning)}\n` : formatText(warning));
    }
  }

  function emit(level: LogLevel, scope: string | undefined, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      ...(scope !== undefined ? { scope } : {}),
      msg,
      ...(fields !== undefined ? normalizeFields(fields) : {}),
    };

    stream.write(format === 'json' ? `${JSON.stringify(record)}\n` : formatText(record));
    onRecord?.(record);
  }

  function makeLogger(scope: string | undefined): Logger {
    return {
      debug: (msg, fields) => emit('debug', scope, msg, fields),
      info: (msg, fields) => emit('info', scope, msg, fields),
      warn: (msg, fields) => emit('warn', scope, msg, fields),
      error: (msg, fields) => emit('error', scope, msg, fields),
      child: (childScope) => makeLogger(childScope),
    };
  }

  return makeLogger(undefined);
}
