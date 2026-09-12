import {useEffect} from 'react';
import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {router, type Href} from 'expo-router';
import * as Notifications from 'expo-notifications';

import {thailandDateKey, thailandDayStart} from '@/lib/thailand-time';
import {activities} from '@/services/firestore';
import type {Activity, WithId} from '@/types/smartlife';

const CHANNEL_ID = 'smartlife-deadlines';
const PREFIX = 'smartlife-deadline';
const OVERDUE_STORE_KEY = 'smartlife:deadline-notifications:overdue';

type TimestampLike = Date | string | number | {seconds?: number; toDate?: () => Date; toMillis?: () => number} | null | undefined;
type ReminderKind = 'start' | 'soon' | 'due' | 'overdue';

type ReminderPlan = {
  body: string;
  fireAt: Date;
  id: string;
  kind: ReminderKind;
  title: string;
};

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      priority: Notifications.AndroidNotificationPriority.MAX,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

function toDate(value: TimestampLike) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis());
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
}

function addMinutes(date: Date, amount: number) {
  return new Date(date.getTime() + amount * 60000);
}

function leadMinutes(priority?: string) {
  if (priority === 'urgent') return 24 * 60;
  if (priority === 'high' || priority === 'important') return 12 * 60;
  if (priority === 'low') return 60;
  return 6 * 60;
}

function priorityLabel(priority?: string) {
  if (priority === 'urgent') return 'ด่วนมาก';
  if (priority === 'high' || priority === 'important') return 'สำคัญ';
  if (priority === 'low') return 'ไม่ด่วน';
  return 'ควรทำ';
}

function formatThaiTime(date: Date) {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function notificationId(uid: string, taskId: string, kind: ReminderKind) {
  return `${PREFIX}:${uid}:${taskId}:${kind}`;
}

async function configureNotifications() {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      bypassDnd: false,
      description: 'แจ้งเตือนงานใกล้กำหนด งานที่ควรเริ่ม และงานเลยกำหนด',
      importance: Notifications.AndroidImportance.MAX,
      lightColor: '#6F8F6D',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      name: 'SmartLife งานและเดดไลน์',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

async function cancelExistingDeadlineNotifications(uid: string) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => item.identifier.startsWith(`${PREFIX}:${uid}:`))
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}

function buildPlansForTask(uid: string, task: WithId<Activity>, now: Date): ReminderPlan[] {
  const dueAt = toDate(task.startAt);
  if (!dueAt || task.status === 'completed' || task.status === 'cancelled') return [];
  const itemLabel = priorityLabel(task.priority);
  const plans: ReminderPlan[] = [];
  const startAt = addMinutes(dueAt, -leadMinutes(task.priority));
  const soonAt = addMinutes(dueAt, -60);
  const dueNowAt = addMinutes(dueAt, -5);
  const overdueAt = addMinutes(dueAt, 10);

  if (startAt > now) {
    plans.push({
      body: `${itemLabel} · กำหนด ${formatThaiTime(dueAt)} ลองเริ่มแบ่งงานตอนนี้จะไม่เร่งช่วงท้าย`,
      fireAt: startAt,
      id: notificationId(uid, task.id, 'start'),
      kind: 'start',
      title: `ควรเริ่มได้แล้ว: ${task.title}`,
    });
  }
  if (soonAt > now) {
    plans.push({
      body: `เหลือประมาณ 1 ชั่วโมง · ${task.location || 'SmartLife'} · เช็กไฟล์/รายละเอียดให้พร้อม`,
      fireAt: soonAt,
      id: notificationId(uid, task.id, 'soon'),
      kind: 'soon',
      title: `ใกล้กำหนด: ${task.title}`,
    });
  }
  if (dueNowAt > now) {
    plans.push({
      body: `ถึงเวลาส่ง/ทำรายการนี้แล้ว กำหนด ${formatThaiTime(dueAt)}`,
      fireAt: dueNowAt,
      id: notificationId(uid, task.id, 'due'),
      kind: 'due',
      title: `ถึงกำหนดแล้ว: ${task.title}`,
    });
  }
  if (overdueAt > now) {
    plans.push({
      body: `เลยกำหนด ${formatThaiTime(dueAt)} แล้ว ถ้าทำเสร็จให้เปลี่ยนสถานะเป็นเสร็จแล้ว`,
      fireAt: overdueAt,
      id: notificationId(uid, task.id, 'overdue'),
      kind: 'overdue',
      title: `เลยกำหนด: ${task.title}`,
    });
  }

  return plans;
}

