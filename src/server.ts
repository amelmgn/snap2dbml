import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { convertSnapshotWithStats, convertSnapshotToMarkdown } from './index.js';
import type { ConvertOptions, DirectusSnapshot } from './types.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const API_KEY = process.env.API_KEY ?? '';
const MAX_BODY_BYTES = 52_428_800; // 50 MB

interface ConvertRequest {
  snapshot: DirectusSnapshot;
  options?: ConvertOptions;
  generateMarkdown?: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
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

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Health check — no auth required
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { status: 'ok' });
  }

  // Auth
  if (API_KEY) {
    const provided = req.headers['x-api-key'];
    if (provided !== API_KEY) {
      return send(res, 401, { error: 'Unauthorized' });
    }
  }

  if (req.method !== 'POST' || req.url !== '/convert') {
    return send(res, 404, { error: 'Not Found' });
  }

  let rawBody: string;
  try {
    rawBody = await readBody(req);
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
    const dbmlResult = convertSnapshotWithStats(body.snapshot, options);

    let md: string | null = null;
    if (body.generateMarkdown) {
      const mdResult = convertSnapshotToMarkdown(body.snapshot, options);
      md = mdResult.markdown;
    }

    return send(res, 200, {
      dbml: dbmlResult.dbml,
      md,
      warnings: dbmlResult.warnings,
      stats: dbmlResult.stats,
      metadata: dbmlResult.metadata,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Conversion failed';
    return send(res, 422, { error: message });
  }
});

server.listen(PORT, () => {
  process.stderr.write(`snap2dbml server listening on port ${PORT}\n`);
});
