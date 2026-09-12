import AsyncStorage from '@react-native-async-storage/async-storage';
import {Timestamp} from 'firebase/firestore';

import {isDemoMode} from '@/lib/demo-mode';
import {activities} from '@/services/firestore';
import {readRemoteSleepBaseline, writeRemoteSleepBaseline} from '@/services/sleep-baseline-remote';
import {baselineNightHours, DEFAULT_NIGHT_HOURS, isValidSleepWindow, MAXIMUM_NIGHT_HOURS, MINIMUM_NIGHT_HOURS, suggestedWakeTime, type SleepWindow} from '@/services/sleep-window';

import type {Activity, WithId} from '@/types/smartlife';

/**
 * A direct sleep log deliberately writes an ordinary activity rather than a new
 * collection. `dynamic-insights` already recognises sleep by keyword, so a
 * record titled with one of those words upgrades `evidenceCoverage` through the
 * path that already exists instead of a second, parallel scoring route.
 */
export const SLEEP_LOG_TITLE = 'นอน';
export const SLEEP_LOG_CATEGORY = 'sleep';
const SLEEP_LOG_COLOR = '#7e88b5';
const SLEEP_LOG_NOTE = 'บันทึกด้วยปุ่มเข้านอน/ตื่นนอน';


export type SleepBaseline = SleepWindow & {
  /** False when the value is only on this device because the sync write failed. */
  synced?: boolean;
  updatedAt: string;
};

export {baselineNightHours, formatClockMinutes, parseClockMinutes, suggestedWakeTime} from '@/services/sleep-window';

/** Kept under the older name so existing call sites read the same. */
export const isValidSleepBaseline = isValidSleepWindow;

function storageKey(uid: string) {
  return `smartlife:sleep-baseline:${uid}`;
}

