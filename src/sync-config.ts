import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConvertOptions } from './types.js';

export interface DirectusSyncConfig {
  snapshotUrl: string;
  bearerToken: string;
}

export interface GitHubSyncConfig {
  owner: string;
  repo: string;
  /** Default: "main" */
  branch?: string;
  token: string;
  /** Path to snapshot.json in the repo, e.g. "Directus/snapshot/snapshot.json" */
  snapshotPath: string;
  /** Directory for schema_*.dbml and description_*.md files, e.g. "Directus/schema" */
  schemaDir: string;
}

export interface TelegramSyncConfig {
  botToken: string;
  chatId: string;
}

export interface SyncTarget {
  name: string;
  /** Standard 5-field cron expression, e.g. "0 0 * * 1-5" */
  schedule: string;
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
    requireString(github, 'owner', `${ctx}.github`);
    requireString(github, 'repo', `${ctx}.github`);
    requireString(github, 'token', `${ctx}.github`);
    requireString(github, 'snapshotPath', `${ctx}.github`);
    requireString(github, 'schemaDir', `${ctx}.github`);
  }
}
