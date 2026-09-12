import assert from 'node:assert/strict';

import {parseListSchedule} from '../functions/src/schedule-parsers/list-parser.ts';

/**
 * A timetable with the shape the real ones have: a day per row, times across
 * the top, and each cell holding a course code, a Sec line, a room and a time
 * range on separate lines. OCR flattens that grid into exactly this kind of
 * line soup, which is what the list parser has to survive.
 *
 * Seven courses. Everything else is a detail of one of those seven.
 */
const TIMETABLE = `
ตารางเรียน ภาคการศึกษาที่ 1 ปีการศึกษา 2568
เวลา 08:00 09:00 10:00 11:00 12:00 13:00 14:00 15:00 16:00
จันทร์
ACC315-68
Sec 01
SCI-1204
08:00-11:00
RSU243-67
Sec 02
A-305
13:00-16:00
อังคาร
DMR209-64
Sec 01
DMR-2201
09:00-12:00
พุธ
DMR404-64
Sec 01
DMR-2203
13:00-16:00
พฤหัสบดี
DMR303-64
Sec 01
DMR-2201
08:00-11:00
ENL128-67
Sec 05
LNG-0304
13:00-15:00
ศุกร์
DMR202-64
Sec 01
DMR-2202
09:00-12:00
`;

const EXPECTED = ['ACC31568', 'RSU24367', 'DMR20964', 'DMR40464', 'DMR30364', 'ENL12867', 'DMR20264'];

const entries = parseListSchedule(TIMETABLE);
const codes = entries.map((entry) => entry.courseCode);

console.log(`extracted ${entries.length} entries:`);
for (const entry of entries) {
  console.log(`  ${String(entry.courseCode).padEnd(12)}  day=${entry.day ?? '-'}  ${entry.startTime ?? '-'}-${entry.endTime ?? '-'}  room=${entry.room ?? '-'}`);
}

const unexpected = codes.filter((code) => !EXPECTED.includes(code));
assert.deepEqual(unexpected, [], `a room or section line was read as a course: ${unexpected.join(', ')}`);

for (const code of EXPECTED) {
  assert.ok(codes.includes(code), `${code} is missing from the extraction`);
}
assert.equal(entries.length, EXPECTED.length,
  `expected exactly ${EXPECTED.length} courses, got ${entries.length}`);

// Every field, not just the count: the room misreads used to steal the real
// courses' times and push them into the next day's row, so a correct count
// alone would not prove much.
const EXPECT_ROWS = {
  ACC31568: {day: 'MON', startTime: '08:00', endTime: '11:00', room: 'SCI-1204'},
  RSU24367: {day: 'MON', startTime: '13:00', endTime: '16:00', room: 'A-305'},
  DMR20964: {day: 'TUE', startTime: '09:00', endTime: '12:00', room: 'DMR-2201'},
  DMR40464: {day: 'WED', startTime: '13:00', endTime: '16:00', room: 'DMR-2203'},
  DMR30364: {day: 'THU', startTime: '08:00', endTime: '11:00', room: 'DMR-2201'},
  ENL12867: {day: 'THU', startTime: '13:00', endTime: '15:00', room: 'LNG-0304'},
  DMR20264: {day: 'FRI', startTime: '09:00', endTime: '12:00', room: 'DMR-2202'},
};
for (const [code, want] of Object.entries(EXPECT_ROWS)) {
  const got = entries.find((entry) => entry.courseCode === code);
  assert.ok(got, `${code} missing`);
  assert.equal(got.day, want.day, `${code} day`);
  assert.equal(got.startTime, want.startTime, `${code} start time`);
  assert.equal(got.endTime, want.endTime, `${code} end time`);
  assert.equal(got.room, want.room, `${code} room`);
}

// A spaced code in a list-style document still parses, since dropping the
// loose pattern entirely would have broken those.
const SPACED = parseListSchedule('CS 101 Intro to Computing\nMON 09:00-12:00\nRoom B-201');
assert.equal(SPACED.length, 1, `a spaced course code must still parse, got ${SPACED.length}`);
assert.equal(SPACED[0].day, 'MON');

// A merged cell -- one course spanning two time columns -- is still one course.
const MERGED = `
จันทร์
ACC315-68
Sec 01
SCI-1204
08:00-11:00
11:00-12:00
`;
const merged = parseListSchedule(MERGED);
assert.equal(merged.length, 1, `a merged cell must stay one course, got ${merged.length}`);

// Days must come from the row the course sits in, not from anywhere in the text.
const monday = entries.find((entry) => entry.courseCode === 'ACC31568');
assert.equal(monday?.day, 'MON', `ACC315-68 belongs to Monday, got ${monday?.day}`);
const friday = entries.find((entry) => entry.courseCode === 'DMR20264');
assert.equal(friday?.day, 'FRI', `DMR202-64 belongs to Friday, got ${friday?.day}`);

console.log(`\nSchedule extraction tests passed: ${entries.length} courses, no room or section rows promoted.`);
