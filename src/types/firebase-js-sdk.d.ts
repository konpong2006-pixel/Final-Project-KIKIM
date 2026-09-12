/**
 * The `firebase/*` entry points re-exported from their `@firebase/*`
 * implementations.
 *
 * `firebase/firestore` used to be a hand-written subset here, listing a few
 * dozen members typed as `any`. That silently erased every Firestore type in
 * the app and made any API missing from the list a compile error -- which is
 * how `connectFirestoreEmulator` came to "not exist". The real types compile
 * cleanly, so all five entry points now forward to the genuine declarations.
 */
declare module 'firebase/app' {
  export * from '@firebase/app';
}

declare module 'firebase/auth' {
  export * from '@firebase/auth';
}

declare module 'firebase/firestore' {
  export * from '@firebase/firestore';
}

declare module 'firebase/functions' {
  export * from '@firebase/functions';
}

declare module 'firebase/storage' {
  export * from '@firebase/storage';
}