async function readOverdueMap() {
  const raw = await AsyncStorage.getItem(OVERDUE_STORE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeOverdueMap(value: Record<string, string>) {
  await AsyncStorage.setItem(OVERDUE_STORE_KEY, JSON.stringify(value));
}

async function showImmediateOverdue(uid: string, overdueTasks: WithId<Activity>[], todayKey: string) {
  if (!overdueTasks.length) return 0;
  const overdueMap = await readOverdueMap();
  let shown = 0;
  for (const task of overdueTasks.slice(0, 3)) {
    const id = `${uid}:${task.id}`;
    if (overdueMap[id] === todayKey) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        badge: 1,
        body: `งานนี้เลยกำหนดแล้ว ถ้ายังไม่เสร็จควรจัดการก่อนรายการอื่น`,
        color: '#D9675F',
        data: {activityId: task.id, kind: 'overdue', url: '/user/smartlife_calendar_day'},
        priority: Notifications.AndroidNotificationPriority.MAX,
        sound: true,
        title: `ค้างส่ง: ${task.title}`,
      },
      identifier: notificationId(uid, task.id, 'overdue'),
      trigger: null,
    });
    overdueMap[id] = todayKey;
    shown += 1;
  }
  await writeOverdueMap(overdueMap);
  return shown;
}

export async function syncDeadlineNotifications(uid: string) {
  if (!uid || Platform.OS === 'web') return {immediateOverdue: 0, permissionGranted: false, scheduled: 0};
  const permissionGranted = await configureNotifications();
  if (!permissionGranted) return {immediateOverdue: 0, permissionGranted, scheduled: 0};

  const now = new Date();
  // The window is a span of Bangkok days, matching `todayKey` just below and
  // every reminder body, which are all formatted in Asia/Bangkok. Built from
  // `setHours(0, 0, 0, 0)` it started at the device's midnight instead, so on a
  // device away from UTC+7 the edges of the window fell on the wrong day.
  const todayKey = thailandDateKey(now);
  const from = thailandDayStart(now, -30);
  const to = thailandDayStart(now, 14);
  const taskItems = (await activities.between(uid, from, to)).filter((item) => item.type === 'task' && item.status !== 'completed' && item.status !== 'cancelled');
  const overdueTasks = taskItems.filter((item) => {
    const dueAt = toDate(item.startAt);
    return dueAt ? dueAt < now : false;
  });

  await cancelExistingDeadlineNotifications(uid);
  const immediateOverdue = await showImmediateOverdue(uid, overdueTasks, todayKey);
  const plans = taskItems.flatMap((task) => buildPlansForTask(uid, task, now)).filter((plan) => plan.fireAt > now).slice(0, 50);

  await Promise.all(plans.map((plan) => Notifications.scheduleNotificationAsync({
    content: {
      badge: 1,
      body: plan.body,
      color: plan.kind === 'overdue' ? '#D9675F' : '#6F8F6D',
      data: {kind: plan.kind, url: '/user/smartlife_calendar_day'},
      priority: Notifications.AndroidNotificationPriority.MAX,
      sound: true,
      title: plan.title,
    },
    identifier: plan.id,
    trigger: {
      channelId: CHANNEL_ID,
      date: plan.fireAt,
      type: Notifications.SchedulableTriggerInputTypes.DATE,
    },
  })));

  return {immediateOverdue, permissionGranted, scheduled: plans.length};
}

export function useDeadlineNotificationNavigation() {
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    const redirect = (notification: Notifications.Notification) => {
      const url = notification.request.content.data?.url;
      if (typeof url === 'string') router.push(url as Href);
    };
    const response = Notifications.getLastNotificationResponse();
    if (response?.notification) redirect(response.notification);
    const subscription = Notifications.addNotificationResponseReceivedListener((nextResponse) => {
      redirect(nextResponse.notification);
    });
    return () => {
      subscription.remove();
    };
  }, []);
}
