// Entry hook for `node --import ./scripts/register-timezone-sweep.mjs`.
import {register} from 'node:module';

register('./ts-alias-loader.mjs', import.meta.url);
register('./timezone-sweep-loader.mjs', import.meta.url);
