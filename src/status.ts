import type { LogRecord } from './logger.js';

export interface TargetStatus {
  name: string;
  running: boolean;
  lastRunAt?: string;
  lastOutcome?: 'success' | 'failure';
  /** Whether the last successful run produced a GitHub commit. */
  lastCommitted?: boolean;
  lastError?: string;
  nextRunAt?: string;
}

const MAX_RECENT_LOGS = 200;

/**
 * In-memory record of sync target activity and recent log lines,
 * served by GET /status. Not persisted across restarts.
 */
export class StatusRegistry {
  private readonly targetStates = new Map<string, TargetStatus>();
  private readonly logBuffer: LogRecord[] = [];

  recordStart(name: string): void {
    const state = this.getOrCreate(name);
    state.running = true;
    state.lastRunAt = new Date().toISOString();
  }

  recordSuccess(name: string, committed: boolean): void {
    const state = this.getOrCreate(name);
    state.running = false;
    state.lastOutcome = 'success';
    state.lastCommitted = committed;
    delete state.lastError;
  }

  recordFailure(name: string, error: unknown): void {
    const state = this.getOrCreate(name);
    state.running = false;
    state.lastOutcome = 'failure';
    state.lastError = error instanceof Error ? error.message : String(error);
  }

  setNextRun(name: string, nextRun: Date | null): void {
    const state = this.getOrCreate(name);
    if (nextRun) {
      state.nextRunAt = nextRun.toISOString();
    } else {
      delete state.nextRunAt;
    }
  }

  targets(): TargetStatus[] {
    return [...this.targetStates.values()].map(state => ({ ...state }));
  }

  pushLog(record: LogRecord): void {
    this.logBuffer.push(record);
    if (this.logBuffer.length > MAX_RECENT_LOGS) {
      this.logBuffer.shift();
    }
  }

  recentLogs(): LogRecord[] {
    return [...this.logBuffer];
  }

  private getOrCreate(name: string): TargetStatus {
    let state = this.targetStates.get(name);
    if (!state) {
      state = { name, running: false };
      this.targetStates.set(name, state);
    }
    return state;
  }
}
