import { runSync } from './syncer.js';
import type { SyncTarget } from './sync-config.js';

// ---- Minimal cron parser ----
// Supports: specific values (5), wildcards (*), ranges (1-5), lists (1,3,5), steps (*/5, 1-30/2)
// Only minute, hour, and day-of-week fields are evaluated; day-of-month and month must be "*".

export function parseField(field: string, min: number, max: number, label: string): Set<number> {
  const parseNum = (s: string): number => {
    const n = Number(s);
    if (!/^\d+$/.test(s) || !Number.isInteger(n) || n < min || n > max) {
      throw new Error(`Invalid ${label} value "${s}" in cron field "${field}" (expected ${min}-${max})`);
    }
    return n;
  };

  const set = new Set<number>();
  for (const part of field.split(',')) {
    // Step syntax: */5 or 1-30/2
    if (part.includes('/')) {
      const [rangeStr, stepStr] = part.split('/');
      const step = Number(stepStr);
      if (!/^\d+$/.test(stepStr) || !Number.isInteger(step) || step < 1) {
        throw new Error(`Invalid step "${stepStr}" in cron field "${field}" (expected a positive integer)`);
      }
      let rangeMin = min;
      let rangeMax = max;
      if (rangeStr !== '*') {
        const [a, b] = rangeStr.split('-');
        rangeMin = parseNum(a);
        rangeMax = b !== undefined ? parseNum(b) : max;
      }
      for (let i = rangeMin; i <= rangeMax; i += step) set.add(i);
    } else if (part.includes('-')) {
      const [a, b] = part.split('-');
      const lo = parseNum(a);
      const hi = parseNum(b);
      if (lo > hi) {
        throw new Error(`Invalid range "${part}" in cron field "${field}" (start is greater than end)`);
      }
      for (let i = lo; i <= hi; i++) set.add(i);
    } else if (part === '*') {
      for (let i = min; i <= max; i++) set.add(i);
    } else {
      set.add(parseNum(part));
    }
  }
  return set;
}

export function getNextRunMs(expression: string): number {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression "${expression}" — expected 5 fields (minute hour dom month dow)`);
  }
  const [minuteF, hourF, domF, monthF, dowF] = parts;
  if (domF !== '*' || monthF !== '*') {
    throw new Error(
      `Cron expression "${expression}" uses day-of-month/month fields, which are not supported — use "*" for both`,
    );
  }
  const minutes = parseField(minuteF, 0, 59, 'minute');
  const hours = parseField(hourF, 0, 23, 'hour');
  // In JS: 0=Sun, 1=Mon, ..., 6=Sat. Standard cron also allows 7 for Sunday.
  const daysOfWeek = new Set(
    [...parseField(dowF, 0, 7, 'day-of-week')].map((d) => (d === 7 ? 0 : d)),
  );

  const now = new Date();
  const candidate = new Date(now);
  // Start from the next minute
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 8 days (max gap for "weekdays only" pattern is ~3 days Fri→Mon)
  const maxIterations = 8 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    if (
      daysOfWeek.has(candidate.getDay()) &&
      hours.has(candidate.getHours()) &&
      minutes.has(candidate.getMinutes())
    ) {
      return candidate.getTime() - now.getTime();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`Could not find next run time for cron expression: ${expression}`);
}

// ---- Scheduler ----

export class SyncScheduler {
  private readonly handles = new Map<string, NodeJS.Timeout>();
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
      this.scheduleNext(target);
    }
    this.logger.write(
      `snap2dbml: Scheduler started with ${this.targets.length} sync target(s): ${this.targets.map(t => t.name).join(', ')}\n`,
    );
  }

  /** Stop all scheduled jobs. */
  stop(): void {
    this.started = false;
    for (const handle of this.handles.values()) clearTimeout(handle);
    this.handles.clear();
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

  private scheduleNext(target: SyncTarget): void {
    if (!this.started) return;

    let delayMs: number;
    try {
      delayMs = getNextRunMs(target.schedule);
    } catch (err) {
      this.logger.write(
        `[sync:${target.name}] Invalid schedule "${target.schedule}": ${err instanceof Error ? err.message : err}\n`,
      );
      return;
    }

    const nextRun = new Date(Date.now() + delayMs);
    this.logger.write(`[sync:${target.name}] Next run: ${nextRun.toISOString()}\n`);

    const handle = setTimeout(async () => {
      try {
        await runSync(target, this.logger);
      } catch (err) {
        this.logger.write(
          `[sync:${target.name}] Error: ${err instanceof Error ? err.message : err}\n`,
        );
      }
      this.scheduleNext(target);
    }, delayMs);

    // Allow the process to exit naturally if nothing else keeps it alive
    handle.unref();

    this.handles.set(target.name, handle);
  }
}
