import {AppRegistry, Platform} from 'react-native';

import {auth} from '@/lib/firebase';
import {updateAndroidSleepWidget} from '@/services/android-home-widget';
import {findOpenSleepLog, finishSleepLog, formatClockMinutes, startSleepLog} from '@/services/sleep-log';

/**
 * The name a native Headless JS task is started by. The Android sleep widget's
 * "เข้านอน"/"ตื่นนอน" buttons start this via `SmartLifeSleepWidgetTaskService`
 * without ever opening the app, so it must stay registered from the very first
 * moment the JS bundle loads -- see the side-effect import in `_layout.tsx`.
 */
export const SLEEP_WIDGET_TASK_NAME = 'SmartLifeSleepWidgetTask';

type SleepWidgetTaskAction = 'go_to_bed' | 'wake_up';
type SleepWidgetTaskData = {action?: SleepWidgetTaskAction};

async function statusTextFor(uid: string) {
  const open = await findOpenSleepLog(uid).catch(() => null);
  const startedAt = open?.startAt?.toDate?.() ?? null;
  if (startedAt) {
    return `กำลังนอนอยู่ เริ่ม ${formatClockMinutes(startedAt.getHours() * 60 + startedAt.getMinutes())} น.`;
  }
  return 'พร้อมบันทึกการนอนคืนนี้';
}

/**
 * Runs with no app UI on screen, so there is nowhere to show an error dialog.
 * A failed write leaves the widget showing its previous status rather than a
 * misleading "done" state -- the user finds out for certain next time they
 * open the app, where the same `startSleepLog`/`finishSleepLog` calls the
 * in-app buttons use will report it normally.
 */
async function sleepWidgetTask(data: SleepWidgetTaskData = {}) {
  await auth.authStateReady();
  const uid = auth.currentUser?.uid;
  if (!uid) {
    await updateAndroidSleepWidget('เปิดแอปแล้วเข้าสู่ระบบก่อนใช้ปุ่มนี้').catch(() => undefined);
    return;
  }

  try {
    if (data.action === 'go_to_bed') await startSleepLog(uid);
    else if (data.action === 'wake_up') await finishSleepLog(uid);
    else return;
  } catch {
    return;
  }

  const statusText = await statusTextFor(uid).catch(() => 'พร้อมบันทึกการนอนคืนนี้');
  await updateAndroidSleepWidget(statusText).catch(() => undefined);
}

// The receiving service (`SmartLifeSleepWidgetTaskService`) only exists on
// Android, so registering elsewhere would just be dead weight.
if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask(SLEEP_WIDGET_TASK_NAME, () => sleepWidgetTask);
}
