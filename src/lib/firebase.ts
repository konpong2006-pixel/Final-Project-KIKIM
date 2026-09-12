import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseOptions, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  connectAuthEmulator,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

import {hasFirebaseConfig} from '@/lib/demo-mode';

const firebaseConfig: FirebaseOptions = {
  apiKey: hasFirebaseConfig ? process.env.EXPO_PUBLIC_FIREBASE_API_KEY : 'missing-firebase-config',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'smartlife-budget.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'smartlife-budget',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'smartlife-budget.firebasestorage.app',
  messagingSenderId: hasFirebaseConfig ? process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID : '0',
  appId: hasFirebaseConfig ? process.env.EXPO_PUBLIC_FIREBASE_APP_ID : '1:0:web:missing-firebase-config',
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createAuth(): Auth {
  if (Platform.OS === 'web') {
    return getAuth(firebaseApp);
  }

  try {
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/already-initialized') {
      throw error;
    }
    return getAuth(firebaseApp);
  }
}

export const auth = createAuth();
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

/**
 * Opt-in wiring to the local Firebase emulators.
 *
 * Off unless `EXPO_PUBLIC_FIREBASE_EMULATOR` is explicitly set, and the flag is
 * deliberately absent from `.env.local`, so a production build never reaches
 * this branch. It exists so admin-only flows -- which need a real signed-in
 * user carrying the `admin` custom claim, and the callable functions behind it
 * -- can be exercised end to end without touching production data or creating
 * real accounts.
 *
 * `getFunctions(app, region)` is memoised per app and region, and every caller
 * in this project asks for the same `asia-southeast1`, so connecting the one
 * instance here covers all of them.
 */
const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR;
if (emulatorHost) {
  const host = emulatorHost === '1' || emulatorHost === 'true' ? 'localhost' : emulatorHost;
  connectAuthEmulator(auth, `http://${host}:9099`, {disableWarnings: true});
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(getFunctions(firebaseApp, 'asia-southeast1'), host, 5001);
  console.warn(`[firebase] using local emulators at ${host} -- not production`);
}
