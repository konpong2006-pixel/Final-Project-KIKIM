// Stand-in for `@/lib/firebase` that points the real client SDK at the local
// emulators. The point of this stub is that nothing else is stubbed: the sleep
// service, `firestore.ts`, and the security rules all run for real, so a test
// that passes here proves the write path a device would take actually works.
import {initializeApp} from 'firebase/app';
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {connectFirestoreEmulator, getFirestore} from 'firebase/firestore';

const FIRESTORE_PORT = Number(process.env.SMARTLIFE_TEST_FIRESTORE_PORT ?? 8080);
const AUTH_PORT = Number(process.env.SMARTLIFE_TEST_AUTH_PORT ?? 9099);

export const firebaseApp = initializeApp({
  apiKey: 'emulator-api-key',
  appId: '1:0:web:emulator',
  authDomain: 'localhost',
  messagingSenderId: '0',
  projectId: process.env.SMARTLIFE_TEST_PROJECT_ID ?? 'smartlife-budget',
  storageBucket: 'smartlife-budget.appspot.com',
});

export const auth = getAuth(firebaseApp);
connectAuthEmulator(auth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});

export const db = getFirestore(firebaseApp);
connectFirestoreEmulator(db, '127.0.0.1', FIRESTORE_PORT);

export const storage = null;

/** Signs in a throwaway emulator account, creating it on first use. */
export async function __signIn(email, password) {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch {
    return createUserWithEmailAndPassword(auth, email, password);
  }
}
