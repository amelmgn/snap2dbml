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
    throw new Error(`GitHub API ${response.status} on ${path}: ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function listDirectory(
  repo: GitHubRepo,
  path: string,
): Promise<Array<{ name: string; path: string; type: string }>> {
  try {
    return await ghFetch<Array<{ name: string; path: string; type: string }>>(
      repo.token,
      `/repos/${repo.owner}/${repo.repo}/contents/${path}?ref=${repo.branch}`,
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
): Promise<void> {
  // 1. Get current commit SHA from branch ref
  const ref = await ghFetch<{ object: { sha: string } }>(
    repo.token,
    `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${repo.branch}`,
  );
  const parentSha = ref.object.sha;

  // 2. Get base tree SHA from parent commit
  const parentCommit = await ghFetch<{ tree: { sha: string } }>(
    repo.token,
    `/repos/${repo.owner}/${repo.repo}/git/commits/${parentSha}`,
  );
  const baseTreeSha = parentCommit.tree.sha;

  // 3. Create blobs for new/updated files; mark deletions with sha: null
  const treeItems: Array<{
    path: string;
    mode: string;
    type: string;
    sha?: string | null;
  }> = [];

  for (const change of changes) {
    if (change.content === null) {
      treeItems.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
    } else {
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
      treeItems.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
  }

  // 4. Create new tree from base + all changes
  const tree = await ghFetch<{ sha: string }>(
    repo.token,
    `/repos/${repo.owner}/${repo.repo}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    },
  );

  // 5. Create commit
  const newCommit = await ghFetch<{ sha: string }>(
    repo.token,
    `/repos/${repo.owner}/${repo.repo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
    },
  );

  // 6. Advance branch ref to new commit
  await ghFetch(
    repo.token,
    `/repos/${repo.owner}/${repo.repo}/git/refs/heads/${repo.branch}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha }),
    },
  );
}
