// Device- and Firebase-only dependencies of the assistant tool layer, redirected
// to stubs so its date parsing can be tested in plain Node. `react-native` ships
// Flow syntax Node cannot parse, and the Firebase modules use type-only named
// imports that Node cannot link without a compiler. Neither takes part in the
// arithmetic under test.
const stubs = new Map([
  ['react-native', './stubs/react-native-node.mjs'],
  ['@react-native-async-storage/async-storage', './stubs/async-storage-memory.mjs'],
  ['@/lib/firebase', './stubs/firebase-free-services.mjs'],
  ['@/lib/app-check', './stubs/firebase-free-services.mjs'],
  ['firebase/functions', './stubs/firebase-functions-node.mjs'],
]);

export async function resolve(specifier, context, nextResolve) {
  const stub = stubs.get(specifier);
  if (stub) return {shortCircuit: true, url: new URL(stub, import.meta.url).href};
  return nextResolve(specifier, context);
}
