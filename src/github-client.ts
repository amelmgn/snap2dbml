const GITHUB_API = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export interface GitHubRepo {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface FileChange {
  path: string;
  /** UTF-8 file content, or null to delete the file */
  content: string | null;
}

async function ghFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new GitHubApiError(response.status, path, body);
  }

  return response.json() as Promise<T>;
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly responseBody: string,
  ) {
    super(`GitHub API ${status} on ${path}: ${responseBody}`);
    this.name = 'GitHubApiError';
  }
}

export async function getBranchHead(repo: GitHubRepo): Promise<string> {
  const ref = await ghFetch<{ object: { sha: string } }>(
    repo.token,
    `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${repo.branch}`,
  );
  return ref.object.sha;
}

export async function listDirectory(
  repo: GitHubRepo,
  path: string,
  ref: string = repo.branch,
): Promise<Array<{ name: string; path: string; type: string }>> {
  try {
    return await ghFetch<Array<{ name: string; path: string; type: string }>>(
      repo.token,
      `/repos/${repo.owner}/${repo.repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes('GitHub API 404')) return [];
    throw err;
  }
}

/**
 * Creates a single commit with multiple file changes (create, update, or delete)
 * using the GitHub Git Data API (trees + blobs + commit).
 */
export async function createSingleCommit(
  repo: GitHubRepo,
  changes: FileChange[],
  message: string,
  expectedParentSha?: string,
): Promise<boolean> {
  const parentSha = expectedParentSha ?? await getBranchHead(repo);
  // 1. Get the base tree from the exact revision used to plan the changes.
  const parentCommit = await ghFetch<{ tree: { sha: string } }>(
    repo.token,
    `/repos/${repo.owner}/${repo.repo}/git/commits/${parentSha}`,
  );
  const baseTreeSha = parentCommit.tree.sha;

  // 2. Create blobs for new/updated files (in parallel); mark deletions with sha: null
  const treeItems = await Promise.all(
    changes.map(async (change): Promise<{
      path: string;
      mode: string;
      type: string;
      sha?: string | null;
    }> => {
      if (change.content === null) {
        return { path: change.path, mode: '100644', type: 'blob', sha: null };
      }
      const blob = await ghFetch<{ sha: string }>(
        repo.token,
        `/repos/${repo.owner}/${repo.repo}/git/blobs`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: Buffer.from(change.content, 'utf-8').toString('base64'),
            encoding: 'base64',
          }),
        },
      );
      return { path: change.path, mode: '100644', type: 'blob', sha: blob.sha };
    }),
  );

  // 3. Create new tree from base + all changes
  const tree = await ghFetch<{ sha: string }>(
    repo.token,
    `/repos/${repo.owner}/${repo.repo}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    },
  );

  // GitHub allows commits whose tree is identical to their parent. They are never
  // useful for sync and appear in the UI as commits with zero changed files.
  if (tree.sha === baseTreeSha) return false;

  // 4. Create commit
  const newCommit = await ghFetch<{ sha: string }>(
    repo.token,
    `/repos/${repo.owner}/${repo.repo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
    },
  );

  // 5. Advance the branch. GitHub rejects this when another writer moved HEAD;
  // callers can then re-list the directory at the new HEAD and retry safely.
  await ghFetch(
    repo.token,
    `/repos/${repo.owner}/${repo.repo}/git/refs/heads/${repo.branch}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha }),
    },
  );

  return true;
}
