const assert = require('node:assert/strict');
const {deleteApp, getApps, initializeApp} = require('firebase-admin/app');
const {getFirestore, Timestamp} = require('firebase-admin/firestore');
const {defineSecret} = require('firebase-functions/params');
const {createAdaptiveSchedulingFunctions} = require('../lib/adaptive-scheduling/functions.js');

const minute = 60_000;

function futureBangkokTime(dayOffset, hour) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  }).formatToParts(new Date(Date.now() + dayOffset * 24 * 60 * minute))
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, '0')}:00:00+07:00`).getTime();
}

function activity(uid, startMs, patch = {}) {
  return {
    allowAiReschedule: true,
    category: 'study',
    color: '#5F875F',
    createdAt: Timestamp.now(),
    endAt: Timestamp.fromMillis(startMs + 60 * minute),
    estimatedDurationMinutes: 60,
    isFlexible: true,
    isLocked: false,
    location: '',
    ownerId: uid,
    priority: 'medium',
    scheduleVersion: 0,
    source: 'manual',
    startAt: Timestamp.fromMillis(startMs),
    status: 'planned',
    title: 'อ่านหนังสือ',
    type: 'task',
    updatedAt: Timestamp.now(),
    ...patch,
  };
}

function suggestion(uid, activityId, oldStartMs, newStartMs, patch = {}) {
  return {
    activityCategory: 'study',
    confidence: .8,
    createdAt: Timestamp.now(),
    expectedBenefit: 'ช่วงที่เหมาะกว่า',
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * minute),
    explanation: 'คำแนะนำจากข้อมูลที่ตรวจสอบแล้ว',
    mode: 'suggestion',
    observationCount: 8,
    originalEndAt: Timestamp.fromMillis(oldStartMs + 60 * minute),
    originalScheduleVersion: 0,
    originalStartAt: Timestamp.fromMillis(oldStartMs),
    ownerId: uid,
    scheduleItemId: activityId,
    status: 'pending',
    suggestedEndAt: Timestamp.fromMillis(newStartMs + 60 * minute),
    suggestedStartAt: Timestamp.fromMillis(newStartMs),
    taskTitle: 'อ่านหนังสือ',
    updatedAt: Timestamp.now(),
    ...patch,
  };
}

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is required.');
  const app = getApps()[0] ?? initializeApp({projectId: 'smartlife-adaptive-transactions-test'});
  const db = getFirestore(app);
  const uid = `transaction-user-${Date.now()}`;
  const user = db.collection('users').doc(uid);
  await user.set({uid});
  const geminiApiKey = defineSecret('TEST_GEMINI_API_KEY');
  const functions = createAdaptiveSchedulingFunctions({db, geminiApiKey, region: 'asia-southeast1'});
  const call = (fn, data) => fn.run({app: {appId: 'emulator-test'}, auth: {token: {}, uid}, data, instanceIdToken: undefined, rawRequest: {}});

  const originalStart = futureBangkokTime(2, 9);
  const acceptedStart = futureBangkokTime(2, 14);
  await user.collection('activities').doc('accepted-task').set(activity(uid, originalStart));
  await user.collection('schedulingSuggestions').doc('accept-1').set(suggestion(uid, 'accepted-task', originalStart, acceptedStart));
  const accepted = await call(functions.acceptSchedulingSuggestion, {suggestionId: 'accept-1'});
  const acceptedTask = (await user.collection('activities').doc('accepted-task').get()).data();
  assert.equal(acceptedTask.startAt.toMillis(), acceptedStart);
  assert.equal(acceptedTask.scheduleVersion, 1);
  assert.equal((await user.collection('schedulingSuggestions').doc('accept-1').get()).data().status, 'accepted');
  assert.equal((await user.collection('scheduleChangeHistory').doc(accepted.historyId).get()).data().status, 'applied');
  assert.equal((await user.collection('schedulingBehaviorEvents').where('eventType', '==', 'suggestion_accepted').get()).size, 1);
  assert.equal((await user.collection('notifications').where('ownerId', '==', uid).get()).size, 1, 'one accepted suggestion must create one notification document');

  await call(functions.undoScheduleChange, {historyId: accepted.historyId});
  assert.equal((await user.collection('activities').doc('accepted-task').get()).data().startAt.toMillis(), originalStart);
  assert.equal((await user.collection('scheduleChangeHistory').doc(accepted.historyId).get()).data().status, 'undone');

  await user.collection('activities').doc('rejected-task').set(activity(uid, originalStart));
  await user.collection('schedulingSuggestions').doc('reject-1').set(suggestion(uid, 'rejected-task', originalStart, acceptedStart));
  await call(functions.rejectSchedulingSuggestion, {suggestionId: 'reject-1'});
  assert.equal((await user.collection('activities').doc('rejected-task').get()).data().startAt.toMillis(), originalStart, 'rejection must not move the task');
  assert.equal((await user.collection('schedulingSuggestions').doc('reject-1').get()).data().status, 'rejected');

  const conflictStart = futureBangkokTime(3, 13);
  await user.collection('activities').doc('conflict-task').set(activity(uid, originalStart));
  await user.collection('schedules').doc('fixed-class').set({courseCode: 'FIXED', endAt: Timestamp.fromMillis(conflictStart + 60 * minute), ownerId: uid, source: 'manual', startAt: Timestamp.fromMillis(conflictStart), title: 'Fixed class'});
  await user.collection('schedulingSuggestions').doc('conflict-1').set(suggestion(uid, 'conflict-task', originalStart, conflictStart));
  await assert.rejects(() => call(functions.acceptSchedulingSuggestion, {suggestionId: 'conflict-1'}));
  assert.equal((await user.collection('activities').doc('conflict-task').get()).data().startAt.toMillis(), originalStart, 'failed validation must not partially move the task');
  assert.equal((await user.collection('schedulingSuggestions').doc('conflict-1').get()).data().status, 'pending');

  await user.collection('activities').doc('device-task').set(activity(uid, originalStart));
  await user.collection('schedulingSuggestions').doc('device-1').set(suggestion(uid, 'device-task', originalStart, acceptedStart));
  await user.collection('activities').doc('device-task').update({startAt: Timestamp.fromMillis(originalStart + 30 * minute)});
  await assert.rejects(() => call(functions.acceptSchedulingSuggestion, {suggestionId: 'device-1'}), /อุปกรณ์อื่น/);
  assert.equal((await user.collection('schedulingSuggestions').doc('device-1').get()).data().status, 'pending');

  await user.collection('activities').doc('google-task').set(activity(uid, originalStart, {googleEventId: 'external-event', source: 'manual'}));
  await user.collection('schedulingSuggestions').doc('google-1').set(suggestion(uid, 'google-task', originalStart, acceptedStart));
  await assert.rejects(() => call(functions.acceptSchedulingSuggestion, {suggestionId: 'google-1'}), /Google Calendar/);
  assert.equal((await user.collection('activities').doc('google-task').get()).data().startAt.toMillis(), originalStart);

  const overlappingStart = futureBangkokTime(4, 18);
  await user.collection('schedules').doc('evening-commute').set({
    courseCode: 'COMMUTE',
    endAt: Timestamp.fromMillis(overlappingStart + 90 * minute),
    ownerId: uid,
    source: 'manual',
    startAt: Timestamp.fromMillis(overlappingStart),
    title: 'เดินทางกลับบ้าน',
  });
  const overlapRequest = {
    activityCategory: 'personal',
    clientRequestId: `overlap-${Date.now()}`,
    dateLocked: true,
    durationMinutes: 60,
    endAt: new Date(overlappingStart + 60 * minute).toISOString(),
    generatedForTimeZone: 'Asia/Bangkok',
    startAt: new Date(overlappingStart).toISOString(),
    title: 'ฟังพอดแคสต์',
    userSelectedTime: true,
  };
  const warned = await call(functions.createAdaptiveActivity, overlapRequest);
  assert.equal(warned.saved, false, 'an unconfirmed overlap must not be saved');
  assert.equal(warned.requiresConflictConfirmation, true);
  assert.equal(warned.conflicts.some((item) => item.title === 'เดินทางกลับบ้าน'), true, 'the warning must identify the conflicting event');
  assert.equal((await user.collection('activities').where('clientRequestId', '==', overlapRequest.clientRequestId).get()).empty, true);

  const confirmed = await call(functions.createAdaptiveActivity, {...overlapRequest, allowOverlap: true});
  assert.equal(confirmed.saved, true, 'an explicitly confirmed overlap must be saved');
  assert.equal(confirmed.requiresConflictConfirmation, false);
  assert.equal(confirmed.conflicts.some((item) => item.title === 'เดินทางกลับบ้าน'), true);
  assert.equal((await user.collection('activities').doc(confirmed.id).get()).exists, true);

  await db.recursiveDelete(user);
  await deleteApp(app);
  console.log('Adaptive Scheduling transaction tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
