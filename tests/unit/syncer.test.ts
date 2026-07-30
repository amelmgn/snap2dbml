import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSync } from '../../src/syncer.js';
import type { SyncTarget } from '../../src/sync-config.js';

const snapshot = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/basic.json'), 'utf-8'),
);

const target: SyncTarget = {
  name: 'test',
  schedule: '0 0 * * *',
  directus: { snapshotUrl: 'https://directus.test/snapshot', bearerToken: 'directus-token' },
  github: {
    repository: 'acme/schemas',
    branch: 'main',
    token: 'github-token',
    snapshotPath: 'Directus/snapshot/snapshot.json',
    schemaDir: 'Directus/schema',
  },
  generateMarkdown: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('runSync', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('re-lists at the new HEAD after a concurrent update and removes every old artifact', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T00:00:02Z'));

    let headRead = 0;
    let treeCreated = 0;
    let refUpdated = 0;
    const submittedTrees: Array<Array<{ path: string; sha?: string | null }>> = [];

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === target.directus.snapshotUrl) return jsonResponse(snapshot);
      if (url.endsWith('/git/ref/heads/main')) {
        headRead++;
        return jsonResponse({ object: { sha: headRead === 1 ? 'head-1' : 'head-2' } });
      }
      if (url.includes('/contents/Directus/schema?ref=head-1')) {
        return jsonResponse([
          { name: 'schema_yesterday.dbml', path: 'Directus/schema/schema_yesterday.dbml', type: 'file' },
          { name: 'description_yesterday.md', path: 'Directus/schema/description_yesterday.md', type: 'file' },
          { name: 'README.txt', path: 'Directus/schema/README.txt', type: 'file' },
        ]);
      }
      if (url.includes('/contents/Directus/schema?ref=head-2')) {
        return jsonResponse([
          { name: 'schema_competing.dbml', path: 'Directus/schema/schema_competing.dbml', type: 'file' },
          { name: 'description_competing.md', path: 'Directus/schema/description_competing.md', type: 'file' },
          { name: 'README.txt', path: 'Directus/schema/README.txt', type: 'file' },
        ]);
      }
      if (url.endsWith('/git/commits/head-1')) return jsonResponse({ tree: { sha: 'base-1' } });
      if (url.endsWith('/git/commits/head-2')) return jsonResponse({ tree: { sha: 'base-2' } });
      if (url.endsWith('/git/blobs')) return jsonResponse({ sha: `blob-${Math.random()}` });
      if (url.endsWith('/git/trees')) {
        treeCreated++;
        submittedTrees.push(JSON.parse(String(init?.body)).tree);
        return jsonResponse({ sha: `tree-${treeCreated}` });
      }
      if (url.endsWith('/git/commits') && method === 'POST') {
        return jsonResponse({ sha: `commit-${treeCreated}` });
      }
      if (url.endsWith('/git/refs/heads/main') && method === 'PATCH') {
        refUpdated++;
        return refUpdated === 1
          ? jsonResponse({ message: 'Update is not a fast forward' }, 422)
          : jsonResponse({});
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));

    const log: string[] = [];
    await runSync(target, { write: chunk => { log.push(String(chunk)); return true; } });

    expect(submittedTrees).toHaveLength(2);
    expect(submittedTrees[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Directus/schema/schema_competing.dbml', sha: null }),
      expect.objectContaining({ path: 'Directus/schema/description_competing.md', sha: null }),
    ]));
    expect(submittedTrees[1].some(item => item.path.endsWith('README.txt'))).toBe(false);
    expect(log.join('')).toContain('Branch changed concurrently; retrying');
  });
});
