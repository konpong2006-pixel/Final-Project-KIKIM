// The assistant tool layer reaches Firebase for context and writes. None of
// that takes part in the date arithmetic under test, and the real modules pull
// in `firebase/auth` type-only named imports that plain Node cannot link, so
// the whole Firebase-facing surface is stubbed out here.
export const auth = {currentUser: null};
export const firebaseApp = {name: 'test'};
export async function ensureAppCheckReady() { return undefined; }
export function appCheckErrorMessage() { return ''; }
export function isAppCheckError() { return false; }
export class AppCheckTemporarilyUnavailableError extends Error {}
export const db = {};
export const storage = {};
export const functions = {};
export function getFirebaseAuth() { return auth; }
