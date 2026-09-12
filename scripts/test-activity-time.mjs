/**
 * Regression guard for the activity-save time bug.
 *
 * The forms hold `YYYY-MM-DD` + `HH:mm` as Bangkok wall clock, because every
 * screen renders with `timeZone: 'Asia/Bangkok'`. Building the instant with
 * `new Date(`${date}T${time}:00`)` read them in the device's zone instead, so
 * an activity saved on any device that is not UTC+7 came back displaced -- and
 * near midnight by a whole day. The conversion now goes through
 * `thailandWallClockToDate`, and this asserts the full round trip
 *   picked wall clock -> instant -> ISO (Firestore) -> calendar render
 * is the identity, run once per timezone by `test:activity-time`.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {thailandDateKey, thailandTimeKey, thailandWallClockToDate} from '../src/lib/thailand-time.ts';

const BANGKOK = 'Asia/Bangkok';
const renderTime = (value) => new Intl.DateTimeFormat('th-TH', {hour: '2-digit', hour12: false, minute: '2-digit', timeZone: BANGKOK}).format(value);
const renderDay = (value) => {
  const parts = new Intl.DateTimeFormat('en-US', {day: '2-digit', month: '2-digit', timeZone: BANGKOK, year: 'numeric'}).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const cases = [
  ['2026-09-10', '14:30'],
  ['2026-09-10', '08:00'],
  ['2026-09-10', '00:00'],
  ['2026-09-10', '00:15'],
  ['2026-09-10', '23:45'],
  ['2026-09-10', '23:59'],
  ['2026-09-11', '00:00'],
  ['2026-12-31', '23:30'],
  ['2027-01-01', '00:30'],
  ['2026-02-28', '12:00'],
];

let failures = 0;
for (const [date, time] of cases) {
  const start = thailandWallClockToDate(date, time);
  // legacy-data does `new Date(iso)` then `Timestamp.fromDate`, and the
  // calendar reads it back with `toDate()`; the ISO hop is the lossy step.
  const stored = new Date(start.toISOString());
  const shownDay = renderDay(stored);
  const shownTime = renderTime(stored);
  const ok = shownDay === date && shownTime === time;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${date} ${time} -> ${start.toISOString()} -> ${shownDay} ${shownTime}`);
}

// The picker prefill and the "now" defaults must speak the same wall clock.
const noon = new Date('2026-09-10T05:00:00.000Z'); // 12:00 in Bangkok
assert.equal(thailandDateKey(noon), '2026-09-10');
assert.equal(thailandTimeKey(noon), '12:00');
// 23:45 Bangkok is still the 10th even though it is the 10th 16:45 in UTC.
const late = thailandWallClockToDate('2026-09-10', '23:45');
assert.equal(thailandDateKey(late), '2026-09-10');
assert.equal(thailandTimeKey(late), '23:45');
assert.ok(Number.isNaN(thailandWallClockToDate('not-a-date', '10:00').getTime()));

if (failures) {
  console.error(`\n${failures} case(s) did not round-trip in TZ=${process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  process.exit(1);
}
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
console.log(`\nall ${cases.length} cases round-tripped (device TZ=${deviceZone})`);

// The point of the fix is that the answer no longer depends on the device's
// clock, so re-run the same assertions in other zones. Node honours TZ only for
// some values on Windows; when the child comes back in the same zone it proves
// nothing, so report that rather than counting it as a pass.
if (!process.env.SMARTLIFE_TZ_CHILD) {
  for (const zone of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
    const output = execFileSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: {...process.env, SMARTLIFE_TZ_CHILD: '1', TZ: zone},
    });
    const ran = /device TZ=(\S+)\)/.exec(output)?.[1];
    console.log(ran === deviceZone
      ? `skipped TZ=${zone} (this platform ignored TZ and stayed on ${deviceZone})`
      : `all ${cases.length} cases round-tripped under TZ=${zone}`);
  }
}
