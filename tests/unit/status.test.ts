import { describe, expect, it } from 'vitest';
import { StatusRegistry } from '../../src/status.js';

describe('StatusRegistry', () => {
  it('tracks a run through start and success', () => {
    const registry = new StatusRegistry();

    registry.recordStart('demo');
    expect(registry.targets()).toEqual([
      expect.objectContaining({ name: 'demo', running: true }),
    ]);

    registry.recordSuccess('demo', true);
    const [status] = registry.targets();
    expect(status).toMatchObject({
      name: 'demo',
      running: false,
      lastOutcome: 'success',
      lastCommitted: true,
    });
    expect(status.lastError).toBeUndefined();
    expect(new Date(status.lastRunAt!).toISOString()).toBe(status.lastRunAt);
  });

  it('records failures and clears the error on the next success', () => {
    const registry = new StatusRegistry();

    registry.recordStart('demo');
    registry.recordFailure('demo', new Error('boom'));
    expect(registry.targets()[0]).toMatchObject({
      running: false,
      lastOutcome: 'failure',
      lastError: 'boom',
    });

    registry.recordStart('demo');
    registry.recordSuccess('demo', false);
    const [status] = registry.targets();
    expect(status.lastOutcome).toBe('success');
    expect(status.lastError).toBeUndefined();
  });

  it('stores and clears the next run time', () => {
    const registry = new StatusRegistry();
    const next = new Date('2026-08-01T00:00:00Z');

    registry.setNextRun('demo', next);
    expect(registry.targets()[0].nextRunAt).toBe(next.toISOString());

    registry.setNextRun('demo', null);
    expect(registry.targets()[0].nextRunAt).toBeUndefined();
  });

  it('returns copies so callers cannot mutate internal state', () => {
    const registry = new StatusRegistry();
    registry.recordStart('demo');

    registry.targets()[0].name = 'tampered';
    expect(registry.targets()[0].name).toBe('demo');
  });

  it('caps recent logs at 200 records', () => {
    const registry = new StatusRegistry();
    for (let i = 0; i < 250; i++) {
      registry.pushLog({ time: new Date().toISOString(), level: 'info', msg: `line ${i}` });
    }

    const logs = registry.recentLogs();
    expect(logs).toHaveLength(200);
    expect(logs[0].msg).toBe('line 50');
    expect(logs[199].msg).toBe('line 249');
  });
});
