import * as Device from 'expo-device';
import {Platform} from 'react-native';

// Avoid evaluating Expo's native push-token auto-registration side effect on web.
const Notifications: typeof import('expo-notifications') = Platform.OS === 'web' ? {} as typeof import('expo-notifications') : require('expo-notifications');


import {adaptiveScheduling} from '@/services/adaptive-scheduling';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function registerAdaptivePushNotifications() {
  if (Platform.OS === 'web' || !Device.isDevice) return {registered: false, reason: 'physical-device-required'} as const;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('adaptive-scheduling', {
      importance: Notifications.AndroidImportance.DEFAULT,
      name: 'Adaptive Scheduling',
      sound: undefined,
      vibrationPattern: [0, 180],
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return {registered: false, reason: 'permission-denied'} as const;
  const deviceToken = await Notifications.getDevicePushTokenAsync();
  const token = typeof deviceToken.data === 'string' ? deviceToken.data : JSON.stringify(deviceToken.data);
  if (!token) return {registered: false, reason: 'token-unavailable'} as const;
  await adaptiveScheduling.registerPushToken(token, Platform.OS as 'android' | 'ios');
  return {registered: true} as const;
}

// ── Task Reminder Scheduling ────────────────────────────────────────

const TASK_REMINDER_CATEGORY = 'task-reminder';

type TaskLike = {
  id: string;
  title: string;
  startAt?: {toDate?: () => Date} | Date | string;
  endAt?: {toDate?: () => Date} | Date | string;
  priority?: 'urgent' | 'important' | 'high' | 'normal';
  status?: string;
};

function toDate(value: TaskLike['startAt']): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  return null;
}

function reminderOffsetsMs(priority: string | undefined): number[] {
  switch (priority) {
    case 'urgent':
      return [60 * 60 * 1000, 15 * 60 * 1000]; // 1 hour + 15 minutes
    case 'important':
    case 'high':
      return [2 * 60 * 60 * 1000]; // 2 hours
    default:
      return [30 * 60 * 1000]; // 30 minutes
  }
}

function priorityLabel(priority: string | undefined): string {
  switch (priority) {
    case 'urgent': return '🔴 ด่วน';
    case 'important':
    case 'high': return '🟡 สำคัญ';
    default: return '📋 ทั่วไป';
  }
}

function formatTime(offset: number): string {
  const minutes = Math.round(offset / 60_000);
  if (minutes >= 60) return `${Math.round(minutes / 60)} ชั่วโมง`;
  return `${minutes} นาที`;
}

export async function cancelAllTaskReminders() {
  if (Platform.OS === 'web') return 0;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const taskIds = all
    .filter((n) => n.content.categoryIdentifier === TASK_REMINDER_CATEGORY)
    .map((n) => n.identifier);
  await Promise.all(taskIds.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
  return taskIds.length;
}

export async function scheduleTaskReminders(tasks: TaskLike[]) {
  if (Platform.OS === 'web') return {scheduled: 0};

  // Set up notification channel for task reminders on Android
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('task-reminders', {
      importance: Notifications.AndroidImportance.HIGH,
      name: 'แจ้งเตือนงาน',
      sound: 'default',
      vibrationPattern: [0, 250, 200, 250],
    });
  }

  // Request permission if not granted
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return {scheduled: 0};

  // Cancel existing task reminders
  await cancelAllTaskReminders();

  const now = Date.now();
  let scheduled = 0;

  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'cancelled') continue;

    const deadline = toDate(task.endAt) ?? toDate(task.startAt);
    if (!deadline) continue;

    const offsets = reminderOffsetsMs(task.priority);
    for (const offset of offsets) {
      const triggerTime = deadline.getTime() - offset;
      const secondsFromNow = Math.round((triggerTime - now) / 1000);

      // Only schedule if in the future (at least 60 seconds from now)
      if (secondsFromNow < 60) continue;

      await Notifications.scheduleNotificationAsync({
        content: {
          body: `${priorityLabel(task.priority)} — "${task.title}" อีก ${formatTime(offset)}`,
          categoryIdentifier: TASK_REMINDER_CATEGORY,
          data: {taskId: task.id, type: 'task-reminder'},
          sound: 'default',
          title: 'งานใกล้กำหนด ⏰',
        },
        trigger: {
          channelId: Platform.OS === 'android' ? 'task-reminders' : undefined,
          seconds: secondsFromNow,
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        },
      });
      scheduled++;
    }
  }

  return {scheduled};
}
