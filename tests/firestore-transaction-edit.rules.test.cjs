// Regression cover for editing a transaction (the finance screen's category
// picker today; amount/merchant/note/occurredAt/status are the same allowed
// shape for whatever edits it grows next).
//
// The failure mirrors the mark-done bug exactly. `validTransaction` used to
// run against `request.resource.data`, the *merged* document, on every
// update -- so a transaction written by a trusted backend path (receipt scan
// review, LINE auto-listener) with fields or a shape this schema has since
// moved past made every later client edit of that transaction fail, even one
// that never touches the offending field. The owner could never re-categorize
// or correct their own transaction again.
const fs = require('node:fs');
const path = require('node:path');
const {assertFails, assertSucceeds, initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const {doc, serverTimestamp, setDoc, updateDoc} = require('firebase/firestore');

const transactionShape = (overrides = {}) => ({
  amount: 120,
  category: 'Food',
  createdAt: new Date('2026-08-20T01:00:00Z'),
  merchant: 'ร้านข้าวแกง',
  note: '',
  occurredAt: new Date('2026-08-20T05:00:00Z'),
  ownerId: 'alice',
  receiptPath: '',
  type: 'expense',
  updatedAt: new Date('2026-08-20T01:00:00Z'),
  ...overrides,
});

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'smartlife-transaction-edit-rules-test',
    firestore: {rules: fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8')},
  });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', 'alice'), {uid: 'alice'});
      await setDoc(doc(adminDb, 'users', 'bob'), {uid: 'bob'});
      await setDoc(doc(adminDb, 'users', 'alice', 'transactions', 'manual'), transactionShape());
      // Exactly what saveReviewedReceipt writes via the Admin SDK: dedupe and
      // provenance fields no client update ever sets or clears.
      await setDoc(doc(adminDb, 'users', 'alice', 'transactions', 'scanned'), transactionShape({
        confidence: 0.86,
        dedupeKeys: ['k1', 'k2'],
        fingerprint: 'a'.repeat(64),
        items: [{name: 'ข้าวผัด', totalPrice: 60}],
        reviewedByUser: true,
        scanId: 'scan-9f21',
        source: 'receipt_scan',
        status: 'needs_review',
      }));
      // Exactly what the LINE auto-listener writes: bank metadata a manual
      // entry never carries.
      await setDoc(doc(adminDb, 'users', 'alice', 'transactions', 'line'), transactionShape({
        accountLast4: '8186',
        bank: 'kasikorn',
        confirmationMethod: 'explicit_user_confirm',
        source: 'line_auto_listener',
        status: 'needs_review',
      }));
      // A transaction written before `receiptPath` was a required field.
      await setDoc(doc(adminDb, 'users', 'alice', 'transactions', 'legacy'), (() => {
        const shape = transactionShape();
        delete shape.receiptPath;
        return shape;
      })());
    });

    const alice = testEnv.authenticatedContext('alice', {email: 'alice@example.com'}).firestore();
    const bob = testEnv.authenticatedContext('bob', {email: 'bob@example.com'}).firestore();

    // --- Re-categorizing an ordinary manual transaction. Always worked, must
    // keep working.
    await assertSucceeds(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'manual'), {
      category: 'Transport', updatedAt: serverTimestamp(),
    }));

    // --- The three drifted shapes that used to be locked out forever: a
    // receipt-scan row with dedupe/provenance fields, a LINE row with bank
    // metadata, and a pre-`receiptPath` legacy row. None of this write
    // touches those fields, so a check scoped to what changed must pass.
    await assertSucceeds(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'scanned'), {
      category: 'Food', status: 'verified', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'line'), {
      status: 'verified', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'legacy'), {
      category: 'Shopping', updatedAt: serverTimestamp(),
    }));

    // --- Ownership still decides it: a stranger cannot edit any of them.
    await assertFails(updateDoc(doc(bob, 'users', 'alice', 'transactions', 'manual'), {
      category: 'Transport', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(bob, 'users', 'alice', 'transactions', 'scanned'), {
      status: 'verified', updatedAt: serverTimestamp(),
    }));

    // --- The field allowlist still holds: provenance, dedupe/fingerprint,
    // and the record's type stay out of the client's reach, even on its own
    // transaction and even when no other field is touched.
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'scanned'), {
      dedupeKeys: [], updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'scanned'), {
      reviewedByUser: false, updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'manual'), {
      source: 'manual_entry', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'manual'), {
      type: 'income', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'manual'), {
      receiptPath: 'users/alice/receipts/forged.jpg', updatedAt: serverTimestamp(),
    }));

    // --- Value checks still apply to whatever this write does touch.
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'manual'), {
      amount: -5, updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'manual'), {
      category: '', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice, 'users', 'alice', 'transactions', 'scanned'), {
      status: 'archived', updatedAt: serverTimestamp(),
    }));

    console.log('SmartLife transaction-edit rules tests passed');
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
