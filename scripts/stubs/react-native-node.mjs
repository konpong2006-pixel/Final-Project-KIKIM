// Minimal stand-in for `react-native` so the pure logic in the service layer can
// be exercised by a plain Node test. Only the members the imported modules touch
// at load time are needed; nothing here renders.
export const Platform = {OS: 'web', select: (options) => options.web ?? options.default};
export const NativeModules = {};
export const Alert = {alert() {}};
export const AppState = {addEventListener: () => ({remove() {}}), currentState: 'active'};
export const Linking = {addEventListener: () => ({remove() {}}), openURL: async () => undefined};
export default {Alert, AppState, Linking, NativeModules, Platform};
