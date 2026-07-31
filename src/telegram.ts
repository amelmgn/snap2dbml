import type { Logger } from './logger.js';
import type { TelegramNotificationMode, TelegramSyncConfig } from './sync-config.js';

const TELEGRAM_TIMEOUT_MS = 30_000;

export type SyncNotificationOutcome = 'success' | 'failure';

export function shouldSendTelegramNotification(
  mode: TelegramNotificationMode | undefined,
  outcome: SyncNotificationOutcome,
): boolean {
  const resolvedMode = mode ?? 'success';
  return resolvedMode === 'always' || resolvedMode === outcome;
}

export async function sendTelegramNotification(
  config: TelegramSyncConfig,
  text: string,
  logger: Logger,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          disable_notification: true,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn('Telegram notification failed', { status: response.status, body });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sanitizedMessage = message.replaceAll(config.botToken, '[REDACTED]');
    logger.warn('Telegram notification failed', { err: new Error(sanitizedMessage) });
  } finally {
    clearTimeout(timer);
  }
}
