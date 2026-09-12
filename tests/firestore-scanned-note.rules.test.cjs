// Cover for saving a general-document scan as a note.
//
// A scan that is neither a receipt nor a timetable now classifies as
// `document` and saves into `notes` instead of being forced into a
// transaction. Demo mode cannot prove that half: `ensureUserProfile` refuses
// before any write, because demo mode has no real Firebase user. So the web
// and Android runs cover the UI, and this asserts the other half against the
// real rules -- that the document a scan produces is actually accepted,
// including the `scanLogId` provenance field the v2 note schema added, and
// that it is really there afterwards.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {assertFails, assertSucceeds, initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const {doc, getDoc, serverTimestamp, setDoc} = require('firebase/firestore');

/** Exactly the shape `saveOcrResult` writes for a `document` scan. */
const scannedNote = (overrides = {}) => ({
  category: 'study',
  color: '#6F8F6D',
  content: [
    'ประกาศสำนักงาน ก.พ.',
    'เรื่อง รับสมัครสอบเพื่อวัดความรู้ความสามารถทั่วไป',
    'สอบภาคเช้า เวลา 09.00-12.00 น.',
  ].join('\n'),
  // The rules require both stamps to equal request.time, which is what
  // `createOwned` produces with serverTimestamp(); fixed dates are refused.
  createdAt: serverTimestamp(),
  ownerId: 'alice',
  priority: 'normal',
  relatedScheduleId: '',
  scanLogId: 'scan-log-123',
  status: 'pending',
  title: 'ประกาศสำนักงาน ก.พ.',
  updatedAt: serverTimestamp(),
  ...overrides,
});

async function main() {
  const env = await initializeTestEnvironment({
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
    },
    projectId: 'smartlife-budget',
  });

  await env.clearFirestore();
  // The rules require the owner's profile document to exist.
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users/alice'), {uid: 'alice'});
    await setDoc(doc(context.firestore(), 'users/mallory'), {uid: 'mallory'});
  });

  const alice = env.authenticatedContext('alice').firestore();
  const mallory = env.authenticatedContext('mallory').firestore();
  const anonymous = env.unauthenticatedContext().firestore();

  const noteRef = doc(alice, 'users/alice/notes/scanned-note');

  console.log('the owner can save a scanned document as a note');
  await assertSucceeds(setDoc(noteRef, scannedNote()));

  console.log('the note is really there, with the scanned text intact');
  await env.withSecurityRulesDisabled(async (context) => {
    const saved = await getDoc(doc(context.firestore(), 'users/alice/notes/scanned-note'));
    assert.equal(saved.exists(), true, 'the scanned note should exist');
    assert.match(saved.data().content, /สอบภาคเช้า/, 'the extracted text should be stored');
    assert.equal(saved.data().scanLogId, 'scan-log-123', 'provenance should be kept');
  });

  console.log('a note with no scanLogId is still fine (manual notes have none)');
  const plain = scannedNote();
  delete plain.scanLogId;
  await assertSucceeds(setDoc(doc(alice, 'users/alice/notes/manual-note'), plain));

  console.log('the scanned-documents folder can be created and used');
  await assertSucceeds(setDoc(doc(alice, 'users/alice/noteFolders/scanned'), {
    color: '#6F8F6D',
    createdAt: serverTimestamp(),
    icon: 'document_scanner',
    name: 'เอกสารสแกน',
    ownerId: 'alice',
    sortOrder: 0,
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(alice, 'users/alice/notes/filed-scan'), scannedNote({folderId: 'scanned'})));
  await env.withSecurityRulesDisabled(async (context) => {
    const filed = await getDoc(doc(context.firestore(), 'users/alice/notes/filed-scan'));
    assert.equal(filed.data().folderId, 'scanned', 'the scanned note should be filed in the folder');
  });

  console.log('a stranger cannot write a note into someone else\'s account');
  await assertFails(setDoc(doc(mallory, 'users/alice/notes/intruder'), scannedNote()));

  console.log('a signed-out client cannot either');
  await assertFails(setDoc(doc(anonymous, 'users/alice/notes/anon'), scannedNote()));

  console.log('a note claiming another owner is refused');
  await assertFails(setDoc(doc(alice, 'users/alice/notes/wrong-owner'), scannedNote({ownerId: 'mallory'})));

  await env.cleanup();
  console.log('\nscanned-note rules test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
