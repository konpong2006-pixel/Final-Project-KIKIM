// `getFunctions(app, region)` runs at module load in several services and needs
// a real initialised Firebase app. Nothing in the date arithmetic under test
// calls a callable, so it resolves to inert handles.
export function getFunctions() { return {region: 'asia-southeast1'}; }
export function httpsCallable() {
  return async () => { throw new Error('callable not available in the timezone sweep test'); };
}
export function connectFunctionsEmulator() {}
