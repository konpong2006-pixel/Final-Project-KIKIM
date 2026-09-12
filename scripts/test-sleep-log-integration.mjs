// End-to-end check of the direct sleep-logging path against the Firestore and
// Auth emulators, with the production security rules loaded. Everything below
// the test is the real code a device runs: `sleep-log` -> `firestore.ts` ->
// rules -> `dynamic-insights`. Nothing about the scoring is simulated.
import assert from 'node:assert/strict';

import {doc, deleteDoc, getDocs, collection, serverTimestamp, setDoc, Timestamp} from 'firebase/firestore';

import {__signIn, auth, db} from '@/lib/firebase';
import {activities} from '@/services/firestore';
import {calculateBurnoutDynamicInsight} from '@/services/dynamic-insights';
import {
  baselineNightHours,
  clearSleepBaseline,
  finishSleepLog,
  findOpenSleepLog,
  loadSleepBaseline,
  saveSleepBaseline,
  startSleepLog,
} from '@/services/sleep-log';

const EMAIL = 'sleep-log-test@smartlife.test';
const PASSWORD = 'sleep-log-test-password';

function hoursAgo(hours, from = new Date()) {
  return new Date(from.getTime() - hours * 36e5);
}

async function listActivities(uid) {
  const snapshot = await getDocs(collection(db, 'users', uid, 'activities'));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
}

