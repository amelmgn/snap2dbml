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

interface TimestampParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function getTimestampParts(date: Date, timezone: string): TimestampParts {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const parts = Object.fromEntries(formatted.map(part => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function formatTimestamp(date: Date, timezone: string): string {
  const { year, month, day, hour, minute, second } = getTimestampParts(date, timezone);
  return `${year}${month}${day}_${hour}${minute}${second}`;
}

function formatCommitTime(date: Date, timezone: string): string {
  const { year, month, day, hour, minute, second } = getTimestampParts(date, timezone);
  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${timezone}`;
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
  const {
    directus,
    github,
    generateMarkdown = false,
    convertOptions,
    timezone = 'UTC',
  } = target;
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
  const ts = formatTimestamp(now, timezone);

  const newFiles: FileChange[] = [
    { path: github.snapshotPath, content: snapshotJson },
    { path: `${github.schemaDir}/schema_${ts}.dbml`, content: result.dbml },
    ...(generateMarkdown && result.markdown
      ? [{ path: `${github.schemaDir}/description_${ts}.md`, content: result.markdown }]
      : []),
  ];

  const newPaths = new Set(newFiles.map(f => f.path));
  const commitMessage = `Snapshot updated at ${formatCommitTime(now, timezone)}`;

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
  const { name, telegram, timezone = 'UTC' } = target;
  const logger = baseLogger.child(`sync:${name}`);

  try {
    const result = await performSync(target, logger);
    if (telegram && shouldSendTelegramNotification(telegram.notifyOn, 'success')) {
      await sendTelegramNotification(
        telegram,
        renderTelegramMessage(
          telegram,
          result.committed ? 'success' : 'noChanges',
          { name, time: formatCommitTime(new Date(), timezone) },
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
          time: formatCommitTime(new Date(), timezone),
          error: formatFailureReason(err, target),
        }),
        logger,
      );
    }
    throw err;
  }
}
