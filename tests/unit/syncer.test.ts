import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSync } from '../../src/syncer.js';
import { captureLogger } from '../helpers/capture-logger.js';
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
    const commitMessages: string[] = [];

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
        commitMessages.push(JSON.parse(String(init?.body)).message);
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

    const { logger, records } = captureLogger();
    const { committed } = await runSync({
      ...target,
      timezone: 'Asia/Tashkent',
    }, logger);

    expect(committed).toBe(true);
    expect(submittedTrees).toHaveLength(2);
    expect(submittedTrees[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Directus/schema/schema_20260730_050002.dbml' }),
      expect.objectContaining({ path: 'Directus/schema/description_20260730_050002.md' }),
      expect.objectContaining({ path: 'Directus/schema/schema_competing.dbml', sha: null }),
      expect.objectContaining({ path: 'Directus/schema/description_competing.md', sha: null }),
    ]));
    expect(commitMessages).toEqual([
      'Snapshot updated at 2026-07-30 05:00:02 Asia/Tashkent',
      'Snapshot updated at 2026-07-30 05:00:02 Asia/Tashkent',
    ]);
    expect(submittedTrees[1].some(item => item.path.endsWith('README.txt'))).toBe(false);
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        scope: 'sync:test',
        msg: 'Branch changed concurrently; retrying',
      }),
    );
  });

  it('notifies on a successful run even when no commit is created', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T00:00:02Z'));

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });

      if (url === target.directus.snapshotUrl) return jsonResponse(snapshot);
      if (url.endsWith('/git/ref/heads/main')) {
        return jsonResponse({ object: { sha: 'head' } });
      }
      if (url.includes('/contents/Directus/schema?ref=head')) return jsonResponse([]);
      if (url.endsWith('/git/commits/head')) return jsonResponse({ tree: { sha: 'base-tree' } });
      if (url.endsWith('/git/blobs')) return jsonResponse({ sha: 'blob' });
      if (url.endsWith('/git/trees')) return jsonResponse({ sha: 'base-tree' });
      if (url.startsWith('https://api.telegram.org/')) return jsonResponse({ ok: true });
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
    }));

    const syncTarget: SyncTarget = {
      ...target,
      telegram: {
        botToken: 'bot-token',
        chatId: 'chat-id',
        notifyOn: 'success',
        messages: { noChanges: 'No changes for {{name}} at {{time}}' },
      },
    };
    const { committed } = await runSync(syncTarget, captureLogger().logger);

    expect(committed).toBe(false);
    const treeRequest = requests.find(request => request.url.endsWith('/git/trees'));
    expect(JSON.parse(String(treeRequest?.init?.body)).tree).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Directus/schema/schema_20260730_000002.dbml' }),
      expect.objectContaining({ path: 'Directus/schema/description_20260730_000002.md' }),
    ]));
    const telegramRequest = requests.find(request => request.url.startsWith(
      'https://api.telegram.org/',
    ));
    expect(telegramRequest).toBeDefined();
    expect(JSON.parse(String(telegramRequest?.init?.body))).toMatchObject({
      chat_id: 'chat-id',
      text: 'No changes for test at 2026-07-30 00:00:02 UTC',
    });
  });

  it.each(['failure', 'always'] as const)(
    'notifies on failure in "%s" mode and preserves the original error',
    async (notifyOn) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-30T00:00:02Z'));

      const requests: Array<{ url: string; init?: RequestInit }> = [];
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url === target.directus.snapshotUrl) {
          return jsonResponse({ message: 'Unauthorized' }, 401);
        }
        if (url.startsWith('https://api.telegram.org/')) {
          return jsonResponse({ description: 'delivery failed' }, 500);
        }
        throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
      }));

      const syncTarget: SyncTarget = {
        ...target,
        timezone: 'Asia/Tashkent',
        telegram: {
          botToken: 'bot-token',
          chatId: 'chat-id',
          notifyOn,
          messages: { failure: 'Sync {{name}} failed at {{time}}: {{error}}' },
        },
      };
      const { logger, records } = captureLogger();

      await expect(runSync(syncTarget, logger)).rejects.toThrow(
        'Directus snapshot fetch failed: HTTP 401',
      );
      const telegramRequest = requests.find(request => request.url.startsWith(
        'https://api.telegram.org/',
      ));
      expect(JSON.parse(String(telegramRequest?.init?.body))).toMatchObject({
        chat_id: 'chat-id',
        text: 'Sync test failed at 2026-07-30 05:00:02 Asia/Tashkent: Directus snapshot fetch failed: HTTP 401 ',
      });
      expect(records).toContainEqual(expect.objectContaining({
        level: 'warn',
        scope: 'sync:test',
        msg: 'Telegram notification failed',
        status: 500,
      }));
    },
  );

  it('does not notify on failure in the default success mode', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === target.directus.snapshotUrl) return jsonResponse({}, 500);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const syncTarget: SyncTarget = {
      ...target,
      telegram: { botToken: 'bot-token', chatId: 'chat-id' },
    };
    await expect(runSync(syncTarget, captureLogger().logger)).rejects.toThrow(
      'Directus snapshot fetch failed: HTTP 500',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
