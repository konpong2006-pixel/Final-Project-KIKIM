/**
 * Regression guard for the device-local-time bug, everywhere it was found.
 *
 * The app renders every date and time with `timeZone: 'Asia/Bangkok'`, so a
 * wall clock the user names -- "พรุ่งนี้บ่าย 3", a picked slip date, the window a
 * deadline reminder is scheduled in -- is Bangkok wall clock. Building those
 * instants with `new Date(y, m, d)` / `setHours` / `setDate` reads and writes
 * the *device's* clock instead, so anywhere but UTC+7 the result came back
 * shifted, and near a day boundary landed on the wrong day entirely.
 *
 * Every case below is asserted in several timezones, because the whole point of
 * the fix is that the answer no longer depends on the device. Node honours TZ
 * only for some values on some platforms; a child that comes back in the same
 * zone proves nothing and is reported as skipped rather than counted as a pass.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {
  shiftDateKey,
  thailandAtHour,
  thailandDateKey,
  thailandDayStart,
  thailandTimeKey,
  thailandWallClockToDate,
  thailandWeekday,
} from '../src/lib/thailand-time.ts';
import {proposeActionFromMessage} from '../src/services/assistant-tools.ts';

const BANGKOK = 'Asia/Bangkok';
const wall = (value) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', hour: '2-digit', hour12: false, minute: '2-digit',
    month: '2-digit', timeZone: BANGKOK, year: 'numeric',
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
};

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${expected}\n       actual   ${actual}`}`);
};

// ---------------------------------------------------------------- helpers
// Fixed instants, so these assertions say the same thing in every zone.
const noonBangkok = new Date('2026-09-10T05:00:00.000Z');     // 2026-09-10 12:00 +07
const lateBangkok = new Date('2026-09-10T16:45:00.000Z');     // 2026-09-10 23:45 +07
const earlyBangkok = new Date('2026-09-09T17:10:00.000Z');    // 2026-09-10 00:10 +07

check('thailandDateKey at 23:45 Bangkok is still that day', thailandDateKey(lateBangkok), '2026-09-10');
check('thailandDateKey at 00:10 Bangkok is already that day', thailandDateKey(earlyBangkok), '2026-09-10');
check('thailandTimeKey reads the Bangkok clock', thailandTimeKey(lateBangkok), '23:45');
check('thailandWeekday at 23:45 Bangkok', String(thailandWeekday(lateBangkok)), '4'); // Thursday
check('thailandDayStart of a late-evening instant', wall(thailandDayStart(lateBangkok)), '2026-09-10 00:00');
check('thailandDayStart steps whole Bangkok days', wall(thailandDayStart(lateBangkok, 1)), '2026-09-11 00:00');
check('thailandDayStart steps backwards across a month edge', wall(thailandDayStart(new Date('2026-09-01T02:00:00.000Z'), -1)), '2026-08-31 00:00');
check('thailandAtHour on a late-evening instant', wall(thailandAtHour(lateBangkok, 9, 0)), '2026-09-10 09:00');
check('thailandAtHour with a day offset', wall(thailandAtHour(lateBangkok, 9, 0, 2)), '2026-09-12 09:00');
check('shiftDateKey across a year edge', shiftDateKey('2026-12-31', 1), '2027-01-01');
check('thailandWallClockToDate is the inverse of the keys', wall(thailandWallClockToDate('2026-09-10', '23:45')), '2026-09-10 23:45');

// ------------------------------------------------- assistant-tools parsing
// `proposeActionFromMessage` is the public entry point over `parseStartAt` and
// `parseEndAt`. Anchored on a fixed "now" so the expected day is not a moving
// target: 2026-09-10 12:00 Bangkok, a Thursday.
const RealDate = Date;
const freeze = (instant) => {
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [instant.getTime()]));
    }
    static now() { return instant.getTime(); }
  };
};
const thaw = () => { globalThis.Date = RealDate; };

const scheduleCases = [
  ['เพิ่มกิจกรรมติวเลข พรุ่งนี้ 14:30', '2026-09-11 14:30'],
  ['เพิ่มกิจกรรมติวเลข วันนี้ 23:45', '2026-09-10 23:45'],
  ['เพิ่มกิจกรรมอ่านหนังสือ พรุ่งนี้บ่าย 3', '2026-09-11 15:00'],
  ['เพิ่มกิจกรรมประชุมกลุ่ม มะรืน 2 ทุ่ม', '2026-09-12 20:00'],
  ['เพิ่มกิจกรรมเข้าคลาส วันจันทร์ 08:00', '2026-09-14 08:00'],
  ['เพิ่มกิจกรรมสอบกลางภาค 2026-12-31 23:30', '2026-12-31 23:30'],
  ['เพิ่มกิจกรรมส่งงาน 31/12/2569 23:59', '2026-12-31 23:59'],
  ['เพิ่มกิจกรรมนัดหมอ 1 มกราคม 2027 09:00', '2027-01-01 09:00'],
  // The year is optional; see test:thai-date-parsing for the year rules.
  ['เพิ่มกิจกรรมนัดหมอ 1 มกราคม 09:00', '2026-01-01 09:00'],
  ['เพิ่มกิจกรรมติวเลข พรุ่งนี้ 00:15', '2026-09-11 00:15'],
];

freeze(noonBangkok);
try {
  for (const [message, expected] of scheduleCases) {
    const action = proposeActionFromMessage(message);
    const startAt = action?.payload?.startAt;
    check(`assistant: "${message}"`, startAt ? wall(startAt) : String(startAt), expected);
  }
  // An explicit range keeps both ends on the Bangkok clock, and rolls the end
  // over midnight rather than backwards.
  const ranged = proposeActionFromMessage('เพิ่มกิจกรรมติวเลข พรุ่งนี้ 23:00-01:00');
  check('assistant: range start', wall(ranged.payload.startAt), '2026-09-11 23:00');
  check('assistant: range end rolls past midnight', wall(ranged.payload.endAt), '2026-09-12 01:00');
} finally {
  thaw();
}

// ------------------------------------------- deadline-notifications window
// The reminder sweep asks Firestore for a span of Bangkok days around today.
check('deadline window starts 30 Bangkok days back', wall(thailandDayStart(lateBangkok, -30)), '2026-08-11 00:00');
check('deadline window ends 14 Bangkok days ahead', wall(thailandDayStart(lateBangkok, 14)), '2026-09-24 00:00');

// ------------------------------------------------ line-import picker edit
// Editing only the time must keep the Bangkok day, and editing only the date
// must keep the Bangkok time -- including when the two disagree about the day
// in the device's zone.
const editTime = thailandWallClockToDate(thailandDateKey(lateBangkok), '00:30');
check('line import: changing the time keeps the Bangkok day', wall(editTime), '2026-09-10 00:30');
const editDate = thailandWallClockToDate('2026-12-31', thailandTimeKey(lateBangkok));
check('line import: changing the date keeps the Bangkok time', wall(editDate), '2026-12-31 23:45');

const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (failures) {
  console.error(`\n${failures} assertion(s) failed in TZ=${deviceZone}`);
  process.exit(1);
}
console.log(`\nall assertions held (device TZ=${deviceZone})`);

if (!process.env.SMARTLIFE_TZ_CHILD) {
  for (const zone of ['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Auckland', 'America/Anchorage']) {
    const output = execFileSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: {...process.env, SMARTLIFE_TZ_CHILD: '1', TZ: zone},
    });
    const ran = /device TZ=(\S+)\)/.exec(output)?.[1];
    console.log(ran === deviceZone
      ? `skipped TZ=${zone} (this platform ignored TZ and stayed on ${deviceZone})`
      : `all assertions held under TZ=${zone}`);
  }
}

assert.ok(failures === 0);
