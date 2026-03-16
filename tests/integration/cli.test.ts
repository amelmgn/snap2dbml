import { beforeAll, beforeEach, describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const CLI = resolve(PROJECT_ROOT, 'bin/snap2dbml.js');
const FIXTURES = resolve(PROJECT_ROOT, 'tests/fixtures');
const pkg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf-8')) as {
  version: string;
};

const tempRoot = mkdtempSync(resolve(PROJECT_ROOT, 'temp/cli-tests-'));
const managedOutputDir = resolve(tempRoot, 'managed-output');
const explicitOutputDir = resolve(tempRoot, 'explicit-output');
const settingsPath = resolve(tempRoot, 'settings.json');

function writeSettings(overrides = {}) {
  writeFileSync(settingsPath, JSON.stringify({
    outputFolder: managedOutputDir,
    cleanOutput: false,
    generateMarkdown: false,
    ...overrides,
  }), 'utf-8');
}

function emptyDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    return;
  }

  for (const entry of readdirSync(dirPath)) {
    rmSync(resolve(dirPath, entry), { recursive: true, force: true });
  }
}

function run(
  args: string[],
  input?: string,
  extraEnv?: NodeJS.ProcessEnv,
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    env: {
      ...process.env,
      SNAP2DBML_SETTINGS: settingsPath,
      ...extraEnv,
    },
    timeout: 10000,
    input,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

describe('CLI', () => {
  const outputFile = resolve(explicitOutputDir, 'test-output.dbml');

  beforeAll(() => {
    mkdirSync(managedOutputDir, { recursive: true });
    mkdirSync(explicitOutputDir, { recursive: true });
  });

  beforeEach(() => {
    writeSettings();
    emptyDir(managedOutputDir);
    emptyDir(explicitOutputDir);
  });

  afterAll(() => {
    if (existsSync(outputFile)) {
      unlinkSync(outputFile);
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('file input', () => {
    it('should convert a file to DBML on stdout with --stdout', () => {
      const result = run([resolve(FIXTURES, 'basic.json'), '--stdout']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Table posts {');
    });

    it('should exit with code 2 for nonexistent file', () => {
      const result = run([resolve(FIXTURES, 'nonexistent.json')]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('not found');
    });

    it('should exit with code 4 for file exceeding max size', () => {
      const result = run([resolve(FIXTURES, 'basic.json'), '--max-size', '0.0001']);
      expect(result.exitCode).toBe(4);
    });
  });

  describe('stdin input', () => {
    it('should convert stdin to DBML', () => {
      const input = readFileSync(resolve(FIXTURES, 'basic.json'), 'utf-8');
      const result = run(['-'], input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Table posts {');
    });

    it('should exit with code 1 for invalid JSON on stdin', () => {
      const result = run(['-'], 'not json');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('output flag', () => {
    it('should write to file with -o flag', () => {
      const result = run([resolve(FIXTURES, 'basic.json'), '-o', outputFile]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(outputFile)).toBe(true);
      const content = readFileSync(outputFile, 'utf-8');
      expect(content).toContain('Table posts {');
    });

    it('should not clean unrelated files when -o is used', () => {
      writeSettings({ cleanOutput: true });
      const keepDbml = resolve(explicitOutputDir, 'keep.dbml');
      const keepMd = resolve(explicitOutputDir, 'keep.md');
      writeFileSync(keepDbml, 'keep', 'utf-8');
      writeFileSync(keepMd, 'keep', 'utf-8');

      const result = run([resolve(FIXTURES, 'basic.json'), '-o', outputFile]);

      expect(result.exitCode).toBe(0);
      expect(existsSync(keepDbml)).toBe(true);
      expect(existsSync(keepMd)).toBe(true);
      expect(existsSync(outputFile)).toBe(true);
    });
  });

  describe('--include-system', () => {
    it('should exclude system tables by default', () => {
      const result = run([resolve(FIXTURES, 'with-system-tables.json'), '--stdout', '--suppress-warnings']);
      expect(result.stdout).not.toContain('directus_users');
    });

    it('should include system tables when flag is set', () => {
      const result = run([resolve(FIXTURES, 'with-system-tables.json'), '--stdout', '--include-system', '--suppress-warnings']);
      expect(result.stdout).toContain('directus_users');
    });
  });

  describe('--include-comments', () => {
    it('should not include comments by default', () => {
      const result = run([resolve(FIXTURES, 'basic.json'), '--stdout']);
      expect(result.stdout).not.toContain('Note');
    });

    it('should include comments when flag is set', () => {
      const result = run([resolve(FIXTURES, 'basic.json'), '--stdout', '--include-comments']);
      expect(result.stdout).toContain('Blog posts');
    });
  });

  describe('--fail-on-circular', () => {
    it('should succeed with warnings by default for circular refs', () => {
      const result = run([resolve(FIXTURES, 'circular-refs.json')]);
      expect(result.exitCode).toBe(0);
    });

    it('should exit with code 5 when --fail-on-circular is set', () => {
      const result = run([resolve(FIXTURES, 'circular-refs.json'), '--fail-on-circular']);
      expect(result.exitCode).toBe(5);
    });
  });

  describe('--verbose', () => {
    it('should print stats to stderr when --verbose is set', () => {
      const result = run([resolve(FIXTURES, 'basic.json'), '--verbose', '--suppress-warnings']);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('tablesProcessed');
      expect(result.stderr).toContain('durationMs');
    });
  });

  describe('--quiet', () => {
    it('should suppress all stderr output', () => {
      const result = run([resolve(FIXTURES, 'all-types.json'), '--quiet']);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  describe('--version', () => {
    it('should print version and exit 0', () => {
      const result = run(['--version']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(pkg.version);
    });
  });

  describe('--help', () => {
    it('should print help and exit 0', () => {
      const result = run(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('snap2dbml');
      expect(result.stdout).toContain('--output');
    });
  });

  describe('error messages', () => {
    it('should show descriptive error for invalid snapshot', () => {
      const result = run(['-'], '{"foo": 1}');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('INVALID_SNAPSHOT');
      expect(result.stderr).toContain('Suggestion');
    });

    it('should reject invalid --max-size values with a clear error', () => {
      const result = run([resolve(FIXTURES, 'basic.json'), '--max-size', 'nope']);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--max-size');
      expect(result.stderr).toContain('positive number');
    });
  });

  describe('clean output management', () => {
    it('should clean only managed timestamped outputs in the configured output folder', () => {
      writeSettings({ cleanOutput: true, generateMarkdown: true });
      writeFileSync(resolve(managedOutputDir, 'schema_20000101_000000.dbml'), 'old schema', 'utf-8');
      writeFileSync(resolve(managedOutputDir, 'description_20000101_000000.md'), 'old markdown', 'utf-8');
      writeFileSync(resolve(managedOutputDir, 'notes.dbml'), 'keep me', 'utf-8');

      const result = run([resolve(FIXTURES, 'basic.json')]);

      expect(result.exitCode).toBe(0);
      expect(existsSync(resolve(managedOutputDir, 'schema_20000101_000000.dbml'))).toBe(false);
      expect(existsSync(resolve(managedOutputDir, 'description_20000101_000000.md'))).toBe(false);
      expect(existsSync(resolve(managedOutputDir, 'notes.dbml'))).toBe(true);

      const outputEntries = readdirSync(managedOutputDir);
      expect(outputEntries.some((entry) => /^schema_\d{8}_\d{6}\.dbml$/.test(entry))).toBe(true);
      expect(outputEntries.some((entry) => /^description_\d{8}_\d{6}\.md$/.test(entry))).toBe(true);
    });
  });
});
