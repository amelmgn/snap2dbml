import { describe, expect, it } from 'vitest';
import { parseGitHubRepository, resolveGitHubRepository } from '../../src/sync-config.js';

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
