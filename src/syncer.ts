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
import {
  renderTelegramMessage,
  sendTelegramNotification,
  shouldSendTelegramNotification,
} from './telegram.js';
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

function formatNotificationTime(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatFailureReason(err: unknown, target: SyncTarget): string {
  let message = err instanceof Error ? err.message : String(err);
  const secrets = [
    target.directus.bearerToken,
    target.github.token,
    target.telegram?.botToken,
  ];
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, '[REDACTED]');
  }
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

async function performSync(
  target: SyncTarget,
  logger: Logger,
): Promise<{ committed: boolean }> {
  const { directus, github, generateMarkdown = false, convertOptions } = target;
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

  return { committed };
}

export async function runSync(
  target: SyncTarget,
  baseLogger: Logger = createLogger(),
): Promise<{ committed: boolean }> {
  const { name, telegram } = target;
  const logger = baseLogger.child(`sync:${name}`);

  try {
    const result = await performSync(target, logger);
    if (telegram && shouldSendTelegramNotification(telegram.notifyOn, 'success')) {
      await sendTelegramNotification(
        telegram,
        renderTelegramMessage(
          telegram,
          result.committed ? 'success' : 'noChanges',
          { name, time: formatNotificationTime(new Date()) },
        ),
        logger,
      );
    }
    return result;
  } catch (err) {
    if (telegram && shouldSendTelegramNotification(telegram.notifyOn, 'failure')) {
      await sendTelegramNotification(
        telegram,
        renderTelegramMessage(telegram, 'failure', {
          name,
          time: formatNotificationTime(new Date()),
          error: formatFailureReason(err, target),
        }),
        logger,
      );
    }
    throw err;
  }
}
