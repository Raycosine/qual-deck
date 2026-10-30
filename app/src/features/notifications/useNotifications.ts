import { useEffect } from 'react';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { invoke } from '@tauri-apps/api/core';
import { select, execute } from '../../lib/db';

export function useNotificationsAndTray() {
  useEffect(() => {
    const init = async () => {
      try {
        const now = new Date().toISOString();
        const result = await select<{ count: number }>(`
          SELECT COUNT(*) as count
          FROM problem_state ps
          JOIN problems p ON ps.pid = p.pid
          JOIN courses c ON p.course_id = c.course_id
          WHERE ps.next_review_at <= ?
            AND c.tracking_enabled = 1
        `, [now]);
        const count = result[0]?.count ?? 0;

        // Update tray label
        await invoke('update_tray_due_count', { count });

        // Check notification preference
        const notifRows = await select<{ value: string }>(
          `SELECT value FROM settings WHERE key = 'notifications_enabled'`
        );
        if (notifRows[0]?.value !== 'true') return;

        // Only send once per day
        const today = new Date().toISOString().split('T')[0];
        const lastRows = await select<{ value: string }>(
          `SELECT value FROM settings WHERE key = 'last_notification_date'`
        );
        if (lastRows[0]?.value === today) return;

        if (count > 0) {
          let permitted = await isPermissionGranted();
          if (!permitted) {
            const perm = await requestPermission();
            permitted = perm === 'granted';
          }
          if (permitted) {
            sendNotification({
              title: 'QualDeck — Reviews Due',
              body: `You have ${count} problem${count === 1 ? '' : 's'} due for review today.`,
            });
            await execute(
              `INSERT OR REPLACE INTO settings (key, value) VALUES ('last_notification_date', ?)`,
              [today]
            );
          }
        }
      } catch (err) {
        console.error('Notification/tray init error:', err);
      }
    };

    init();
  }, []);
}
