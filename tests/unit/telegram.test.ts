import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TELEGRAM_MESSAGES,
  renderTelegramMessage,
  shouldSendTelegramNotification,
} from '../../src/telegram.js';
import type { TelegramSyncConfig } from '../../src/sync-config.js';

describe('shouldSendTelegramNotification', () => {
  it.each([
    [undefined, 'success', true],
    [undefined, 'failure', false],
    ['success', 'success', true],
    ['success', 'failure', false],
    ['failure', 'success', false],
    ['failure', 'failure', true],
    ['always', 'success', true],
    ['always', 'failure', true],
  ] as const)('mode %s with outcome %s returns %s', (mode, outcome, expected) => {
    expect(shouldSendTelegramNotification(mode, outcome)).toBe(expected);
  });
});

describe('renderTelegramMessage', () => {
  const config: TelegramSyncConfig = { botToken: 'token', chatId: 'chat' };

  it('preserves the existing messages as defaults', () => {
    expect(renderTelegramMessage(config, 'success', {
      name: 'catalog',
      time: '2026-07-30 00:00:02 UTC',
    })).toBe('✅ [catalog] Directus schema updated at 2026-07-30 00:00:02 UTC');
    expect(renderTelegramMessage(config, 'noChanges', {
      name: 'catalog',
      time: '2026-07-30 00:00:02 UTC',
    })).toBe(
      '✅ [catalog] Sync completed successfully; no schema changes detected at 2026-07-30 00:00:02 UTC',
    );
    expect(renderTelegramMessage(config, 'failure', {
      name: 'catalog',
      time: '2026-07-30 00:00:02 UTC',
      error: 'HTTP 500',
    })).toBe(
      '❌ [catalog] Directus schema sync failed at 2026-07-30 00:00:02 UTC\nHTTP 500',
    );
    expect(DEFAULT_TELEGRAM_MESSAGES.success).toContain('{{name}}');
  });

  it('renders configured templates and replaces repeated placeholders', () => {
    const customConfig: TelegramSyncConfig = {
      ...config,
      messages: {
        success: '{{name}} updated at {{time}} ({{name}})',
        noChanges: '{{name}} unchanged',
        failure: '{{name}}: {{error}} @ {{time}}',
      },
    };

    expect(renderTelegramMessage(customConfig, 'success', {
      name: 'catalog',
      time: 'now',
    })).toBe('catalog updated at now (catalog)');
    expect(renderTelegramMessage(customConfig, 'noChanges', {
      name: 'catalog',
      time: 'now',
    })).toBe('catalog unchanged');
    expect(renderTelegramMessage(customConfig, 'failure', {
      name: 'catalog',
      time: 'now',
      error: 'boom',
    })).toBe('catalog: boom @ now');
  });
});
