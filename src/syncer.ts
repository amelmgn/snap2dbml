import { buildConversionArtifacts } from './conversion.js';
import {
  createSingleCommit,
  getBranchHead,
  GitHubApiError,
  listDirectory,
} from './github-client.js';
import type { FileChange, GitHubRepo } from './github-client.js';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';
import { resolveGitHubRepository } from './sync-config.js';
import type { SyncTarget } from './sync-config.js';
import type { DirectusSnapshot } from './types.js';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_COMMIT_ATTEMPTS = 3;

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// UTC, matching the commit message timestamp; same format as the CLI (schema_YYYYMMDD_HHMMSS)
function formatTimestamp(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const MM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const HH = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${MM}${dd}_${HH}${mm}${ss}`;
}

async function fetchDirectusSnapshot(url: string, bearerToken: string): Promise<DirectusSnapshot> {
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Directus snapshot fetch failed: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<DirectusSnapshot>;
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
  logger: Logger,
): Promise<void> {
  try {
    const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_notification: true }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn('Telegram notification failed', { status: response.status, body });
    }
  } catch (err) {
    logger.warn('Telegram notification failed', { err });
  }
}

export async function runSync(
  target: SyncTarget,
  baseLogger: Logger = createLogger(),
): Promise<{ committed: boolean }> {
  const { name, directus, github, telegram, generateMarkdown = false, convertOptions } = target;
  const logger = baseLogger.child(`sync:${name}`);
  const { owner, repo: repoName } = resolveGitHubRepository(github);
  const repo: GitHubRepo = {
    owner,
    repo: repoName,
    branch: github.branch ?? 'main',
    token: github.token,
  };

  logger.info('Fetching snapshot from Directus');
  const snapshot = await fetchDirectusSnapshot(directus.snapshotUrl, directus.bearerToken);
  const snapshotJson = JSON.stringify(snapshot, null, 2);

  logger.info(`Converting to DBML${generateMarkdown ? ' + Markdown' : ''}`);
  const result = buildConversionArtifacts(
    snapshot,
    { suppressWarnings: true, ...convertOptions },
    generateMarkdown,
  );

  const now = new Date();
  const ts = formatTimestamp(now);

  const newFiles: FileChange[] = [
    { path: github.snapshotPath, content: snapshotJson },
    { path: `${github.schemaDir}/schema_${ts}.dbml`, content: result.dbml },
    ...(generateMarkdown && result.markdown
      ? [{ path: `${github.schemaDir}/description_${ts}.md`, content: result.markdown }]
      : []),
  ];

  const newPaths = new Set(newFiles.map(f => f.path));
  const nowIso = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const commitMessage = `Snapshot updated at ${nowIso}`;

  let committed = false;
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
    // Pin listing and commit creation to the same HEAD. Without this, another
    // scheduler can add a set between these operations and leave two sets behind.
    const parentSha = await getBranchHead(repo);
    logger.debug('Listing existing schema files', { schemaDir: github.schemaDir });
    const existingEntries = await listDirectory(repo, github.schemaDir, parentSha);
    const oldArtifactPaths = existingEntries
      .filter(e => e.type === 'file' && /\.(?:dbml|md)$/i.test(e.name))
      .map(e => e.path);

    // schemaDir is the managed artifact directory: after every successful run it
    // contains only the DBML/Markdown files produced by this run.
    const changes: FileChange[] = [
      ...newFiles,
      ...oldArtifactPaths
        .filter(p => !newPaths.has(p))
        .map(p => ({ path: p, content: null })),
    ];

    logger.info('Committing file changes', {
      changes: changes.length,
      repository: `${repo.owner}/${repo.repo}`,
      branch: repo.branch,
    });
    try {
      committed = await createSingleCommit(repo, changes, commitMessage, parentSha);
      break;
    } catch (err) {
      const isConcurrentUpdate = err instanceof GitHubApiError
        && err.status === 422
        && err.path.includes('/git/refs/heads/');
      if (!isConcurrentUpdate || attempt === MAX_COMMIT_ATTEMPTS) throw err;
      logger.warn('Branch changed concurrently; retrying', {
        attempt: attempt + 1,
        maxAttempts: MAX_COMMIT_ATTEMPTS,
      });
    }
  }

  logger.info(committed ? 'Done' : 'No changes; commit skipped', { committed });

  if (telegram && committed) {
    await sendTelegram(
      telegram.botToken,
      telegram.chatId,
      `[${name}] Directus schema updated at ${nowIso}`,
      logger,
    );
  }

  return { committed };
}
