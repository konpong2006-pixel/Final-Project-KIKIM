// Loader setup for the sleep-log integration test. Only the two things that
// genuinely cannot exist outside a device are replaced -- AsyncStorage, and the
// Firebase entry point, which is repointed at the emulators rather than faked.
// The sleep service, `firestore.ts`, and the security rules stay real.
import {register} from 'node:module';

process.env.TZ = 'Asia/Bangkok';

register('./ts-alias-loader.mjs', import.meta.url);
register('./sleep-log-stub-loader.mjs', import.meta.url);
