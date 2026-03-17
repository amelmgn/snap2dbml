import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConversionArtifacts } from './conversion.js';
import { loadSyncConfig } from './sync-config.js';
import { SyncScheduler } from './scheduler.js';
import type { ConvertOptions, DirectusSnapshot } from './types.js';

const DEFAULT_PORT = parseInt(process.env.PORT ?? '3000', 10);
const DEFAULT_API_KEY = process.env.API_KEY ?? '';
const DEFAULT_MAX_BODY_BYTES = 52_428_800; // 50 MB

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
      const provided = req.headers['x-api-key'];
      if (provided !== apiKey) {
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
      const message = err instanceof Error ? err.message : 'Conversion failed';
      return send(res, 422, { error: message });
    }
  });
}

export function startServer(config: ServerConfig = {}): Server {
  const server = createAppServer(config);
  const port = config.port ?? DEFAULT_PORT;
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
