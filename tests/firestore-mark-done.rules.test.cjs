// Regression cover for "mark done", the write behind both the dashboard's
// "เสร็จ" button and the calendar checkmark. Both send the same thing:
// users/{uid}/activities/{id} <- {status: 'completed', updatedAt}.
//
// The failure this guards against is subtle. `validActivity` runs against
// `request.resource.data`, which on an update is the *merged* document, and it
// closes the field list with `hasOnly`. So a field written by a backend that
// bypasses rules -- the Admin SDK in an adaptive-scheduling callable -- makes
// every later client update of that document fail, even one that never touches
// the offending field. The document becomes permanently read-only to its owner.
const fs = require('node:fs');
const path = require('node:path');
const {assertFails, assertSucceeds, initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const {doc, serverTimestamp, setDoc, updateDoc} = require('firebase/firestore');

const activityShape = (overrides = {}) => ({
  allowAiReschedule: true,
  category: 'study',
  color: '#5F875F',
  createdAt: new Date('2026-08-20T01:00:00Z'),
  endAt: new Date('2026-08-20T15:00:00+07:00'),
  estimatedDurationMinutes: 35,
  isFlexible: true,
  isLocked: false,
  location: '',
  ownerId: 'alice',
  priority: 'high',
  scheduleVersion: 0,
  source: 'manual',
  startAt: new Date('2026-08-20T14:00:00+07:00'),
  status: 'planned',
  title: 'จัดช่วงโฟกัส 35 นาที',
  type: 'task',
  updatedAt: new Date('2026-08-20T01:00:00Z'),
  ...overrides,
});

const noteShape = (overrides = {}) => ({
  category: 'work',
  color: '#5F875F',
  completedAt: null,
  content: 'ส่งรายงานก่อนเที่ยง',
  createdAt: new Date('2026-08-20T01:00:00Z'),
  ownerId: 'alice',
  priority: 'important',
  relatedScheduleId: '',
  status: 'pending',
  title: 'ส่งรายงาน',
  updatedAt: new Date('2026-08-20T01:00:00Z'),
  ...overrides,
});

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'smartlife-mark-done-rules-test',
    firestore: {rules: fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8')},
  });
  try {
    await testEnv.clearFirestore();
    // Seeded with rules disabled, which is what the Admin SDK does in the
    // adaptive-scheduling callables.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', 'alice'), {uid: 'alice'});
      await setDoc(doc(adminDb, 'users', 'bob'), {uid: 'bob'});
      await setDoc(doc(adminDb, 'users', 'alice', 'activities', 'plain'), activityShape());
      // Exactly what createAdaptiveActivity writes: the idempotency key it
      // stores alongside the activity so a retried call cannot double-book.
      await setDoc(doc(adminDb, 'users', 'alice', 'activities', 'adaptive'), activityShape({
        aiReason: 'จัดเวลาจาก Adaptive AI',
        aiScheduled: true,
        clientRequestId: 'req-3f2a91',
        source: 'ai',
      }));
      await setDoc(doc(adminDb, 'users', 'alice', 'notes', 'work-note'), noteShape());
    });

    const alice = testEnv.authenticatedContext('alice', {email: 'alice@example.com'}).firestore();
    const bob = testEnv.authenticatedContext('bob', {email: 'bob@example.com'}).firestore();

    const markDone = {status: 'completed', updatedAt: serverTimestamp()};

    // --- The dashboard "เสร็จ" button and the calendar checkmark, on an
    // ordinary activity. This always worked and must keep working.
    await assertSucceeds(updateDoc(doc(alice, 'users', 'alice', 'activities', 'plain'), markDone));

    // --- The same write on an activity the backend created. This is the bug:
    // the client never mentions clientRequestId, but the merged document still
    // carries it, so the owner cannot close their own task.
    await assertSucceeds(updateDoc(doc(alice, 'users', 'alice', 'activities', 'adaptive'), markDone));

    // --- Marking a note done, the dashboard's other completion path.
    await assertSucceeds(updateDoc(doc(alice, 'users', 'alice', 'notes', 'work-note'), {
      completedAt: serverTimestamp(), status: 'completed', updatedAt: serverTimestamp(),
    }));

    // --- Ownership is still what decides it: a stranger cannot close either
    // task, and the backend-only fields stay out of the client's reach.
    await assertFails(updateDoc(doc(bob, 'users', 'alice', 'activities', 'plain'), markDone));
    await assertFails(updateDoc(doc(bob, 'users', 'alice', 'activities', 'adaptive'), markDone));
    await assertFails(updateDoc(doc(bob, 'users', 'alice', 'notes', 'work-note'), {status: 'completed', updatedAt: serverTimestamp()}));
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'activities', 'adaptive'), {
      clientRequestId: 'forged', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'activities', 'adaptive'), {
      aiScheduled: false, updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'activities', 'adaptive'), {
      scheduleVersion: 99, updatedAt: serverTimestamp(),
    }));
    // The owner may not smuggle a brand-new unknown field in either.
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'activities', 'plain'), {
      somethingElse: 'nope', updatedAt: serverTimestamp(),
    }));

    // --- "เลื่อน" on the calendar, the write behind the new postpone sheet.
    // It moves the slot instead of closing it, so it touches startAt/endAt --
    // a different field pair than mark-done and therefore a separate chance for
    // the same hasOnly drift. It has to work on a backend-created activity too,
    // because the whole point of recording task_postponed is to learn from the
    // AI's own suggestions being moved.
    const postpone = {
      endAt: new Date('2026-08-20T18:00:00+07:00'),
      startAt: new Date('2026-08-20T17:00:00+07:00'),
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(updateDoc(doc(alice, 'users', 'alice', 'activities', 'plain'), postpone));
    await assertSucceeds(updateDoc(doc(alice, 'users', 'alice', 'activities', 'adaptive'), postpone));
    await assertFails(updateDoc(doc(bob, 'users', 'alice', 'activities', 'plain'), postpone));
    // An inverted slot is still rejected, so a postpone cannot corrupt the range.
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'activities', 'plain'), {
      endAt: new Date('2026-08-20T16:00:00+07:00'),
      startAt: new Date('2026-08-20T17:00:00+07:00'),
      updatedAt: serverTimestamp(),
    }));

    // --- The behaviour events the postpone produces are written by the
    // callable's Admin SDK, never by the client. If this ever starts passing,
    // a user could forge their own learning history.
    await assertFails(setDoc(doc(alice, 'users', 'alice', 'schedulingBehaviorEvents', 'forged'), {
      eventType: 'task_completed', ownerId: 'alice', scheduleItemId: 'plain',
    }));

    console.log('SmartLife mark-done rules tests passed');
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
