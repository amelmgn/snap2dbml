import { buildConversionArtifacts } from './conversion.js';
import { createSingleCommit, listDirectory } from './github-client.js';
import type { FileChange, GitHubRepo } from './github-client.js';
import type { SyncTarget } from './sync-config.js';
import type { DirectusSnapshot } from './types.js';

const FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function formatTimestamp(date: Date): string {
  const yy = date.getFullYear().toString().slice(2);
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const HH = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yy}${MM}${dd}_${HH}${mm}${ss}`;
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
  logger: Pick<NodeJS.WritableStream, 'write'>,
): Promise<void> {
  try {
    const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_notification: true }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.write(`[sync] Telegram notification failed: HTTP ${response.status} ${body}\n`);
    }
  } catch (err) {
    logger.write(`[sync] Telegram notification failed: ${err instanceof Error ? err.message : err}\n`);
  }
}

export async function runSync(
  target: SyncTarget,
  logger: Pick<NodeJS.WritableStream, 'write'> = process.stderr,
): Promise<void> {
  const { name, directus, github, telegram, generateMarkdown = false, convertOptions } = target;
  const repo: GitHubRepo = {
    owner: github.owner,
    repo: github.repo,
    branch: github.branch ?? 'main',
    token: github.token,
  };

  logger.write(`[sync:${name}] Fetching snapshot from Directus...\n`);
  const snapshot = await fetchDirectusSnapshot(directus.snapshotUrl, directus.bearerToken);
  const snapshotJson = JSON.stringify(snapshot, null, 2);

  logger.write(`[sync:${name}] Converting to DBML${generateMarkdown ? ' + Markdown' : ''}...\n`);
  const result = buildConversionArtifacts(
    snapshot,
    { suppressWarnings: true, ...convertOptions },
    generateMarkdown,
  );

  logger.write(`[sync:${name}] Listing existing schema files in ${github.schemaDir}...\n`);
  const existingEntries = await listDirectory(repo, github.schemaDir);
  const oldSchemaPaths = existingEntries
    .filter(e => e.type === 'file' && /^(schema|description)_\d{6}_\d{6}\.(dbml|md)$/.test(e.name))
    .map(e => e.path);

  const now = new Date();
  const ts = formatTimestamp(now);

  const changes: FileChange[] = [
    { path: github.snapshotPath, content: snapshotJson },
    { path: `${github.schemaDir}/schema_${ts}.dbml`, content: result.dbml },
    ...(generateMarkdown && result.markdown
      ? [{ path: `${github.schemaDir}/description_${ts}.md`, content: result.markdown }]
      : []),
    ...oldSchemaPaths.map(p => ({ path: p, content: null })),
  ];

  const nowIso = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const commitMessage = `Snapshot updated at ${nowIso}`;

  logger.write(
    `[sync:${name}] Committing ${changes.length} file change(s) to ${repo.owner}/${repo.repo} (${repo.branch})...\n`,
  );
  await createSingleCommit(repo, changes, commitMessage);

  logger.write(`[sync:${name}] Done.\n`);

  if (telegram) {
    await sendTelegram(
      telegram.botToken,
      telegram.chatId,
      `[${name}] Directus schema updated at ${nowIso}`,
      logger,
    );
  }
}
