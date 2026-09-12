// Entry hook for the RiskMeter render check: the `@/*` alias, the
// react-native -> react-native-web swap the web build performs, and a JSX
// transform, since Node strips types but cannot compile JSX.
import {register} from 'node:module';

register('./ts-alias-loader.mjs', import.meta.url);
register('./react-native-web-loader.mjs', import.meta.url);
register('./tsx-transform-loader.mjs', import.meta.url);
