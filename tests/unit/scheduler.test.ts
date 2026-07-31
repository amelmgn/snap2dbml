import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getNextRun, SyncScheduler } from '../../src/scheduler.js';
import { StatusRegistry } from '../../src/status.js';
import { captureLogger } from '../helpers/capture-logger.js';
import type { SyncTarget } from '../../src/sync-config.js';

vi.mock('../../src/syncer.js', () => ({
  runSync: vi.fn().mockResolvedValue({ committed: true }),
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

describe('getNextRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday 2026-06-10 12:00:00 UTC
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds the next matching minute', () => {
    expect(getNextRun('30 * * * *')).toEqual(new Date('2026-06-10T12:30:00Z'));
  });

  it('respects day-of-week', () => {
    // Next Friday (from Wednesday noon) at 00:00
    expect(getNextRun('0 0 * * 5')).toEqual(new Date('2026-06-12T00:00:00Z'));
  });

  it('accepts 7 as Sunday', () => {
    expect(getNextRun('0 0 * * 7')).toEqual(getNextRun('0 0 * * 0'));
  });

  it('supports day-of-month and month fields', () => {
    // 1st of the next month at midnight
    expect(getNextRun('0 0 1 * *')).toEqual(new Date('2026-07-01T00:00:00Z'));
    // Only fires in June
    expect(getNextRun('0 9 * 6 *')).toEqual(new Date('2026-06-11T09:00:00Z'));
  });

  it('supports day names and L for last day of month', () => {
    expect(getNextRun('0 0 * * MON-FRI')).toEqual(getNextRun('0 0 * * 1-5'));
    expect(getNextRun('0 0 L * *')).toEqual(new Date('2026-06-30T00:00:00Z'));
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
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'));
    vi.mocked(runSync).mockClear();
    vi.mocked(runSync).mockResolvedValue({ committed: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules jobs on start and logs the next run', () => {
    const { logger, records } = captureLogger();
    const scheduler = new SyncScheduler([makeTarget()], logger);
    scheduler.start();

    expect(records).toContainEqual(
      expect.objectContaining({ scope: 'sync:test-target', msg: 'Next run scheduled' }),
    );
    expect(records).toContainEqual(
      expect.objectContaining({ msg: 'Scheduler started', targets: ['test-target'] }),
    );
    scheduler.stop();
  });

  it('fires runSync when the schedule matches and updates the registry', async () => {
    const { logger } = captureLogger();
    const registry = new StatusRegistry();
    const scheduler = new SyncScheduler([makeTarget({ schedule: '30 12 * * *' })], logger, registry);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(registry.targets()[0]).toMatchObject({
      name: 'test-target',
      running: false,
      lastOutcome: 'success',
      lastCommitted: true,
    });
    scheduler.stop();
  });

  it('keeps scheduling after a failed run, logs the error, and records the failure', async () => {
    vi.mocked(runSync).mockRejectedValueOnce(new Error('boom'));
    const { logger, records } = captureLogger();
    const registry = new StatusRegistry();
    const scheduler = new SyncScheduler([makeTarget({ schedule: '30 12 * * *' })], logger, registry);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        scope: 'sync:test-target',
        msg: 'Sync failed',
        err: expect.objectContaining({ message: 'boom' }),
      }),
    );
    expect(registry.targets()[0]).toMatchObject({ lastOutcome: 'failure', lastError: 'boom' });
    // A next run is still scheduled after the failure
    const nextRunLogs = records.filter(r => r.msg === 'Next run scheduled');
    expect(nextRunLogs.length).toBeGreaterThanOrEqual(2);
    scheduler.stop();
  });

  it('logs and skips a target with an invalid schedule without throwing', () => {
    const { logger, records } = captureLogger();
    const scheduler = new SyncScheduler(
      [makeTarget({ name: 'bad', schedule: 'not-a-cron' }), makeTarget({ name: 'good' })],
      logger,
    );
    expect(() => scheduler.start()).not.toThrow();

    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        scope: 'sync:bad',
        msg: 'Invalid schedule "not-a-cron"',
      }),
    );
    expect(records).toContainEqual(
      expect.objectContaining({ msg: 'Scheduler started', targets: ['good'] }),
    );
    scheduler.stop();
  });

  it('does not fire after stop()', async () => {
    const { logger } = captureLogger();
    const scheduler = new SyncScheduler([makeTarget({ schedule: '30 12 * * *' })], logger);
    scheduler.start();
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(runSync).not.toHaveBeenCalled();
  });

  it('runByName runs a single target and rejects unknown names', async () => {
    const targets = [makeTarget({ name: 'one' }), makeTarget({ name: 'two' })];
    const scheduler = new SyncScheduler(targets, captureLogger().logger);

    await scheduler.runByName('two');
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runSync).mock.calls[0][0]).toBe(targets[1]);

    await expect(scheduler.runByName('nope')).rejects.toThrow(/No sync target "nope"/);
  });

  it('runAll runs every target and reports failures', async () => {
    vi.mocked(runSync)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ committed: false });
    const targets = [makeTarget({ name: 'one' }), makeTarget({ name: 'two' })];
    const registry = new StatusRegistry();
    const scheduler = new SyncScheduler(targets, captureLogger().logger, registry);

    await expect(scheduler.runAll()).rejects.toThrow(/1 sync target\(s\) failed: one/);
    expect(runSync).toHaveBeenCalledTimes(2);
    expect(registry.targets()).toContainEqual(
      expect.objectContaining({ name: 'one', lastOutcome: 'failure' }),
    );
    expect(registry.targets()).toContainEqual(
      expect.objectContaining({ name: 'two', lastOutcome: 'success', lastCommitted: false }),
    );
  });
});
