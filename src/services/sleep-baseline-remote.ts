import {deleteDoc, doc, getDoc, serverTimestamp, setDoc} from 'firebase/firestore';

import {db} from '@/lib/firebase';
import {isDemoMode} from '@/lib/demo-mode';

/**
 * The shape stored at `users/{uid}/settings/sleepBaseline`. It holds a stated
 * habit, not a measurement, and nothing else reads it as one -- the burnout
 * model takes it only as a labelled fallback when no night was logged.
 */
export type RemoteSleepBaseline = {
  bedtimeMinutes: number;
  updatedAt: string;
  wakeMinutes: number;
};

export const SLEEP_BASELINE_SETTING_ID = 'sleepBaseline';

function reference(uid: string) {
  return doc(db, 'users', uid, 'settings', SLEEP_BASELINE_SETTING_ID);
}

function toRemote(data: Record<string, unknown> | undefined): RemoteSleepBaseline | null {
  if (!data) return null;
  const bedtimeMinutes = Number(data.bedtimeMinutes);
  const wakeMinutes = Number(data.wakeMinutes);
  if (![bedtimeMinutes, wakeMinutes].every((value) => Number.isInteger(value) && value >= 0 && value < 1440)) return null;
  const updatedAt = data.updatedAt as {toDate?: () => Date} | undefined;
  return {
    bedtimeMinutes,
    updatedAt: typeof updatedAt?.toDate === 'function' ? updatedAt.toDate().toISOString() : new Date(0).toISOString(),
    wakeMinutes,
  };
}

export async function readRemoteSleepBaseline(uid: string): Promise<RemoteSleepBaseline | null> {
  if (isDemoMode) return null;
  const snapshot = await getDoc(reference(uid));
  return snapshot.exists() ? toRemote(snapshot.data()) : null;
}

/** Passing null removes the stored window, which is how "ล้างค่า" is applied. */
export async function writeRemoteSleepBaseline(uid: string, baseline: Omit<RemoteSleepBaseline, 'updatedAt'> | null) {
  if (isDemoMode) return;
  if (!baseline) {
    await deleteDoc(reference(uid));
    return;
  }
  const existing = await getDoc(reference(uid));
  // `createdAt` has to stay fixed across updates, matching the rule the other
  // owned documents are validated by, so it is only sent when the doc is new.
  await setDoc(reference(uid), {
    bedtimeMinutes: baseline.bedtimeMinutes,
    ownerId: uid,
    updatedAt: serverTimestamp(),
    wakeMinutes: baseline.wakeMinutes,
    ...(existing.exists() ? {createdAt: existing.data().createdAt} : {createdAt: serverTimestamp()}),
  });
}
