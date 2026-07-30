import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getNextRun, SyncScheduler } from '../../src/scheduler.js';
import type { SyncTarget } from '../../src/sync-config.js';

vi.mock('../../src/syncer.js', () => ({
  runSync: vi.fn().mockResolvedValue(undefined),
}));

import { runSync } from '../../src/syncer.js';

function makeTarget(overrides: Partial<SyncTarget> = {}): SyncTarget {
  return {
    name: 'test-target',
    schedule: '0 0 * * 1-5',
    directus: { snapshotUrl: 'https://cms.example.com/snapshot', bearerToken: 'token' },
    github: {
      repository: 'owner/repo',
      token: 'gh-token',
      snapshotPath: 'snapshot.json',
      schemaDir: 'schema',
    },
    ...overrides,
  };
}

function makeLogger(): { write: (s: string) => boolean; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write: (s: string) => {
      lines.push(s);
      return true;
    },
  };
}

describe('getNextRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday 2026-06-10 12:00:00 local time
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds the next matching minute', () => {
    expect(getNextRun('30 * * * *')).toEqual(new Date(2026, 5, 10, 12, 30, 0));
  });

  it('respects day-of-week', () => {
    // Next Friday (from Wednesday noon) at 00:00
    expect(getNextRun('0 0 * * 5')).toEqual(new Date(2026, 5, 12, 0, 0, 0));
  });

  it('accepts 7 as Sunday', () => {
    expect(getNextRun('0 0 * * 7')).toEqual(getNextRun('0 0 * * 0'));
  });

  it('supports day-of-month and month fields', () => {
    // 1st of the next month at midnight
    expect(getNextRun('0 0 1 * *')).toEqual(new Date(2026, 6, 1, 0, 0, 0));
    // Only fires in June
    expect(getNextRun('0 9 * 6 *')).toEqual(new Date(2026, 5, 11, 9, 0, 0));
  });

  it('supports day names and L for last day of month', () => {
    expect(getNextRun('0 0 * * MON-FRI')).toEqual(getNextRun('0 0 * * 1-5'));
    expect(getNextRun('0 0 L * *')).toEqual(new Date(2026, 5, 30, 0, 0, 0));
  });

  it('evaluates the schedule in the given timezone', () => {
    const utc = getNextRun('0 9 * * *', 'UTC');
    expect(utc?.getUTCHours()).toBe(9);
  });

  it('throws on invalid expressions instead of silently never firing', () => {
    expect(() => getNextRun('61 * * * *')).toThrow(/minute/i);
    expect(() => getNextRun('* * * * 8')).toThrow(/day ?of ?week/i);
    expect(() => getNextRun('0 0 * *')).toThrow();
  });

  it('throws on an invalid timezone', () => {
    expect(() => getNextRun('0 0 * * *', 'Not/AZone')).toThrow(/timezone/i);
  });
});

describe('SyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    vi.mocked(runSync).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules jobs on start and logs the next run', () => {
    const logger = makeLogger();
    const scheduler = new SyncScheduler([makeTarget()], logger);
    scheduler.start();

    expect(logger.lines.some(l => l.includes('[sync:test-target] Next run:'))).toBe(true);
    expect(logger.lines.some(l => l.includes('Scheduler started with 1 sync target(s)'))).toBe(true);
    scheduler.stop();
  });

  it('fires runSync when the schedule matches', async () => {
    const logger = makeLogger();
    const scheduler = new SyncScheduler([makeTarget({ schedule: '30 12 * * *' })], logger);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(runSync).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('keeps scheduling after a failed run and logs the error', async () => {
    vi.mocked(runSync).mockRejectedValueOnce(new Error('boom'));
    const logger = makeLogger();
    const scheduler = new SyncScheduler([makeTarget({ schedule: '30 12 * * *' })], logger);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(logger.lines.some(l => l.includes('[sync:test-target] Error: boom'))).toBe(true);
    // A next run is still scheduled after the failure
    const nextRunLogs = logger.lines.filter(l => l.includes('Next run:'));
    expect(nextRunLogs.length).toBeGreaterThanOrEqual(2);
    scheduler.stop();
  });

  it('logs and skips a target with an invalid schedule without throwing', () => {
    const logger = makeLogger();
    const scheduler = new SyncScheduler(
      [makeTarget({ name: 'bad', schedule: 'not-a-cron' }), makeTarget({ name: 'good' })],
      logger,
    );
    expect(() => scheduler.start()).not.toThrow();

    expect(logger.lines.some(l => l.includes('[sync:bad] Invalid schedule'))).toBe(true);
    expect(logger.lines.some(l => l.includes('Scheduler started with 1 sync target(s): good'))).toBe(true);
    scheduler.stop();
  });

  it('does not fire after stop()', async () => {
    const logger = makeLogger();
    const scheduler = new SyncScheduler([makeTarget({ schedule: '30 12 * * *' })], logger);
    scheduler.start();
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(runSync).not.toHaveBeenCalled();
  });

  it('runByName runs a single target and rejects unknown names', async () => {
    const targets = [makeTarget({ name: 'one' }), makeTarget({ name: 'two' })];
    const scheduler = new SyncScheduler(targets, makeLogger());

    await scheduler.runByName('two');
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runSync).mock.calls[0][0]).toBe(targets[1]);

    await expect(scheduler.runByName('nope')).rejects.toThrow(/No sync target "nope"/);
  });

  it('runAll runs every target and reports failures', async () => {
    vi.mocked(runSync)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const targets = [makeTarget({ name: 'one' }), makeTarget({ name: 'two' })];
    const logger = makeLogger();
    const scheduler = new SyncScheduler(targets, logger);

    await expect(scheduler.runAll()).rejects.toThrow(/1 sync target\(s\) failed: one/);
    expect(runSync).toHaveBeenCalledTimes(2);
  });
});
