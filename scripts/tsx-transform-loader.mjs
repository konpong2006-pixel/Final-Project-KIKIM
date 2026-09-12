// Transpiles .tsx/.ts to plain JS for the render check. Node's built-in type
// stripping removes annotations but leaves JSX intact, which the ESM loader
// then refuses. TypeScript itself does the transform, so the component under
// test is the real source rather than a hand-written stand-in.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

import ts from 'typescript';

export async function load(url, context, nextLoad) {
  if (!/\.tsx?$/.test(url) || !url.startsWith('file:')) return nextLoad(url, context);
  const source = await readFile(fileURLToPath(url), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: fileURLToPath(url),
  });
  return {format: 'module', shortCircuit: true, source: outputText};
}
