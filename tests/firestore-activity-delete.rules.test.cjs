// Cover for the delete behind the calendar's trash button.
//
// The bug the teammate reported was that deleting "still doesn't work on the
// web". The cause was `Alert.alert`, which react-native-web implements as an
// empty method, so the confirmation never appeared and the delete call it
// guarded was never reached; `ConfirmDialog` replaces it. That fix is in the
// UI, and the web test covers it -- but demo mode stubs `activities.remove`
// out, so this asserts the other half against the real rules: once the confirm
// button does fire, the owner really can delete the document and it is really
// gone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {assertFails, assertSucceeds, initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const {deleteDoc, doc, getDoc, setDoc} = require('firebase/firestore');

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
  title: 'อ่าน Linked List ก่อนควิซ',
  type: 'task',
  updatedAt: new Date('2026-08-20T01:00:00Z'),
  ...overrides,
});

const scheduleShape = (overrides = {}) => ({
  color: '#5F875F',
  courseCode: 'CS201',
  createdAt: new Date('2026-08-20T01:00:00Z'),
  endAt: new Date('2026-08-20T12:00:00+07:00'),
  location: 'SC-401',
  ownerId: 'alice',
  source: 'manual',
  startAt: new Date('2026-08-20T09:00:00+07:00'),
  title: 'Data Structures',
  updatedAt: new Date('2026-08-20T01:00:00Z'),
  ...overrides,
});

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'smartlife-activity-delete-rules-test',
    firestore: {rules: fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8')},
  });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', 'alice'), {uid: 'alice'});
      await setDoc(doc(adminDb, 'users', 'bob'), {uid: 'bob'});
      await setDoc(doc(adminDb, 'users', 'alice', 'activities', 'plain'), activityShape());
      await setDoc(doc(adminDb, 'users', 'alice', 'activities', 'guarded'), activityShape({title: 'ของคนอื่นลบไม่ได้'}));
      // An activity the adaptive-scheduling backend created, carrying fields
      // the client never writes. `hasOnly` drift has locked owners out of their
      // own documents before, so delete gets the same check mark-done does.
      await setDoc(doc(adminDb, 'users', 'alice', 'activities', 'adaptive'), activityShape({
        aiReason: 'จัดเวลาจาก Adaptive AI', aiScheduled: true, clientRequestId: 'req-3f2a91', source: 'ai',
      }));
      await setDoc(doc(adminDb, 'users', 'alice', 'schedules', 'cs201-w1'), scheduleShape({seriesId: 'cs201-series'}));
      await setDoc(doc(adminDb, 'users', 'alice', 'schedules', 'cs201-w2'), scheduleShape({seriesId: 'cs201-series'}));
    });

    const alice = testEnv.authenticatedContext('alice', {email: 'alice@example.com'}).firestore();
    const bob = testEnv.authenticatedContext('bob', {email: 'bob@example.com'}).firestore();

    // --- The calendar's per-activity delete, which is what the trash button
    // on a one-off row calls: activities.remove(uid, id).
    await assertSucceeds(deleteDoc(doc(alice, 'users', 'alice', 'activities', 'plain')));
    await assertSucceeds(deleteDoc(doc(alice, 'users', 'alice', 'activities', 'adaptive')));

    // --- "ลบทั้งหมด" on a course row deletes the whole series.
    await assertSucceeds(deleteDoc(doc(alice, 'users', 'alice', 'schedules', 'cs201-w1')));
    await assertSucceeds(deleteDoc(doc(alice, 'users', 'alice', 'schedules', 'cs201-w2')));

    // --- Confirming it is actually gone, not merely that the write was allowed.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      for (const [collection, id] of [['activities', 'plain'], ['activities', 'adaptive'], ['schedules', 'cs201-w1'], ['schedules', 'cs201-w2']]) {
        const snapshot = await getDoc(doc(adminDb, 'users', 'alice', collection, id));
        assert.equal(snapshot.exists(), false, `${collection}/${id} should be gone after delete`);
      }
      const survivor = await getDoc(doc(adminDb, 'users', 'alice', 'activities', 'guarded'));
      assert.equal(survivor.exists(), true, 'a document nobody deleted must survive');
    });

    // --- Ownership still decides it.
    await assertFails(deleteDoc(doc(bob, 'users', 'alice', 'activities', 'guarded')));
    await assertFails(deleteDoc(doc(testEnv.unauthenticatedContext().firestore(), 'users', 'alice', 'activities', 'guarded')));

    console.log('ok  owner can delete an activity, a backend-created activity, and a whole course series');
    console.log('ok  the documents are gone afterwards');
    console.log('ok  a stranger and a signed-out client cannot delete them');
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
