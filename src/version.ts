import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version?: unknown };

export const LIBRARY_VERSION =
  typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
