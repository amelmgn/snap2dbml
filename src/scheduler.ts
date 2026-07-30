import { Cron } from 'croner';
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
    private readonly logger: Pick<NodeJS.WritableStream, 'write'> = process.stderr,
  ) {}

  /** Start scheduled jobs for all targets. */
  start(): void {
    if (this.started) return;
    this.started = true;

    for (const target of this.targets) {
      try {
        const job: Cron = new Cron(
          target.schedule,
          {
            timezone: target.timezone,
            protect: true,
            unref: true,
            catch: (err) => {
              this.logger.write(
                `[sync:${target.name}] Error: ${err instanceof Error ? err.message : err}\n`,
              );
              this.logNextRun(target.name, job);
            },
          },
          async () => {
            await runSync(target, this.logger);
            this.logNextRun(target.name, job);
          },
        );
        this.jobs.set(target.name, job);
        this.logNextRun(target.name, job);
      } catch (err) {
        this.logger.write(
          `[sync:${target.name}] Invalid schedule "${target.schedule}": ${err instanceof Error ? err.message : err}\n`,
        );
      }
    }

    this.logger.write(
      `snap2dbml: Scheduler started with ${this.jobs.size} sync target(s): ${[...this.jobs.keys()].join(', ')}\n`,
    );
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
      this.targets.map(t => runSync(t, this.logger)),
    );
    const failed: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        this.logger.write(`[sync:${this.targets[i].name}] Error: ${msg}\n`);
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
    await runSync(target, this.logger);
  }

  private logNextRun(name: string, job: Cron): void {
    const next = job.nextRun();
    this.logger.write(`[sync:${name}] Next run: ${next ? next.toISOString() : 'never'}\n`);
  }
}
