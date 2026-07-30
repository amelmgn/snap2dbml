import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConversionArtifacts } from './conversion.js';
import { Snap2DBMLError } from './errors.js';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';
import { SyncScheduler } from './scheduler.js';
import { StatusRegistry } from './status.js';
import { loadSyncConfig } from './sync-config.js';
import { LIBRARY_VERSION } from './version.js';
import type { ConvertOptions, DirectusSnapshot } from './types.js';

const DEFAULT_API_KEY = process.env.API_KEY ?? '';
const DEFAULT_MAX_BODY_BYTES = 52_428_800; // 50 MB

function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: "${raw}" (expected an integer between 0 and 65535)`);
  }
  return port;
}

function isApiKeyValid(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export interface ServerConfig {
  port?: number;
  apiKey?: string;
  maxBodyBytes?: number;
  logger?: Logger;
  /** Sync activity registry exposed via GET /status. */
  registry?: StatusRegistry;
  /** Whether a sync scheduler is running; reported by GET /status. */
  schedulerActive?: boolean;
}

interface ConvertRequest {
  snapshot: DirectusSnapshot;
  options?: ConvertOptions;
  generateMarkdown?: boolean;
}

function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const cleanup = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      req.resume();
      reject(error);
    };

    const onData = (chunk: Buffer): void => {
      if (settled) {
        return;
      }

      total += chunk.length;
      if (total > maxBodyBytes) {
        fail(new Error('Request body too large'));
        return;
      }

      chunks.push(chunk);
    };

    const onEnd = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf-8'));
    };

    const onError = (error: Error): void => {
      fail(error);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function logRequest(req: IncomingMessage, res: ServerResponse, logger: Logger): void {
  const startedAt = performance.now();
  res.on('finish', () => {
    // Strip the query string: it may carry sensitive values and adds noise
    const path = (req.url ?? '').split('?')[0];
    const fields = {
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    };
    // Healthchecks poll every 30s; keep them out of the default log stream
    if (path === '/health') {
      logger.debug('Request', fields);
    } else {
      logger.info('Request', fields);
    }
  });
}

export function createAppServer(config: ServerConfig = {}): Server {
  const apiKey = config.apiKey ?? DEFAULT_API_KEY;
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const logger = config.logger ?? createLogger();
  const httpLogger = logger.child('http');
  const startedAt = Date.now();

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    logRequest(req, res, httpLogger);

    // Health check — no auth required
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { status: 'ok' });
    }

    // Auth
    if (apiKey) {
      if (!isApiKeyValid(req.headers['x-api-key'], apiKey)) {
        return send(res, 401, { error: 'Unauthorized' });
      }
    }

    if (req.method === 'GET' && req.url === '/status') {
      const registry = config.registry;
      return send(res, 200, {
        status: 'ok',
        version: LIBRARY_VERSION,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        scheduler: config.schedulerActive ?? false,
        targets: registry ? registry.targets() : [],
        recentLogs: registry ? registry.recentLogs() : [],
      });
    }

    if (req.method !== 'POST' || req.url !== '/convert') {
      return send(res, 404, { error: 'Not Found' });
    }

    let rawBody: string;
    try {
      rawBody = await readBody(req, maxBodyBytes);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read request body';
      return send(res, 413, { error: message });
    }

    let body: ConvertRequest;
    try {
      body = JSON.parse(rawBody) as ConvertRequest;
    } catch {
      return send(res, 400, { error: 'Invalid JSON' });
    }

    if (!body.snapshot || typeof body.snapshot !== 'object') {
      return send(res, 400, { error: 'Missing required field: snapshot' });
    }

    const options: ConvertOptions = {
      suppressWarnings: true, // warnings are returned in the response body
      ...body.options,
    };

    try {
      const result = buildConversionArtifacts(
        body.snapshot,
        options,
        body.generateMarkdown ?? false,
      );

      return send(res, 200, {
        dbml: result.dbml,
        md: result.markdown ?? null,
        warnings: result.warnings,
        stats: result.stats,
        metadata: result.metadata,
      });
    } catch (err) {
      // Known conversion errors are the client's fault; anything else is an internal
      // error and must not leak its message to the client
      if (err instanceof Snap2DBMLError) {
        return send(res, 422, { error: err.message });
      }
      httpLogger.error('Internal error', { err });
      return send(res, 500, { error: 'Internal server error' });
    }
  });
}

export function startServer(config: ServerConfig = {}): Server {
  const registry = config.registry ?? new StatusRegistry();
  const logger = config.logger
    ?? createLogger({ onRecord: (record) => registry.pushLog(record) });

  let scheduler: SyncScheduler | undefined;
  const syncConfigPath = process.env.SYNC_CONFIG;
  if (syncConfigPath) {
    try {
      const syncConfig = loadSyncConfig(syncConfigPath);
      scheduler = new SyncScheduler(syncConfig.syncs, logger, registry);
    } catch (err) {
      logger.error('Failed to start scheduler', { err });
    }
  }

  const server = createAppServer({
    ...config,
    logger,
    registry,
    schedulerActive: scheduler !== undefined,
  });
  const port = config.port ?? resolvePort(process.env.PORT);

  server.listen(port, () => {
    logger.info('Server listening', { port });
    if (scheduler) {
      scheduler.start();
      server.once('close', () => scheduler.stop());
    }
  });

  return server;
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  startServer();
}
