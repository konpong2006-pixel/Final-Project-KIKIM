// Resolves the `@/*` path alias from tsconfig.json for plain `node
// --experimental-strip-types` runs. Metro and tsc read the alias from
// tsconfig; bare Node does not, so any src module that imports a *value*
// through `@/` (type-only imports are stripped before resolution) fails to
// load inside the test scripts without this hook.
import {existsSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';

const projectRoot = new URL('../', import.meta.url);
const candidateSuffixes = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'];

export async function resolve(specifier, context, nextResolve) {
  // Relative imports between .ts files are written without an extension
  // (tsc resolves them; the Cloud Functions sources rely on it). Plain Node
  // needs the file name, so try the .ts sibling before giving up.
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
    for (const suffix of ['.ts', '/index.ts']) {
      const candidate = new URL(`${specifier}${suffix}`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
  }
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context);

  const base = specifier.startsWith('@/assets/')
    ? new URL(specifier.slice('@/'.length), projectRoot)
    : new URL(`src/${specifier.slice('@/'.length)}`, projectRoot);

  for (const suffix of candidateSuffixes) {
    const candidate = new URL(`${base.href}${suffix}`);
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(pathToFileURL(fileURLToPath(candidate)).href, context);
    }
  }
  return nextResolve(base.href, context);
}
