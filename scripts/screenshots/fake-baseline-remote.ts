/**
 * Screenshot-harness stand-in for the Firestore-backed baseline. Keeping this
 * out of the bundle is what stops `@/lib/firebase` (and its native-only auth
 * persistence import) from being pulled into a browser build. The baseline the
 * card shows therefore comes from the in-memory AsyncStorage stub, which is all
 * the screenshots need.
 */
export type RemoteSleepBaseline = {bedtimeMinutes: number; updatedAt: string; wakeMinutes: number};

export const SLEEP_BASELINE_SETTING_ID = 'sleepBaseline';

export async function readRemoteSleepBaseline(): Promise<RemoteSleepBaseline | null> {
  return null;
}

export async function writeRemoteSleepBaseline(): Promise<void> {
  return undefined;
}
