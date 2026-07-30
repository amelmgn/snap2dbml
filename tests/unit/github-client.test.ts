import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSingleCommit } from '../../src/github-client.js';

const repo = {
  owner: 'acme',
  repo: 'schemas',
  branch: 'main',
  token: 'secret',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GitHub commit creation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not create an empty commit when the resulting tree is unchanged', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      requests.push({ url, method });

      if (url.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'head' } });
      if (url.endsWith('/git/commits/head')) return jsonResponse({ tree: { sha: 'same-tree' } });
      if (url.endsWith('/git/blobs')) return jsonResponse({ sha: 'blob' });
      if (url.endsWith('/git/trees')) return jsonResponse({ sha: 'same-tree' });
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));

    await expect(createSingleCommit(
      repo,
      [{ path: 'schema.dbml', content: 'unchanged' }],
      'Snapshot updated',
    )).resolves.toBe(false);

    expect(requests.some(r => r.url.endsWith('/git/commits') && r.method === 'POST')).toBe(false);
    expect(requests.some(r => r.url.endsWith('/git/refs/heads/main') && r.method === 'PATCH')).toBe(false);
  });
});
