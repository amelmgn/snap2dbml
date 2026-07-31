import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Cron } from 'croner';
import type { ConvertOptions } from './types.js';

export interface DirectusSyncConfig {
  snapshotUrl: string;
  bearerToken: string;
}

interface GitHubSyncConfigBase {
  /** Default: "main" */
  branch?: string;
  token: string;
  /** Path to snapshot.json in the repo, e.g. "Directus/snapshot/snapshot.json" */
  snapshotPath: string;
  /** Directory for schema_*.dbml and description_*.md files, e.g. "Directus/schema" */
  schemaDir: string;
}

export type GitHubSyncConfig = GitHubSyncConfigBase & (
  | {
      /** GitHub repository as "owner/repo" or a full https://github.com/owner/repo URL */
      repository: string;
      owner?: never;
      repo?: never;
    }
  | {
      /** @deprecated Use repository: "owner/repo" */
      owner: string;
      /** @deprecated Use repository: "owner/repo" */
      repo: string;
      repository?: never;
    }
);

export function parseGitHubRepository(repository: string): { owner: string; repo: string } {
  const trimmed = repository.trim();
  const urlMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)\/?$/i);
  const slugMatch = trimmed.match(/^([^/]+)\/([^/]+)$/);
  const match = urlMatch ?? slugMatch;

  if (!match) {
    throw new Error(
      `Invalid GitHub repository "${repository}" (expected "owner/repo" or "https://github.com/owner/repo")`,
    );
  }

  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(
      `Invalid GitHub repository "${repository}" (expected "owner/repo" or "https://github.com/owner/repo")`,
    );
  }

  return { owner, repo };
}

export function resolveGitHubRepository(
  github: GitHubSyncConfig,
): { owner: string; repo: string } {
  return 'repository' in github && github.repository !== undefined
    ? parseGitHubRepository(github.repository)
    : { owner: github.owner, repo: github.repo };
}

export type TelegramNotificationMode = 'success' | 'failure' | 'always';

export interface TelegramSyncConfig {
  botToken: string;
  chatId: string;
  /** Which completed sync outcomes trigger a notification. Default: "success". */
  notifyOn?: TelegramNotificationMode;
}

export interface SyncTarget {
  name: string;
  /** Cron expression, e.g. "0 0 * * 1-5". Supports the full croner syntax. */
  schedule: string;
  /** Optional IANA timezone for the schedule, e.g. "Europe/Podgorica". Defaults to server-local time. */
  timezone?: string;
  directus: DirectusSyncConfig;
  github: GitHubSyncConfig;
  telegram?: TelegramSyncConfig;
  generateMarkdown?: boolean;
  convertOptions?: ConvertOptions;
}

export interface SyncConfig {
  syncs: SyncTarget[];
}

function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    const env = process.env[varName];
    if (env === undefined) {
      throw new Error(`Environment variable "${varName}" is not set (referenced in sync config)`);
    }
    return env;
  });
}

function interpolateConfig(value: unknown): unknown {
  if (typeof value === 'string') return interpolateEnv(value);
  if (Array.isArray(value)) return value.map(interpolateConfig);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateConfig(v);
    }
    return result;
  }
  return value;
}

export function loadSyncConfig(configPath: string): SyncConfig {
  const resolved = resolve(configPath);
  if (!existsSync(resolved)) {
    throw new Error(`Sync config not found: ${configPath}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolved, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse sync config: ${err instanceof Error ? err.message : String(err)}`);
  }

  const config = interpolateConfig(raw) as SyncConfig;

  if (!config.syncs || !Array.isArray(config.syncs) || config.syncs.length === 0) {
    throw new Error('Sync config must contain a non-empty "syncs" array');
  }

  validateSyncTargets(config.syncs);

  return config;
}

function requireString(obj: Record<string, unknown>, field: string, context: string): void {
  if (!obj[field] || typeof obj[field] !== 'string') {
    throw new Error(`${context}.${field} is required and must be a non-empty string`);
  }
}

function validateSyncTargets(syncs: unknown[]): void {
  const names = new Set<string>();
  for (let i = 0; i < syncs.length; i++) {
    const t = syncs[i];
    const ctx = `syncs[${i}]`;
    if (!t || typeof t !== 'object') throw new Error(`${ctx} must be an object`);
    const target = t as Record<string, unknown>;

    requireString(target, 'name', ctx);
    requireString(target, 'schedule', ctx);
    if (target.timezone !== undefined && typeof target.timezone !== 'string') {
      throw new Error(`${ctx}.timezone must be a string (IANA timezone name)`);
    }
    try {
      const probe = new Cron(target.schedule as string, {
        timezone: target.timezone as string | undefined,
      });
      // Timezone problems only surface when a run time is computed
      probe.nextRun();
      probe.stop();
    } catch (err) {
      throw new Error(
        `${ctx}.schedule is invalid: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const name = target.name as string;
    if (names.has(name)) throw new Error(`Duplicate sync target name: "${name}"`);
    names.add(name);

    if (!target.directus || typeof target.directus !== 'object') {
      throw new Error(`${ctx}.directus is required`);
    }
    const directus = target.directus as Record<string, unknown>;
    requireString(directus, 'snapshotUrl', `${ctx}.directus`);
    requireString(directus, 'bearerToken', `${ctx}.directus`);

    if (!target.github || typeof target.github !== 'object') {
      throw new Error(`${ctx}.github is required`);
    }
    const github = target.github as Record<string, unknown>;
    const hasRepository = typeof github.repository === 'string' && github.repository.length > 0;
    const hasLegacyPair = typeof github.owner === 'string' && github.owner.length > 0
      && typeof github.repo === 'string' && github.repo.length > 0;
    if (hasRepository && hasLegacyPair) {
      throw new Error(`${ctx}.github must use either repository or owner/repo, not both`);
    }
    if (!hasRepository && !hasLegacyPair) {
      throw new Error(`${ctx}.github.repository is required and must be "owner/repo"`);
    }
    if (hasRepository) parseGitHubRepository(github.repository as string);
    requireString(github, 'token', `${ctx}.github`);
    requireString(github, 'snapshotPath', `${ctx}.github`);
    requireString(github, 'schemaDir', `${ctx}.github`);

    if (target.telegram !== undefined) {
      if (!target.telegram || typeof target.telegram !== 'object') {
        throw new Error(`${ctx}.telegram must be an object`);
      }
      const telegram = target.telegram as Record<string, unknown>;
      requireString(telegram, 'botToken', `${ctx}.telegram`);
      requireString(telegram, 'chatId', `${ctx}.telegram`);
      if (
        telegram.notifyOn !== undefined
        && !['success', 'failure', 'always'].includes(telegram.notifyOn as string)
      ) {
        throw new Error(
          `${ctx}.telegram.notifyOn must be one of "success", "failure", or "always"`,
        );
      }
    }
  }
}
