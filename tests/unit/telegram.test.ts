import { describe, expect, it } from 'vitest';
import { shouldSendTelegramNotification } from '../../src/telegram.js';

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
