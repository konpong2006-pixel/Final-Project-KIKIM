/**
 * Regression guard for the year the assistant reads out of a Thai named date.
 *
 * `parseThaiNamedDate` matched an optional trailing year as `\s*(\d{2,4})`,
 * which happily swallowed the hour of a time written after the month: "1
 * มกราคม 09:00" captured "09", ran it through the two-digit rule, and created
 * the activity in **2009**. The year group now carries a lookahead that rejects
 * a number running on into more digits or into a clock separator.
 *
 * The cases below cover both directions: the times that must no longer be
 * mistaken for years, and the years that must still be read as years.
 */
import assert from 'node:assert/strict';

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

// Frozen at 2026-09-08 12:00 Bangkok so "the current year" is a fixed 2026.
const NOW = new Date('2026-09-08T05:00:00.000Z');
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
  static now() { return NOW.getTime(); }
};

const cases = [
  // --- The bug: a time after the month is not a year.
  ['เพิ่มกิจกรรมนัดหมอ 1 มกราคม 09:00', '2026-01-01 09:00'],
  ['เพิ่มกิจกรรมติวเลข 25 ธันวาคม 14:30', '2026-12-25 14:30'],
  // A dot is a clock separator too, and "14.30" must not read as the year 2014.
  ['เพิ่มกิจกรรมติวเลข 25 ธันวาคม 14.30', '2026-12-25 14:30'],
  // Midnight is the case most likely to regress: "00" is a plausible year.
  ['เพิ่มกิจกรรมเดินทาง 3 มีนาคม 00:30', '2026-03-03 00:30'],

  // --- No year and no digits after the month at all: still the current year.
  ['เพิ่มกิจกรรมติวเลข 25 ธันวาคม บ่าย 2', '2026-12-25 14:00'],
  ['เพิ่มกิจกรรมประชุมกลุ่ม 3 มีนาคม 2 ทุ่ม', '2026-03-03 20:00'],

  // --- A real year must still be read as one, with and without a time.
  ['เพิ่มกิจกรรมนัดหมอ 1 มกราคม 2027 09:00', '2027-01-01 09:00'],
  ['เพิ่มกิจกรรมสอบ 5 ก.พ. 2570 13:00', '2027-02-05 13:00'],
  ['เพิ่มกิจกรรมสอบปลายภาค 10 พฤษภาคม 2027 บ่าย 3', '2027-05-10 15:00'],
  // Two-digit years keep the existing >=50 Buddhist-era rule.
  ['เพิ่มกิจกรรมนัดหมอ 1 มกราคม 70 09:00', '2027-01-01 09:00'],
  ['เพิ่มกิจกรรมนัดหมอ 1 มกราคม 27 09:00', '2027-01-01 09:00'],
];

let failures = 0;
for (const [message, expected] of cases) {
  const action = proposeActionFromMessage(message);
  const actual = action?.payload?.startAt ? wall(action.payload.startAt) : String(action?.payload?.startAt);
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}\n       ${ok ? actual : `expected ${expected}\n       actual   ${actual}`}`);
}

globalThis.Date = RealDate;

if (failures) {
  console.error(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log(`\nall ${cases.length} named-date cases parsed the intended year`);
assert.equal(failures, 0);
