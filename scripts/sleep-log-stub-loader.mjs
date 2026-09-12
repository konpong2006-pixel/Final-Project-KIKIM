// Redirects only the device-bound imports for the sleep-log integration test.
const stubs = new Map([
  ['@react-native-async-storage/async-storage', './stubs/async-storage-memory.mjs'],
  ['@/lib/firebase', './stubs/firebase-emulator.mjs'],
]);

export async function resolve(specifier, context, nextResolve) {
  const stub = stubs.get(specifier);
  if (stub) return {shortCircuit: true, url: new URL(stub, import.meta.url).href};
  return nextResolve(specifier, context);
}
