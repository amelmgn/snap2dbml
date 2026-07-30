import { Cron } from 'croner';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';
import { StatusRegistry } from './status.js';
import { runSync } from './syncer.js';
import type { SyncTarget } from './sync-config.js';

/**
 * Validate a cron expression (and optional IANA timezone) and return the next
 * run time. Throws with a descriptive error when either is invalid.
 */
export function getNextRun(expression: string, timezone?: string): Date | null {
  const probe = new Cron(expression, { timezone });
  try {
    // Timezone problems only surface when a run time is computed
    return probe.nextRun();
  } finally {
    probe.stop();
  }
}

export class SyncScheduler {
  private readonly jobs = new Map<string, Cron>();
  private started = false;

  constructor(
    private readonly targets: SyncTarget[],
    private readonly logger: Logger = createLogger(),
    private readonly registry: StatusRegistry = new StatusRegistry(),
  ) {}

  /** Start scheduled jobs for all targets. */
  start(): void {
    if (this.started) return;
    this.started = true;

    for (const target of this.targets) {
      const log = this.logger.child(`sync:${target.name}`);
      try {
        const job: Cron = new Cron(
          target.schedule,
          {
            timezone: target.timezone,
            protect: true,
            unref: true,
            catch: (err) => {
              this.registry.recordFailure(target.name, err);
              log.error('Sync failed', { err });
              this.logNextRun(target.name, job);
            },
          },
          async () => {
            this.registry.recordStart(target.name);
            const { committed } = await runSync(target, this.logger);
            this.registry.recordSuccess(target.name, committed);
            this.logNextRun(target.name, job);
          },
        );
        this.jobs.set(target.name, job);
        this.logNextRun(target.name, job);
      } catch (err) {
        log.error(`Invalid schedule "${target.schedule}"`, { err });
      }
    }

    this.logger.info('Scheduler started', {
      targets: [...this.jobs.keys()],
    });
  }

  /** Stop all scheduled jobs. */
  stop(): void {
    this.started = false;
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  /** Run all sync targets once immediately (parallel). Throws if any target failed. */
  async runAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.targets.map(t => this.runTracked(t)),
    );
    const failed: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        this.logger.child(`sync:${this.targets[i].name}`).error('Sync failed', { err: r.reason });
        failed.push(this.targets[i].name);
      }
    }
    if (failed.length > 0) {
      throw new Error(`${failed.length} sync target(s) failed: ${failed.join(', ')}`);
    }
  }

  /** Run a single named sync target immediately. */
  async runByName(name: string): Promise<void> {
    const target = this.targets.find(t => t.name === name);
    if (!target) {
      throw new Error(
        `No sync target "${name}". Available: ${this.targets.map(t => t.name).join(', ')}`,
      );
    }
    await this.runTracked(target);
  }

  private async runTracked(target: SyncTarget): Promise<void> {
    this.registry.recordStart(target.name);
    try {
      const { committed } = await runSync(target, this.logger);
      this.registry.recordSuccess(target.name, committed);
    } catch (err) {
      this.registry.recordFailure(target.name, err);
      throw err;
    }
  }

  private logNextRun(name: string, job: Cron): void {
    const next = job.nextRun();
    this.registry.setNextRun(name, next);
    this.logger.child(`sync:${name}`).info('Next run scheduled', {
      nextRun: next ? next.toISOString() : null,
    });
  }
}
