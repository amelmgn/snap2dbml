import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConversionArtifacts } from './conversion.js';
import { Snap2DBMLError } from './errors.js';
import { loadSyncConfig } from './sync-config.js';
import { SyncScheduler } from './scheduler.js';
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
  logger?: Pick<NodeJS.WritableStream, 'write'>;
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

export function createAppServer(config: ServerConfig = {}): Server {
  const apiKey = config.apiKey ?? DEFAULT_API_KEY;
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
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
      const logger = config.logger ?? process.stderr;
      logger.write(`snap2dbml: Internal error: ${err instanceof Error ? (err.stack ?? err.message) : err}\n`);
      return send(res, 500, { error: 'Internal server error' });
    }
  });
}

export function startServer(config: ServerConfig = {}): Server {
  const server = createAppServer(config);
  const port = config.port ?? resolvePort(process.env.PORT);
  const logger = config.logger ?? process.stderr;

  server.listen(port, () => {
    logger.write(`snap2dbml server listening on port ${port}\n`);

    const syncConfigPath = process.env.SYNC_CONFIG;
    if (syncConfigPath) {
      try {
        const syncConfig = loadSyncConfig(syncConfigPath);
        const scheduler = new SyncScheduler(syncConfig.syncs, logger);
        scheduler.start();
        server.once('close', () => scheduler.stop());
      } catch (err) {
        logger.write(
          `snap2dbml: Failed to start scheduler: ${err instanceof Error ? err.message : err}\n`,
        );
      }
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
