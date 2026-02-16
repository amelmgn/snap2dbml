import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '../../bin/snap2dbml.js');
const FIXTURES = resolve(import.meta.dirname, '../fixtures');

function run(args: string[], input?: string): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
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
  const outputFile = resolve(import.meta.dirname, 'test-output.dbml');

  afterEach(() => {
    if (existsSync(outputFile)) {
      unlinkSync(outputFile);
    }
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
      expect(result.stdout.trim()).toBe('1.0.0');
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
  });
});