async function main() {
  const credential = await __signIn(EMAIL, PASSWORD);
  const uid = credential.user.uid;

  // The rules require the profile document to exist before owned subcollections
  // accept writes, exactly as registration creates it.
  await setDoc(doc(db, 'users', uid), {
    avatarUrl: '',
    createdAt: serverTimestamp(),
    displayName: 'Sleep Log Test',
    email: EMAIL,
    role: 'user',
    uid,
    updatedAt: serverTimestamp(),
  });

  // Start from a clean slate so a rerun cannot inherit the last run's nights.
  for (const item of await listActivities(uid)) await deleteDoc(doc(db, 'users', uid, 'activities', item.id));
  await clearSleepBaseline(uid);

  // === 1. Baseline round trip through the new security rule =================
  assert.equal(await loadSleepBaseline(uid), null, 'no baseline before one is set');
  const savedBaseline = await saveSleepBaseline(uid, {bedtimeMinutes: 1380, wakeMinutes: 420});
  assert.equal(savedBaseline.synced, true, 'the rules must accept the baseline write');
  assert.equal(baselineNightHours(savedBaseline), 8);
  const reloaded = await loadSleepBaseline(uid);
  assert.equal(reloaded.bedtimeMinutes, 1380);
  assert.equal(reloaded.wakeMinutes, 420);
  console.log('  baseline: saved through the rules and read back (23:00-07:00, 8h)');

  // A baseline alone must not manufacture evidence.
  const baselineOnly = calculateBurnoutDynamicInsight({
    activities: [], schedules: [], sleepBaselineHours: baselineNightHours(reloaded),
    weekActivities: [], weekSchedules: [],
  });
  assert.equal(baselineOnly.sleepEvidenceSource, 'baseline');
  assert.equal(baselineOnly.sleepDataDays, 0);
  assert.equal(baselineOnly.evidenceCoverage, 'limited');
  console.log(`  baseline only  -> source=${baselineOnly.sleepEvidenceSource} nights=${baselineOnly.sleepDataDays} coverage=${baselineOnly.evidenceCoverage}`);

  // === 2. One-tap เข้านอน writes a real, rules-valid activity ===============
  const bedTime = hoursAgo(6);
  const started = await startSleepLog(uid, {baseline: reloaded, now: bedTime});
  assert.equal(started.alreadyOpen, false);
  const [openRecord] = await listActivities(uid);
  assert.equal(openRecord.title, 'นอน', 'the title must match the keyword the model already knows');
  assert.equal(openRecord.status, 'in-progress');
  assert.equal(openRecord.category, 'sleep');
  console.log(`  เข้านอน tapped -> activity ${started.activityId} written, status=${openRecord.status}`);

  // Tapping again must not open a second night.
  const again = await startSleepLog(uid, {baseline: reloaded, now: hoursAgo(5)});
  assert.equal(again.alreadyOpen, true);
  assert.equal(again.activityId, started.activityId);
  assert.equal((await listActivities(uid)).length, 1, 'a second tap must not create a second night');
  console.log('  เข้านอน tapped twice -> still one night, reuses the open record');

  // While in progress it is a placeholder, not evidence.
  const midSleep = calculateBurnoutDynamicInsight({
    activities: [], schedules: [], sleepBaselineHours: baselineNightHours(reloaded),
    weekActivities: await listActivities(uid), weekSchedules: [],
  });
  assert.equal(midSleep.sleepDataDays, 0, 'an open night is not yet evidence');
  assert.equal(midSleep.sleepEvidenceSource, 'baseline');
  console.log(`  mid-sleep      -> source=${midSleep.sleepEvidenceSource} nights=${midSleep.sleepDataDays} (placeholder excluded)`);

  // === 3. One-tap ตื่นนอน closes it and it becomes evidence =================
  const open = await findOpenSleepLog(uid);
  assert.ok(open, 'the open night must be findable');
  const finished = await finishSleepLog(uid);
  assert.equal(finished.status, 'saved');
  assert.ok(finished.hours >= 5.9 && finished.hours <= 6.1, `expected ~6h, got ${finished.hours}`);
  const [closedRecord] = await listActivities(uid);
  assert.equal(closedRecord.status, 'completed');
  console.log(`  ตื่นนอน tapped -> ${finished.hours}h saved, status=${closedRecord.status}`);

  // Waking with nothing open is refused rather than inventing a night.
  assert.equal((await finishSleepLog(uid)).reason, 'no-open-night');

  const oneNight = calculateBurnoutDynamicInsight({
    activities: [], schedules: [], sleepBaselineHours: baselineNightHours(reloaded),
    weekActivities: await listActivities(uid), weekSchedules: [],
  });
  assert.equal(oneNight.sleepEvidenceSource, 'logged', 'a logged night must outrank the baseline');
  assert.equal(oneNight.sleepDataDays, 1);
  assert.equal(oneNight.evidenceCoverage, 'partial');
  assert.equal(oneNight.baselineSleepHours, 8, 'the baseline is still reported, just not used');
  console.log(`  1 logged night -> source=${oneNight.sleepEvidenceSource} nights=1 coverage=${oneNight.evidenceCoverage}`);

  // === 4. Coverage climbs as nights accumulate =============================
  // Two more nights are logged the same way, on the two previous days.
  for (const daysAgo of [1, 2]) {
    const wake = hoursAgo(24 * daysAgo);
    const bed = new Date(wake.getTime() - 5.5 * 36e5);
    await startSleepLog(uid, {baseline: reloaded, now: bed});
    const result = await finishSleepLog(uid, {now: wake});
    assert.equal(result.status, 'saved', `night -${daysAgo} should save`);
  }
  const logged = await listActivities(uid);
  assert.equal(logged.length, 3);

  const busySchedules = [0, 1, 2].map((daysAgo) => {
    const day = hoursAgo(24 * daysAgo);
    day.setHours(9, 0, 0, 0);
    return {
      color: '#ffffff', courseCode: '', endAt: Timestamp.fromDate(new Date(day.getTime() + 7 * 36e5)),
      id: `class-${daysAgo}`, location: '', ownerId: uid, source: 'manual',
      startAt: Timestamp.fromDate(day), title: `เรียน ${daysAgo}`,
    };
  });
  const tasks = [0, 1, 2, 3, 4].map((index) => ({
    color: '#ffffff', endAt: Timestamp.fromDate(hoursAgo(-2 - index)), id: `task-${index}`,
    location: '', ownerId: uid, source: 'manual', startAt: Timestamp.fromDate(hoursAgo(-1 - index)),
    status: 'planned', title: `งาน ${index}`, type: 'task',
  }));

  const threeNights = calculateBurnoutDynamicInsight({
    activities: [], pendingTasks: tasks, schedules: [], sleepBaselineHours: baselineNightHours(reloaded),
    weekActivities: logged, weekSchedules: busySchedules,
  });
  assert.equal(threeNights.sleepDataDays, 3);
  assert.equal(threeNights.evidenceCoverage, 'strong', 'three logged nights plus workload is strong');
  assert.equal(threeNights.sleepEvidenceSource, 'logged');
  assert.equal(threeNights.sleepBand, 'insufficient', 'about 5.7h a night is below the NSF 6h floor');
  assert.ok(threeNights.sleepDebtHours > 0, 'short nights must accumulate a debt');
  assert.ok(
    threeNights.reasons.some((reason) => reason.includes('บันทึกไว้')),
    'the reasons must say the sleep figure came from logged nights',
  );
  assert.ok(
    !threeNights.reasons.some((reason) => reason.includes('ช่วงนอนปกติที่ตั้งไว้')),
    'with logged nights present, no baseline reason may appear',
  );
  console.log(`  3 logged nights-> coverage=${threeNights.evidenceCoverage} band=${threeNights.sleepBand} debt=${threeNights.sleepDebtHours}h score=${threeNights.score}`);

  // The same workload with no sleep data at all must not claim strong coverage.
  const workloadOnly = calculateBurnoutDynamicInsight({
    activities: [], pendingTasks: tasks, schedules: [], weekActivities: [], weekSchedules: busySchedules,
  });
  assert.equal(workloadOnly.evidenceCoverage, 'partial');
  assert.equal(workloadOnly.sleepEvidenceSource, 'none');
  assert.ok(workloadOnly.score < threeNights.score, 'real short sleep must raise the score');
  console.log(`  workload only  -> coverage=${workloadOnly.evidenceCoverage} score=${workloadOnly.score} (vs ${threeNights.score} with logged sleep)`);

  // === 5. Cleanup, and prove the account is empty afterwards ================
  for (const item of await listActivities(uid)) await deleteDoc(doc(db, 'users', uid, 'activities', item.id));
  await clearSleepBaseline(uid);
  assert.equal((await listActivities(uid)).length, 0, 'test activities must be gone');
  assert.equal(await loadSleepBaseline(uid), null, 'test baseline must be gone');
  await deleteDoc(doc(db, 'users', uid, 'settings', 'sleepBaseline')).catch(() => undefined);
  console.log('  cleanup        -> 0 activities, no baseline left behind');

  await auth.signOut();
  console.log('SmartLife sleep-log integration tests passed');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
