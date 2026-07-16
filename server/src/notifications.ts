import { log } from './logger';

export interface NotificationPayload {
  title: string;
  message: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  linkId?: number;
  hash?: string;
  detail?: any;
}

/**
 * Dispatch a notification to external systems.
 * Currently a stub for future integration (e.g. Discord, Slack, Gotify, Apprise).
 */
export async function dispatchNotification(payload: NotificationPayload): Promise<void> {
  // Stub implementation
  log.info('Notifications', `[STUB] Notification dispatched: ${payload.title} - ${payload.message}`);
  
  // Future:
  // if (config.DISCORD_WEBHOOK) {
  //   await fetch(config.DISCORD_WEBHOOK, { ... });
  // }
}
