import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  loadSyncConfig,
  parseGitHubRepository,
  resolveGitHubRepository,
} from '../../src/sync-config.js';

const common = {
  token: 'token',
  snapshotPath: 'Directus/snapshot/snapshot.json',
  schemaDir: 'Directus/schema',
};

describe('GitHub repository configuration', () => {
  it('parses the compact owner/repo form', () => {
    expect(parseGitHubRepository('amelmgn/relian')).toEqual({
      owner: 'amelmgn',
      repo: 'relian',
    });
  });

  it('parses a full GitHub URL and strips an optional .git suffix', () => {
    expect(parseGitHubRepository('https://github.com/amelmgn/relian.git')).toEqual({
      owner: 'amelmgn',
      repo: 'relian',
    });
  });

  it('rejects unsupported repository values', () => {
    expect(() => parseGitHubRepository('relian')).toThrow(/expected "owner\/repo"/);
    expect(() => parseGitHubRepository('https://gitlab.com/amelmgn/relian')).toThrow(
      /Invalid GitHub repository/,
    );
  });

  it('keeps legacy owner/repo configs working', () => {
    expect(resolveGitHubRepository({ ...common, owner: 'amelmgn', repo: 'relian' })).toEqual({
      owner: 'amelmgn',
      repo: 'relian',
    });
  });
});

describe('schedule validation at config load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'snap2dbml-sync-config-'));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(target: Record<string, unknown>): string {
    const path = join(dir, `sync-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(path, JSON.stringify({ syncs: [target] }));
    return path;
  }

  const validTarget = {
    name: 'test',
    schedule: '0 0 * * 1-5',
    directus: { snapshotUrl: 'https://cms.example.com/snapshot', bearerToken: 'token' },
    github: {
      repository: 'owner/repo',
      token: 'gh-token',
      snapshotPath: 'snapshot.json',
      schemaDir: 'schema',
    },
  };

  it('accepts extended cron syntax, including day-of-month and month', () => {
    const path = writeConfig({ ...validTarget, schedule: '0 0 1 JAN *' });
    expect(loadSyncConfig(path).syncs[0].schedule).toBe('0 0 1 JAN *');
  });

  it('accepts a valid IANA timezone', () => {
    const path = writeConfig({ ...validTarget, timezone: 'Europe/Podgorica' });
    expect(loadSyncConfig(path).syncs[0].timezone).toBe('Europe/Podgorica');
  });

  it('rejects an invalid cron expression at load time', () => {
    const path = writeConfig({ ...validTarget, schedule: '61 * * * *' });
    expect(() => loadSyncConfig(path)).toThrow(/syncs\[0\]\.schedule is invalid/);
  });

  it('rejects an invalid timezone at load time', () => {
    const path = writeConfig({ ...validTarget, timezone: 'Not/AZone' });
    expect(() => loadSyncConfig(path)).toThrow(/syncs\[0\]\.schedule is invalid/);
  });

  it('rejects a non-string timezone', () => {
    const path = writeConfig({ ...validTarget, timezone: 42 });
    expect(() => loadSyncConfig(path)).toThrow(/syncs\[0\]\.timezone must be a string/);
  });

  it.each(['success', 'failure', 'always'] as const)(
    'accepts the Telegram notification mode "%s"',
    (notifyOn) => {
      const telegram = { botToken: 'bot-token', chatId: 'chat-id', notifyOn };
      const path = writeConfig({ ...validTarget, telegram });
      expect(loadSyncConfig(path).syncs[0].telegram).toEqual(telegram);
    },
  );

  it('accepts Telegram configuration without notifyOn for backward compatibility', () => {
    const telegram = { botToken: 'bot-token', chatId: 'chat-id' };
    const path = writeConfig({ ...validTarget, telegram });
    expect(loadSyncConfig(path).syncs[0].telegram).toEqual(telegram);
  });

  it('rejects incomplete Telegram configuration and unknown notification modes', () => {
    const missingToken = writeConfig({
      ...validTarget,
      telegram: { chatId: 'chat-id' },
    });
    expect(() => loadSyncConfig(missingToken)).toThrow(/telegram\.botToken is required/);

    const invalidMode = writeConfig({
      ...validTarget,
      telegram: { botToken: 'bot-token', chatId: 'chat-id', notifyOn: 'sometimes' },
    });
    expect(() => loadSyncConfig(invalidMode)).toThrow(
      /telegram\.notifyOn must be one of "success", "failure", or "always"/,
    );
  });
});
