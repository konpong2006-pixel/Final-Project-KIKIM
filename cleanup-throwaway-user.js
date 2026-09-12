#!/usr/bin/env node
/**
 * One-off local utility: remove a throwaway test account and everything it
 * wrote, then prove both are gone.
 *
 *   node cleanup-throwaway-user.js <uid>
 *   node cleanup-throwaway-user.js <uid> --dry-run   # report only, never delete
 *   node cleanup-throwaway-user.js <uid> --yes       # skip the confirmation
 *   node cleanup-throwaway-user.js <uid> --key k.json
 *
 * CREDENTIALS -- what actually works on this machine, checked rather than assumed:
 *
 *   The Firebase CLI session already cached by `firebase login` is enough. Its
 *   token carries the cloud-platform and firebase scopes, which cover both the
 *   Identity Toolkit (Auth admin) and Firestore APIs. No service account key is
 *   required. A key is still accepted via --key or GOOGLE_APPLICATION_CREDENTIALS
 *   if you would rather use one.
 *
 * WHY FIRESTORE GOES OVER REST: firebase-admin's Firestore client refuses any
 * credential that is not a service-account certificate or ADC, so it rejects the
 * CLI session outright ("Must initialize the SDK with a certificate credential
 * or application default credentials"). Its Auth client has no such restriction.
 * Rather than force a key file, this asks whichever credential is in use for a
 * bearer token and drives the Firestore REST API with it -- one path that works
 * for both credential kinds. Auth still goes through firebase-admin.
 *
 * Safety: it surveys first and prints what it found, is a no-op when the uid has
 * nothing, and will not delete until you confirm.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const readline = require('node:readline');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');

const PROJECT_ID = 'smartlife-budget';
const FIRESTORE_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** Where `firebase login` caches its session, per platform. */
const CLI_CONFIG_CANDIDATES = [
  path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
  path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
];

function fail(message) {
  console.error(`\n[x] ${message}`);
  process.exit(1);
}

/** firebase-admin is only a dependency under functions/, so look there first. */
function loadAdmin() {
  for (const manifest of [path.join(__dirname, 'functions', 'package.json'), path.join(__dirname, 'package.json')]) {
    try {
      return createRequire(manifest)('firebase-admin');
    } catch {
      // Try the next location.
    }
  }
  return fail('Could not load firebase-admin. Install it with:  npm install --no-save firebase-admin');
}

function readCliSession() {
  for (const file of CLI_CONFIG_CANDIDATES) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      const tokens = JSON.parse(fs.readFileSync(file, 'utf8')).tokens;
      if (tokens && tokens.access_token) return {file, tokens};
    } catch {
      // Malformed config: treat as absent rather than crashing.
    }
  }
  return null;
}

/**
 * The CLI refreshes its own cached token whenever it runs. Rather than holding
 * its OAuth client secret, this asks the CLI to do the refresh and re-reads what
 * it cached. Only used when the token is actually stale.
 */
function refreshCliSession() {
  process.stdout.write('  cached CLI token is stale, asking the Firebase CLI to refresh it... ');
  try {
    execFileSync('npx', ['-y', 'firebase-tools@latest', 'projects:list', '--json'],
      {shell: process.platform === 'win32', stdio: 'ignore', timeout: 240_000});
    console.log('done');
  } catch {
    console.log('failed');
  }
  return readCliSession();
}

function buildCredential(admin, keyPath) {
  const key = keyPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (key) {
    if (!fs.existsSync(key)) fail(`Service account key not found at ${key}`);
    console.log(`  credential: service account key at ${key}`);
    return admin.credential.cert(require(path.resolve(key)));
  }
  let session = readCliSession();
  if (!session) {
    return fail(
      'No usable credentials.\n'
      + '  Run `npx firebase-tools login` on this machine, or pass a service account key:\n'
      + '  Firebase Console > Project settings > Service accounts > Generate new private key,\n'
      + '  then re-run with --key <path-to-key.json>',
    );
  }
  if (!session.tokens.expires_at || session.tokens.expires_at - Date.now() < 5 * 60_000) {
    session = refreshCliSession() || session;
  }
  const {access_token: accessToken, expires_at: expiresAt} = session.tokens;
  if (!accessToken || (expiresAt && expiresAt <= Date.now())) {
    return fail('The cached Firebase CLI token is expired. Run `npx firebase-tools login --reauth` and retry.');
  }
  console.log(`  credential: Firebase CLI session (${session.file})`);
  // firebase-admin accepts any object exposing getAccessToken().
  return {
    getAccessToken: async () => ({
      access_token: accessToken,
      expires_in: Math.max(60, Math.floor(((expiresAt || Date.now() + 3.6e6) - Date.now()) / 1000)),
    }),
  };
}

/** Bearer token for the REST calls, taken from whichever credential is in use. */
async function bearer(credential) {
  const {access_token: token} = await credential.getAccessToken();
  if (!token) fail('Could not obtain an access token from the credential.');
  return token;
}

async function api(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {})},
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url.replace(FIRESTORE_ROOT, '')} -> ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? {} : response.json();
}