function parseStored(raw: string | null): SleepBaseline | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SleepBaseline>;
    const candidate = {bedtimeMinutes: Number(value.bedtimeMinutes), wakeMinutes: Number(value.wakeMinutes)};
    if (!isValidSleepBaseline(candidate)) return null;
    return {
      ...candidate,
      synced: value.synced !== false,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Device copy first, then the server copy if it is newer. The baseline is a
 * one-off preference, so a failed round trip must not stop the user setting it
 * -- the same local-first shape `monthly-budget` uses for the spending limit.
 */
export async function loadSleepBaseline(uid: string): Promise<SleepBaseline | null> {
  const local = parseStored(await AsyncStorage.getItem(storageKey(uid)).catch(() => null));
  if (isDemoMode) return local;
  const remote = await readRemoteSleepBaseline(uid).catch(() => null);
  if (!remote) return local;
  if (local && local.updatedAt > remote.updatedAt) return local;
  const merged: SleepBaseline = {...remote, synced: true};
  await AsyncStorage.setItem(storageKey(uid), JSON.stringify(merged)).catch(() => undefined);
  return merged;
}

export async function saveSleepBaseline(uid: string, input: Pick<SleepBaseline, 'bedtimeMinutes' | 'wakeMinutes'>) {
  if (!isValidSleepBaseline(input)) throw new Error('ช่วงเวลานอนต้องยาว 2-14 ชั่วโมง');
  const baseline: SleepBaseline = {...input, synced: true, updatedAt: new Date().toISOString()};
  if (!isDemoMode) {
    try {
      await writeRemoteSleepBaseline(uid, input);
    } catch {
      baseline.synced = false;
    }
  }
  await AsyncStorage.setItem(storageKey(uid), JSON.stringify(baseline));
  return baseline;
}

export async function clearSleepBaseline(uid: string) {
  await AsyncStorage.removeItem(storageKey(uid)).catch(() => undefined);
  if (isDemoMode) return;
  await writeRemoteSleepBaseline(uid, null).catch(() => undefined);
}

function looksLikeSleepLog(item: WithId<Activity>) {
  return /(นอน|sleep|bedtime)/i.test(`${item.title} ${item.category ?? ''} ${item.note ?? ''}`);
}

/**
 * The night still waiting for a "ตื่นนอน" tap, if there is one. Anything older
 * than a full long night is ignored rather than closed: a user who forgot to
 * tap wake yesterday should start a fresh night, not book a 30-hour sleep.
 */
export async function findOpenSleepLog(uid: string, now = new Date()): Promise<WithId<Activity> | null> {
  const from = new Date(now.getTime() - MAXIMUM_NIGHT_HOURS * 36e5);
  const recent = await activities.between(uid, from, now);
  return recent
    .filter((item) => item.status === 'in-progress' && looksLikeSleepLog(item))
    .sort((first, second) => (second.startAt?.toMillis?.() ?? 0) - (first.startAt?.toMillis?.() ?? 0))[0] ?? null;
}

/**
 * Writes the night at "เข้านอน" with a provisional end so the Firestore rule
 * `startAt < endAt` holds and the block is visible immediately. It is marked
 * `in-progress`, which is what keeps the placeholder duration out of the
 * burnout evidence until the user actually wakes.
 */
export async function startSleepLog(uid: string, {baseline = null, now = new Date()}: {baseline?: SleepBaseline | null; now?: Date} = {}) {
  const existing = await findOpenSleepLog(uid, now);
  if (existing) return {activityId: existing.id, alreadyOpen: true as const};
  const hours = baselineNightHours(baseline) ?? DEFAULT_NIGHT_HOURS;
  const activityId = await activities.create(uid, {
    category: SLEEP_LOG_CATEGORY,
    color: SLEEP_LOG_COLOR,
    endAt: Timestamp.fromDate(new Date(now.getTime() + hours * 36e5)),
    location: '',
    note: SLEEP_LOG_NOTE,
    source: 'manual',
    startAt: Timestamp.fromDate(now),
    status: 'in-progress',
    title: SLEEP_LOG_TITLE,
    type: 'activity',
  });
  return {activityId, alreadyOpen: false as const};
}

export type FinishSleepResult =
  | {hours: number; reason?: undefined; status: 'saved'}
  | {hours?: undefined; reason: 'no-open-night' | 'too-short'; status: 'skipped'};

/**
 * Closes the open night at "ตื่นนอน". Only here does the record stop being
 * `in-progress`, which is the moment it becomes evidence the model will score.
 */
export async function finishSleepLog(uid: string, {now = new Date()}: {now?: Date} = {}): Promise<FinishSleepResult> {
  const open = await findOpenSleepLog(uid, now);
  if (!open) return {reason: 'no-open-night', status: 'skipped'};
  const startedAt = open.startAt?.toDate?.() ?? null;
  const hours = startedAt ? (now.getTime() - startedAt.getTime()) / 36e5 : 0;
  if (hours < MINIMUM_NIGHT_HOURS) return {reason: 'too-short', status: 'skipped'};
  await activities.update(uid, open.id, {
    endAt: Timestamp.fromDate(now),
    status: 'completed',
  });
  return {hours: Math.round(hours * 10) / 10, status: 'saved'};
}

/** Removes a tap-logged night. Used by the wake flow undo and by cleanup. */
export async function removeSleepLog(uid: string, activityId: string) {
  await activities.remove(uid, activityId);
}

/** How far back a forgotten "ตื่นนอน" is still worth asking the user about. */
const STALE_LOOKBACK_DAYS = 7;

export type StaleSleepLog = {
  activityId: string;
  startedAt: Date;
  /** Hours the session has been sitting open. Always above MAXIMUM_NIGHT_HOURS. */
  openHours: number;
  /** Wake time proposed to the user, from their baseline or a default night. */
  suggestedWakeAt: Date;
};

/**
 * A sleep session left open far longer than any real night, i.e. the user
 * tapped "เข้านอน" and never tapped "ตื่นนอน". `findOpenSleepLog` deliberately
 * ignores these so they cannot book a 30-hour sleep, but ignoring them silently
 * left the record rotting and uncounted -- this surfaces it so the user can
 * either correct it or throw it away.
 */
export async function findStaleSleepLog(uid: string, now = new Date()): Promise<StaleSleepLog | null> {
  const from = new Date(now.getTime() - STALE_LOOKBACK_DAYS * 24 * 36e5);
  const cutoff = new Date(now.getTime() - MAXIMUM_NIGHT_HOURS * 36e5);
  const recent = await activities.between(uid, from, cutoff);
  const stale = recent
    .filter((item) => item.status === 'in-progress' && looksLikeSleepLog(item))
    .sort((first, second) => (second.startAt?.toMillis?.() ?? 0) - (first.startAt?.toMillis?.() ?? 0))[0];
  const startedAt = stale?.startAt?.toDate?.() ?? null;
  if (!stale || !startedAt) return null;
  const baseline = await loadSleepBaseline(uid).catch(() => null);
  return {
    activityId: stale.id,
    openHours: Math.round(((now.getTime() - startedAt.getTime()) / 36e5) * 10) / 10,
    startedAt,
    suggestedWakeAt: suggestedWakeTime(startedAt, baseline),
  };
}

/**
 * Closes a forgotten session at the wake time the user confirmed, turning a
 * record that counted for nothing into one the assessment can use.
 */
export async function resolveStaleSleepLog(uid: string, activityId: string, wakeAt: Date) {
  await activities.update(uid, activityId, {
    endAt: Timestamp.fromDate(wakeAt),
    status: 'completed',
  });
}
