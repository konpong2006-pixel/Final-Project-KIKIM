const fs = require('node:fs');
const path = require('node:path');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc} = require('firebase/firestore');

/** 23:00 to 07:00, the window the sleep card offers as its default. */
function baseline(overrides = {}) {
  return {
    bedtimeMinutes: 1380,
    createdAt: serverTimestamp(),
    ownerId: 'alice',
    updatedAt: serverTimestamp(),
    wakeMinutes: 420,
    ...overrides,
  };
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    firestore: {rules: fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8')},
    projectId: 'smartlife-sleep-baseline-rules-test',
  });

  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', 'alice'), {uid: 'alice'});
      await setDoc(doc(adminDb, 'users', 'bob'), {uid: 'bob'});
      // The adaptive settings document stays function-written, so it is seeded
      // here to prove the client still cannot touch it.
      await setDoc(doc(adminDb, 'users', 'alice', 'settings', 'adaptiveScheduling'), {ownerId: 'alice'});
    });

    const alice = testEnv.authenticatedContext('alice', {email: 'alice@example.com'}).firestore();
    const bob = testEnv.authenticatedContext('bob', {email: 'bob@example.com'}).firestore();
    const admin = testEnv.authenticatedContext('root', {admin: true, email: 'root@example.com'}).firestore();
    const anonymous = testEnv.unauthenticatedContext().firestore();

    const alicePath = ['users', 'alice', 'settings', 'sleepBaseline'];

    // --- The owner sets and reads back their own usual window.
    await assertSucceeds(setDoc(doc(alice, ...alicePath), baseline()));
    await assertSucceeds(getDoc(doc(alice, ...alicePath)));
    await assertSucceeds(updateDoc(doc(alice, ...alicePath), {updatedAt: serverTimestamp(), wakeMinutes: 400}));

    // --- Nobody else can reach it. A sleep schedule is personal data, so the
    // isolation matters as much as it does for the spending limit.
    await assertFails(getDoc(doc(bob, ...alicePath)));
    await assertFails(getDoc(doc(anonymous, ...alicePath)));
    await assertFails(setDoc(doc(bob, ...alicePath), baseline()));
    await assertFails(setDoc(doc(anonymous, ...alicePath), baseline()));
    await assertFails(deleteDoc(doc(bob, ...alicePath)));

    // --- Bob cannot forge Alice as the owner of a document under his own path.
    await assertFails(setDoc(doc(bob, 'users', 'bob', 'settings', 'sleepBaseline'), baseline({ownerId: 'alice'})));

    // --- The new write permission is scoped to this one setting id. Opening
    // `settings` to the client must not have opened the adaptive document,
    // which only the Admin SDK is allowed to write.
    await assertFails(setDoc(doc(alice, 'users', 'alice', 'settings', 'adaptiveScheduling'), baseline()));
    await assertFails(deleteDoc(doc(alice, 'users', 'alice', 'settings', 'adaptiveScheduling')));
    await assertFails(setDoc(doc(alice, 'users', 'alice', 'settings', 'anythingElse'), baseline()));
    await assertFails(getDoc(doc(alice, 'users', 'alice', 'settings', 'anythingElse')));

    // --- Shape validation: only two clock values, and only real clock values.
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'alice'), {uid: 'alice'});
    });
    await assertFails(setDoc(doc(alice, ...alicePath), baseline({bedtimeMinutes: 1440})));
    await assertFails(setDoc(doc(alice, ...alicePath), baseline({wakeMinutes: -1})));
    await assertFails(setDoc(doc(alice, ...alicePath), baseline({bedtimeMinutes: 23.5})));
    await assertFails(setDoc(doc(alice, ...alicePath), baseline({bedtimeMinutes: '23:00'})));
    // A zero-length window is not a night.
    await assertFails(setDoc(doc(alice, ...alicePath), baseline({bedtimeMinutes: 420, wakeMinutes: 420})));
    // No smuggling extra fields in beside the two clock values.
    await assertFails(setDoc(doc(alice, ...alicePath), baseline({sleepDataDays: 7})));
    await assertFails(setDoc(doc(alice, ...alicePath), baseline({ownerId: 'bob'})));

    // --- An admin can read for support, but still cannot write a user's window.
    await assertSucceeds(setDoc(doc(alice, ...alicePath), baseline()));
    await assertSucceeds(getDoc(doc(admin, ...alicePath)));
    await assertFails(setDoc(doc(admin, ...alicePath), baseline({wakeMinutes: 500})));

    // --- The owner can clear it, which is what "ล้างค่าอ้างอิงนี้" does.
    await assertSucceeds(deleteDoc(doc(alice, ...alicePath)));

    console.log('SmartLife sleep baseline rules tests passed');
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
