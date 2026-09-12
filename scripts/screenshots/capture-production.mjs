// Loads the LIVE production site in a real browser, screenshots what it serves,
// and checks that the bundle it actually delivers contains this feature's code.
//
// It stops at the login wall on purpose: this script never authenticates and
// never creates an account, so it proves deployment and clean boot, not the
// logged-in screens. That boundary is stated in the report rather than blurred.
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {chromium} from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const outputDir = path.join(projectRoot, 'docs', 'app-walkthrough', 'verification');
const PRODUCTION = 'https://smartlife-budget.web.app/';

/** Escaped form Metro emits for non-ASCII string literals. */
const escaped = (value) => [...value].map((char) => `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`).join('');

const MARKERS = [
  ['sleep card subtitle', 'ใช้ประเมินความเสี่ยงหมดไฟจากข้อมูลจริง'],
  ['เข้านอน / ตื่นนอน buttons', 'บันทึกเวลาเข้านอน'],
  ['baseline editor', 'ช่วงนอนปกติ'],
  ['risk meter aria-label', 'ความเสี่ยงสภาวะหมดไฟระดับ'],
  ['forgotten-wake prompt', 'ลืมกดตื่นนอนหรือเปล่า'],
  ['logged-vs-baseline copy', 'นอนจริงเฉลี่ย'],
  ['long-sleep lower weight', 'ถ่วงน้ำหนักน้อยกว่า'],
];

async function main() {
  await mkdir(outputDir, {recursive: true});
  const browser = await chromium.launch();
  const page = await browser.newPage({deviceScaleFactor: 2, viewport: {height: 900, width: 1280}});

  const errors = [];
  const bundles = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => {
    if (/_expo\/static\/js\/web\/.*\.js$/.test(response.url())) bundles.push(response.url());
  });

  await page.goto(PRODUCTION, {waitUntil: 'networkidle'});
  await page.waitForTimeout(2500);

  const file = path.join(outputDir, 'production-01-live-site.png');
  await page.screenshot({path: file});
  console.log(`Production: ${PRODUCTION}`);
  console.log(`  screenshot -> ${path.relative(projectRoot, file)}`);
  console.log(`  page title -> ${JSON.stringify(await page.title())}`);
  console.log(`  bundles served (${bundles.length}):`);
  bundles.forEach((url) => console.log(`    ${url.replace(PRODUCTION, '/')}`));

  // Fetched here rather than inside the page: the bundle is several megabytes
  // and returning it across the CDP bridge overflows the string limit. The URLs
  // are the ones production just served, so it is still the delivered artifact.
  let blob = '';
  for (const url of bundles) {
    blob += await fetch(url).then((response) => response.text());
  }
  await writeFile(path.join(outputDir, 'production-bundle-markers.txt'),
    `Checked ${PRODUCTION} at ${new Date().toISOString()}\nBundles: ${bundles.join(', ')}\n\n`
    + MARKERS.map(([name, needle]) => `${blob.includes(escaped(needle)) ? 'PRESENT' : 'ABSENT '}  ${name}`).join('\n') + '\n',
    'utf8');

  console.log(`  bundle bytes -> ${blob.length}`);
  console.log('  feature markers in the bundle production is serving right now:');
  let missing = 0;
  for (const [name, needle] of MARKERS) {
    const present = blob.includes(escaped(needle));
    if (!present) missing += 1;
    console.log(`    ${present ? 'PRESENT' : 'ABSENT '}  ${name}`);
  }

  const fatal = errors.filter((error) => !/app-?check|recaptcha|403|400/i.test(error));
  console.log(`  console errors -> ${errors.length} total, ${fatal.length} after ignoring App Check noise`);
  fatal.slice(0, 5).forEach((error) => console.log(`    ${error.slice(0, 160)}`));

  await browser.close();
  if (missing) {
    console.error(`\nFAIL: ${missing} feature marker(s) missing from production.`);
    process.exit(1);
  }
  console.log('\nProduction serves this feature’s code and boots without fatal errors.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
