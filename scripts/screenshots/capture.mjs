// Bundles the real SleepLogCard / RiskMeter into a page, drives it with real
// clicks in headless Chromium, and writes PNGs. This is rendered-and-clicked
// evidence, not an assertion about a style string.
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import esbuild from 'esbuild';
import {chromium} from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const outputDir = path.join(projectRoot, 'docs', 'app-walkthrough', 'verification');
const buildDir = path.join(projectRoot, 'node_modules', '.cache', 'sleep-screenshots');

/**
 * A blanket `react-native -> react-native-web` alias breaks deep imports such as
 * `react-native/Libraries/Utilities/codegenNativeComponent`, which native-only
 * packages reach for. This maps the bare module precisely and stubs the
 * native-only bits the harness never renders.
 */
const reactNativeWebPlugin = {
  name: 'react-native-web',
  setup(build) {
    build.onResolve({filter: /^react-native$/}, () => ({
      path: path.join(projectRoot, 'node_modules', 'react-native-web', 'dist', 'index.js'),
    }));
    // Native module specs and the safe-area native view have no web meaning.
    build.onResolve({filter: /^react-native\/Libraries\//}, (args) => ({namespace: 'rn-stub', path: args.path}));
    build.onResolve({filter: /^react-native-safe-area-context$/}, (args) => ({namespace: 'rn-safe-area', path: args.path}));
    // expo-linear-gradient does not resolve in a bare esbuild bundle, which
    // left every gradient surface transparent. The real Expo web build renders
    // these fine; here the first colour stands in so panels are opaque.
    build.onResolve({filter: /^expo-linear-gradient$/}, (args) => ({namespace: 'expo-gradient', path: args.path}));
    build.onLoad({filter: /.*/, namespace: 'rn-stub'}, () => ({
      contents: 'export default function stub() { return null; }\nexport const __stub = true;',
      loader: 'js',
    }));
    build.onLoad({filter: /.*/, namespace: 'expo-gradient'}, () => ({
      contents: `
        import {createElement} from 'react';
        import {View} from 'react-native-web';
        export const LinearGradient = ({children, colors = ['#ffffff'], style}) =>
          createElement(View, {style: [style, {backgroundColor: colors[0]}]}, children);
        export default {LinearGradient};
      `,
      loader: 'js',
      resolveDir: projectRoot,
    }));
    build.onLoad({filter: /.*/, namespace: 'rn-safe-area'}, () => ({
      contents: `
        import {createElement} from 'react';
        import {View} from 'react-native-web';
        export const SafeAreaProvider = ({children}) => createElement(View, null, children);
        export const SafeAreaView = ({children, style}) => createElement(View, {style}, children);
        export const useSafeAreaInsets = () => ({bottom: 0, left: 0, right: 0, top: 0});
        export const initialWindowMetrics = {frame: {height: 0, width: 0, x: 0, y: 0}, insets: {bottom: 0, left: 0, right: 0, top: 0}};
        export default {SafeAreaProvider, SafeAreaView, useSafeAreaInsets};
      `,
      loader: 'js',
      resolveDir: projectRoot,
    }));
  },
};

async function bundle() {
  await mkdir(buildDir, {recursive: true});
  await esbuild.build({
    alias: {
      // Swap only the persistence layer. Everything above it -- the sleep
      // service, the card, the model, the meter -- is the real code.
      '@react-native-async-storage/async-storage': path.join(here, 'fake-async-storage.ts'),
      '@/services/firestore': path.join(here, 'fake-sleep-store.ts'),
      '@/services/sleep-baseline-remote': path.join(here, 'fake-baseline-remote.ts'),
    },
    // Some transitive modules read bare `process`, which a browser bundle has
    // no shim for. Defining the fields is not enough; the object must exist.
    banner: {js: 'window.process = window.process || {env: {NODE_ENV: "production"}}; window.global = window.global || window;'},
    bundle: true,
    plugins: [reactNativeWebPlugin],
    define: {
      __DEV__: 'false',
      'process.env.EXPO_PUBLIC_SMARTLIFE_DEMO': '"0"',
      'process.env.NODE_ENV': '"production"',
    },
    entryPoints: [path.join(here, 'harness-entry.tsx')],
    format: 'iife',
    jsx: 'automatic',
    loader: {'.css': 'empty', '.png': 'dataurl', '.ttf': 'dataurl'},
    outfile: path.join(buildDir, 'harness.js'),
    platform: 'browser',
    tsconfig: path.join(projectRoot, 'tsconfig.json'),
  });

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8" />
<style>
  html, body { margin: 0; background: #ffffff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  #root { display: inline-block; }
</style>
</head><body><div id="root"></div><script src="./harness.js"></script></body></html>`;
  await writeFile(path.join(buildDir, 'index.html'), html, 'utf8');
  return pathToFileURL(path.join(buildDir, 'index.html')).href;
}

async function shot(target, name, note, options = {}) {
  await mkdir(outputDir, {recursive: true});
  const file = path.join(outputDir, `${name}.png`);
  await target.screenshot({path: file, ...options});
  console.log(`  saved ${path.relative(projectRoot, file)}  -- ${note}`);
  return file;
}

/**
 * Bounding box around the modal, derived from the title and the two buttons,
 * so the prompt is captured on its own rather than as a dimmed full page.
 */
async function dialogClip(page) {
  const boxes = await Promise.all([
    page.getByText('ลืมกดตื่นนอนหรือเปล่า?').first().boundingBox(),
    page.getByRole('button', {name: 'ลบรายการนี้'}).boundingBox(),
    page.getByRole('button', {name: 'ใช่ ใช้เวลานี้'}).boundingBox(),
  ]);
  const present = boxes.filter(Boolean);
  const left = Math.min(...present.map((box) => box.x));
  const top = Math.min(...present.map((box) => box.y));
  const right = Math.max(...present.map((box) => box.x + box.width));
  const bottom = Math.max(...present.map((box) => box.y + box.height));
  const pad = 26;
  return {
    height: bottom - top + pad * 2,
    width: right - left + pad * 2,
    x: Math.max(0, left - pad),
    y: Math.max(0, top - pad),
  };
}

async function main() {
  const url = await bundle();
  console.log('Harness bundled. Driving it in headless Chromium:\n');

  const browser = await chromium.launch();
  const page = await browser.newPage({deviceScaleFactor: 2, viewport: {height: 1100, width: 900}});
  const failures = [];
  page.on('pageerror', (error) => failures.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });

  await page.goto(url);
  await page.waitForSelector('#panel-sleep');
  await page.waitForSelector('text=บันทึกการนอน');

  const sleepPanel = page.locator('#panel-sleep');

  // --- (a) sleep-log flow, driven by clicking the real buttons -------------
  await shot(sleepPanel, 'sleep-01-idle', 'idle: เข้านอน enabled, ตื่นนอน disabled');

  await page.getByLabel('บันทึกเวลาเข้านอน').click();
  await page.waitForSelector('text=กำลังนอนอยู่');
  await shot(sleepPanel, 'sleep-02-in-bed', 'in bed: open session shown, ตื่นนอน now enabled');

  await page.getByLabel('บันทึกเวลาตื่นนอน').click();
  await page.waitForSelector('text=ยังไม่นับเป็นการนอนหนึ่งคืน');
  await shot(sleepPanel, 'sleep-03-woke-up', 'woke up: sub-2h session refused rather than counted');

  // --- (c) the forgotten-ตื่นนอน prompt ------------------------------------
  // Seeded, then the card is remounted so its loader runs against the new
  // store. Reloading the page instead would clear the in-memory store first.
  await page.evaluate(() => {
    window.__resetStore();
    window.__seedStaleNight(30);
    window.__remount();
  });
  await page.waitForSelector('text=ลืมกดตื่นนอนหรือเปล่า?');
  // The overlay fades and scales in; shooting immediately catches it mid-animation.
  await page.waitForTimeout(700);
  await shot(page, 'sleep-04-forgotten-wake-prompt', 'forgotten ตื่นนอน: confirm/discard prompt', {
    clip: await dialogClip(page),
  });

  // The same phrase appears in the hint sentence, so target the control.
  await page.getByRole('button', {name: 'ใช่ ใช้เวลานี้'}).click();
  await page.waitForSelector('text=คืนนั้นถูกนำไปคิดคะแนนตามปกติ');
  await shot(sleepPanel, 'sleep-05-forgotten-wake-resolved', 'forgotten night repaired and counted');

  // --- (b) risk meter at three real model scores ---------------------------
  const scores = await page.evaluate(() => window.__scores);
  for (const [index, level] of ['low', 'medium', 'high'].entries()) {
    await shot(page.locator(`#panel-meter-${level}`), `meter-${index + 1}-${level}`, `risk meter at real score ${scores[index]}`);
  }
  await shot(page.locator('#panel-meter-low').locator('..'), 'meter-all-three', 'all three meter states together');

  await browser.close();

  if (failures.length) {
    console.error('\nPage errors during capture:');
    failures.forEach((failure) => console.error(`  ${failure}`));
    process.exit(1);
  }
  console.log(`\nScreenshots written to ${path.relative(projectRoot, outputDir)} (model scores: ${scores.join(', ')})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
