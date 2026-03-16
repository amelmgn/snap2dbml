import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { duplexPair } from 'node:stream';
import { createAppServer } from '../../src/server.js';
import type { ServerConfig } from '../../src/server.js';
import type { DirectusSnapshot } from '../../src/types.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');
const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf-8'),
) as { version: string };

function loadFixtureJSON(name: string): DirectusSnapshot {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), 'utf-8'));
}

async function sendHttpRequest(
  server: Server,
  options: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ status: number; body: string }> {
  const [client, serverSide] = duplexPair();
  server.emit('connection', serverSide as never);

  const responsePromise = new Promise<{ status: number; body: string }>((resolveResponse, rejectResponse) => {
    let rawResponse = '';

    client.setEncoding('utf-8');
    client.on('data', (chunk) => {
      rawResponse += chunk;
    });
    client.on('end', () => {
      try {
        resolveResponse(parseHttpResponse(rawResponse));
      } catch (error) {
        rejectResponse(error);
      }
    });
    client.on('error', rejectResponse);
    serverSide.on('error', rejectResponse);
  });

  const body = options.body ?? '';
  const headers = {
    Host: 'snap2dbml.test',
    Connection: 'close',
    ...(body !== '' ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
    ...options.headers,
  };

  const rawRequest = [
    `${options.method ?? 'GET'} ${options.path} HTTP/1.1`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    body,
  ].join('\r\n');

  client.write(rawRequest);

  return await responsePromise;
}

function parseHttpResponse(rawResponse: string): { status: number; body: string } {
  const separatorIndex = rawResponse.indexOf('\r\n\r\n');
  if (separatorIndex === -1) {
    throw new Error(`Malformed HTTP response: ${JSON.stringify(rawResponse)}`);
  }

  const headerSection = rawResponse.slice(0, separatorIndex);
  const body = rawResponse.slice(separatorIndex + 4);
  const [statusLine] = headerSection.split('\r\n');
  const match = /^HTTP\/1\.1 (\d{3})/.exec(statusLine);

  if (!match) {
    throw new Error(`Malformed HTTP status line: ${statusLine}`);
  }

  return {
    status: Number(match[1]),
    body,
  };
}

describe('HTTP API', () => {
  it('responds to /health without requiring auth', async () => {
    const response = await sendHttpRequest(createAppServer({ apiKey: 'secret' }), {
      path: '/health',
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
  });

  it('enforces auth on /convert and returns conversion output for authorized requests', async () => {
    const server = createAppServer({ apiKey: 'secret' });
    const snapshot = loadFixtureJSON('basic.json');

    const unauthorized = await sendHttpRequest(server, {
      method: 'POST',
      path: '/convert',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot }),
    });

    expect(unauthorized.status).toBe(401);
    expect(JSON.parse(unauthorized.body)).toEqual({ error: 'Unauthorized' });

    const authorized = await sendHttpRequest(server, {
      method: 'POST',
      path: '/convert',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'secret',
      },
      body: JSON.stringify({ snapshot, generateMarkdown: true }),
    });

    expect(authorized.status).toBe(200);
    const result = JSON.parse(authorized.body) as {
      dbml: string;
      md: string | null;
      metadata: { snap2dbmlVersion: string };
    };
    expect(result.dbml).toContain('Table posts {');
    expect(result.md).toContain('### `posts`');
    expect(result.metadata.snap2dbmlVersion).toBe(pkg.version);
  });

  it('returns 413 when the request body exceeds the configured limit', async () => {
    const snapshot = loadFixtureJSON('basic.json');
    const response = await sendHttpRequest(createAppServer({ maxBodyBytes: 64 }), {
      method: 'POST',
      path: '/convert',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot }),
    });

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({ error: 'Request body too large' });
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const response = await sendHttpRequest(createAppServer(), {
      method: 'POST',
      path: '/convert',
      headers: { 'Content-Type': 'application/json' },
      body: '{"snapshot":',
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: 'Invalid JSON' });
  });

  it('returns 422 when conversion fails', async () => {
    const response = await sendHttpRequest(createAppServer(), {
      method: 'POST',
      path: '/convert',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot: { foo: 1 } }),
    });

    expect(response.status).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({
      error: expect.stringContaining('version'),
    });
  });
});