async function listCollectionIds(token, documentPath) {
  const ids = [];
  let pageToken;
  do {
    const body = await api(token, `${FIRESTORE_ROOT}/${documentPath}:listCollectionIds`, {
      body: JSON.stringify(pageToken ? {pageToken} : {}),
      method: 'POST',
    });
    if (!body) break;
    ids.push(...(body.collectionIds || []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return ids;
}

/**
 * Document names in a collection. `showMissing` matters: a document can be
 * absent while still holding subcollections, and skipping those would leave
 * data behind while the script reported success.
 */
async function listDocumentNames(token, collectionPath) {
  const names = [];
  let pageToken;
  do {
    const query = new URLSearchParams({pageSize: '300', showMissing: 'true', 'mask.fieldPaths': '__name__'});
    if (pageToken) query.set('pageToken', pageToken);
    const body = await api(token, `${FIRESTORE_ROOT}/${collectionPath}?${query}`);
    if (!body) break;
    names.push(...(body.documents || []).map((document) => document.name));
    pageToken = body.nextPageToken;
  } while (pageToken);
  // Absolute resource names come back; the script works in relative paths.
  return names.map((name) => name.slice(name.indexOf('/documents/') + '/documents/'.length));
}

/** Every document at or under a path, deepest first so parents go last. */
async function walk(token, documentPath) {
  const found = [];
  for (const collectionId of await listCollectionIds(token, documentPath)) {
    for (const childPath of await listDocumentNames(token, `${documentPath}/${collectionId}`)) {
      found.push(...await walk(token, childPath));
      found.push({collection: collectionId, path: childPath});
    }
  }
  return found;
}

async function survey(admin, token, uid) {
  let authUser = null;
  try {
    authUser = await admin.auth().getUser(uid);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
  const userPath = `users/${uid}`;
  const userDoc = await api(token, `${FIRESTORE_ROOT}/${userPath}`);
  const descendants = await walk(token, userPath);
  return {authUser, descendants, docExists: Boolean(userDoc), userPath};
}

function report(state, uid) {
  console.log(`\nFound for uid ${uid}:`);
  if (state.authUser) {
    console.log('  Auth user      : PRESENT');
    console.log(`    email        : ${state.authUser.email || '(none)'}`);
    console.log(`    created      : ${state.authUser.metadata.creationTime}`);
    console.log(`    last sign-in : ${state.authUser.metadata.lastSignInTime || '(never)'}`);
  } else {
    console.log('  Auth user      : absent');
  }
  console.log(`  users/${uid}  : ${state.docExists ? 'PRESENT' : 'absent'}`);
  const byCollection = state.descendants.reduce((map, item) => map.set(item.collection, (map.get(item.collection) || 0) + 1), new Map());
  if (byCollection.size) {
    console.log(`  subcollections : ${state.descendants.length} document(s) total`);
    [...byCollection.entries()].sort().forEach(([id, n]) => console.log(`    ${id} (${n})`));
  } else {
    console.log('  subcollections : none');
  }
}

async function ask(question) {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim().toLowerCase();
}

async function main() {
  const args = process.argv.slice(2);
  const keyIndex = args.indexOf('--key');
  const keyPath = keyIndex >= 0 ? args[keyIndex + 1] : null;
  // The uid is the first bare argument that is not the value belonging to
  // --key. When --key is absent there is no such value to skip, hence the -1.
  const keyValueIndex = keyIndex >= 0 ? keyIndex + 1 : -1;
  const uid = args.find((arg, index) => !arg.startsWith('--') && index !== keyValueIndex);
  const skipPrompt = args.includes('--yes');
  const dryRun = args.includes('--dry-run');

  if (!uid) fail('Usage: node cleanup-throwaway-user.js <uid> [--dry-run] [--yes] [--key <key.json>]');
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) fail(`"${uid}" does not look like a Firebase uid.`);

  const admin = loadAdmin();
  console.log(`Project: ${PROJECT_ID}`);
  const credential = buildCredential(admin, keyPath);
  admin.initializeApp({credential, projectId: PROJECT_ID});
  const token = await bearer(credential);

  const before = await survey(admin, token, uid);
  report(before, uid);

  if (!before.authUser && !before.docExists && before.descendants.length === 0) {
    console.log('\n[ok] Nothing exists for this uid. No changes made.');
    return;
  }
  if (dryRun) {
    console.log('\n--dry-run given: stopping before any deletion.');
    return;
  }

  console.log('\nThis will permanently delete everything listed above.');
  if (!skipPrompt && (await ask('Type "yes" to proceed: ')) !== 'yes') {
    console.log('\nCancelled. Nothing was deleted.');
    return;
  }

  console.log('\nDeleting...');
  // Deepest first, so a parent is never removed while children still hang off it.
  for (const {path: documentPath} of before.descendants) {
    await api(token, `${FIRESTORE_ROOT}/${documentPath}`, {method: 'DELETE'});
  }
  console.log(`  Firestore: ${before.descendants.length} subcollection document(s) deleted`);
  await api(token, `${FIRESTORE_ROOT}/${before.userPath}`, {method: 'DELETE'});
  console.log(`  Firestore: users/${uid} deleted`);
  if (before.authUser) {
    await admin.auth().deleteUser(uid);
    console.log('  Auth user: deleted');
  }

  // Proof from a fresh read, not from the fact the delete calls returned.
  console.log('\nVerifying (re-reading Auth and Firestore)...');
  const after = await survey(admin, token, uid);
  report(after, uid);

  const authGone = !after.authUser;
  const firestoreGone = !after.docExists && after.descendants.length === 0;
  console.log('');
  console.log(`  Auth user gone      : ${authGone ? 'YES' : 'NO'}`);
  console.log(`  Firestore data gone : ${firestoreGone ? 'YES' : 'NO'}`);

  if (authGone && firestoreGone) {
    console.log('\n[ok] Cleanup verified. Nothing remains for this uid.');
    return;
  }
  fail('Cleanup did NOT fully succeed - see the report above.');
}

main().catch((error) => {
  console.error('\n[x] Unexpected error:');
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
