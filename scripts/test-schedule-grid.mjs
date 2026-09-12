/**
 * The geometry-first timetable reader, on the word boxes Google Vision
 * returned for real scans, and the OCR cross-check that decides which of the
 * model's readings may be used.
 *
 * The regression this pins down: the schedule OCR text is iApp's row-by-row
 * transcript and Vision's column-by-column one joined together, and the text
 * parsers read both, so a seven-course timetable came back as thirteen
 * entries -- with malformed twins such as "DMR30364" holding another course's
 * room. The grid is now read from coordinates, from one transcript.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {parseScheduleGrid} from '../functions/src/schedule-parsers/vision-schedule-grid.ts';
import {crossCheckScheduleEntries} from '../functions/src/schedule-parsers/gemini-grid-crosscheck.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -> ${detail}` : ''}`);
};
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const real = fixture('scan-ocr-real.json');

// The seven real courses, as the timetable prints them.
const TRUTH = {
  'ACC315-68': {day: 'จันทร์', start: '08:00', end: '11:00', section: '01', room: '410'},
  'RSU243-67': {day: 'จันทร์', start: '13:00', end: '16:00', section: '02', room: '305'},
  'DMR209-64': {day: 'อังคาร', start: '09:00', end: '12:00', section: '01', room: '412'},
  'DMR404-64': {day: 'พุธ', start: '13:00', end: '16:00', section: '01', room: '410'},
  'DMR303-64': {day: 'พฤหัสบดี', start: '08:00', end: '11:00', section: '01', room: '410'},
  'ENL128-67': {day: 'พฤหัสบดี', start: '13:00', end: '15:00', section: '05', room: '204'},
  'DMR202-64': {day: 'ศุกร์', start: '09:00', end: '12:00', section: '01', room: '411'},
};

function compare(name, entries, {withEnd}) {
  check(`${name}: exactly 7 courses (the bug returned 13)`, entries.length === 7, `${entries.length}: ${entries.map((e) => e.courseCode).join(' ')}`);
  for (const [code, want] of Object.entries(TRUTH)) {
    const got = entries.filter((entry) => entry.courseCode === code);
    check(`${name}: ${code} appears once`, got.length === 1, `${got.length}`);
    const e = got[0];
    if (!e) continue;
    const fields = {day: e.day, start: e.startTime, section: e.section, room: e.room, ...(withEnd ? {end: e.endTime} : {})};
    const wrong = Object.entries(fields).filter(([key, value]) => value !== want[key]);
    check(`${name}: ${code} fields`, !wrong.length, wrong.map(([k, v]) => `${k}=${v} want ${want[k]}`).join(', '));
  }
}

// --- a timetable that prints its times in each cell ------------------------
const anchored = parseScheduleGrid(fixture('vision-timetable.json'));
check('anchored timetable: grid found', anchored.found);
compare('anchored timetable', anchored.entries, {withEnd: true});
check('anchored timetable: nothing flagged by the grid itself', anchored.entries.every((e) => !(e.reviewFields ?? []).length));

// --- a heading-less Thai grid: abbreviated days, no times in the cells -----
// The old path found 0 courses here. Monday's "จ." was not recognised by OCR
// at all, so its day comes from the evenly spaced rows below it.
const bare = parseScheduleGrid(fixture('vision-grid-noheading.json'));
check('heading-less grid: grid found', bare.found);
compare('heading-less grid', bare.entries, {withEnd: false});
check('heading-less grid: Monday recovered though its header was never read',
  !bare.rows.some((row) => row.day === 'จันทร์') && bare.entries.filter((e) => e.day === 'จันทร์').length === 2);
check('heading-less grid: end times stay unknown rather than guessed', bare.entries.every((e) => e.endTime === null));

// --- photographs: tilted, perspective-warped, glared ----------------------
// Rows are found by height and columns by position, so a tilted photo would
// put a course in the neighbouring row. The tilt is measured from the time
// headers and rotated out first; these are rendered photos read by Vision.
for (const [name, degrees] of [['vision-photo-tilt3.json', 3], ['vision-photo-tilt-neg5-glare.json', -5], ['vision-photo-perspective.json', null]]) {
  const photo = parseScheduleGrid(fixture(name));
  if (degrees !== null) {
    check(`${name}: tilt measured as ~${degrees} degrees`, Math.abs(photo.skewDegrees - degrees) < 0.6, `${photo.skewDegrees}`);
  }
  compare(name, photo.entries, {withEnd: true});
}

// --- a document that is not a grid is left to the text parsers -------------
check('no grid in an annotation without time headers', !parseScheduleGrid({pages: []}).found);

// --- the cross-check: the model is trusted only as far as the OCR goes -----
const ocr = real.gridThaiAbbrevNoHeading;
const model = (overrides = {}) => Object.entries(TRUTH).map(([code, t]) => ({
  course_code: code, day: ({'จันทร์': 'MON', 'อังคาร': 'TUE', 'พุธ': 'WED', 'พฤหัสบดี': 'THU', 'ศุกร์': 'FRI'})[t.day],
  start_time: t.start, end_time: t.end, section: t.section, room: t.room, ...(overrides[code] ?? {}),
}));
const gridDays = bare.rows.map((row) => row.day);

const honest = crossCheckScheduleEntries(bare.entries, model(), ocr, gridDays);
check('verified end times fill the gap the grid could not read', honest.entries.every((e) => e.endTime === TRUTH[e.courseCode]?.end),
  honest.entries.map((e) => `${e.courseCode}:${e.endTime}`).join(' '));
check('verified values are not flagged', honest.entries.every((e) => !(e.reviewFields ?? []).length), JSON.stringify(honest.stats));
compare('grid + honest model', honest.entries, {withEnd: true});

const lying = crossCheckScheduleEntries(bare.entries, model({
  'DMR303-64': {room: '999'}, // a room that is nowhere in the scan
  'DMR209-64': {end_time: '17:40'}, // a time that is nowhere in the scan
}), ocr, gridDays);
const dmr303 = lying.entries.find((e) => e.courseCode === 'DMR303-64');
const dmr209 = lying.entries.find((e) => e.courseCode === 'DMR209-64');
check('a model room that disagrees with the grid and is not in the OCR is ignored', dmr303?.room === '410' && !(dmr303?.reviewFields ?? []).includes('room'),
  `room=${dmr303?.room} flags=${dmr303?.reviewFields}`);
check('an unverifiable model end time is NOT filled in, only flagged', dmr209?.endTime === null && (dmr209?.reviewFields ?? []).includes('endTime'),
  `end=${dmr209?.endTime} flags=${dmr209?.reviewFields}`);
check('...with the model reading and the reason in the note', (dmr209?.reviewNotes ?? []).some((note) => note.includes('17:40') && note.includes('ไม่พบในข้อความที่สแกน')));

// The model writes "ห้อง 410" and "Sec 01" where the grid reads the bare value.
const labelled = crossCheckScheduleEntries(anchored.entries, model({'ACC315-68': {room: 'ห้อง 410', section: 'Sec 01'}}), real.timetableFused, anchored.rows.map((r) => r.day));
check('a room or section the model prefixes with its label still agrees', !(labelled.entries.find((e) => e.courseCode === 'ACC315-68')?.reviewFields ?? []).length,
  JSON.stringify(labelled.stats));

const conflicting = crossCheckScheduleEntries(anchored.entries, model({'ACC315-68': {room: '305'}}), real.timetableFused, anchored.rows.map((r) => r.day));
const acc = conflicting.entries.find((e) => e.courseCode === 'ACC315-68');
check('a disagreement where both readings are on the page keeps the grid value and flags it',
  acc?.room === '410' && (acc?.reviewFields ?? []).includes('room'), `room=${acc?.room} flags=${acc?.reviewFields}`);

const invented = crossCheckScheduleEntries(anchored.entries, [...model(), {course_code: 'XYZ999-99', day: 'SAT', start_time: '09:00', end_time: '12:00', section: '01', room: '101'}],
  real.timetableFused, anchored.rows.map((r) => r.day));
check('a course the model invented is dropped', !invented.entries.some((e) => e.courseCode === 'XYZ999-99') && invented.stats.dropped === 1);

const missed = crossCheckScheduleEntries(anchored.entries.filter((e) => e.courseCode !== 'ENL128-67'), model(), real.timetableFused, anchored.rows.map((r) => r.day));
const rescued = missed.entries.find((e) => e.courseCode === 'ENL128-67');
check('a real course only the model found is kept, flagged for review', Boolean(rescued) && (rescued?.reviewFields ?? []).includes('courseCode'),
  `${rescued?.courseCode} flags=${rescued?.reviewFields}`);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nschedule grid passed: 7 courses from 7, every field read by position, the model held to the OCR');
assert.equal(failures, 0);
