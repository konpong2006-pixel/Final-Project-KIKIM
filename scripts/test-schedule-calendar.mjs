/**
 * The calendar-view timetable reader -- days across the top (or down the
 * side), each class a coloured block whose edges are its times -- together
 * with the layout detection that routes a scan to it, and the check that
 * decides which of Gemini's readings of the blocks may be used.
 *
 * Fixtures are rendered registration-portal week views put through real
 * Google Vision OCR, with the rendered image for the pixel measurements. The
 * printed timetables of test-schedule-grid.mjs must keep going to the
 * ruled-grid reader.
 */
import fs from 'node:fs';

import {decodeScanImage} from '../functions/src/schedule-parsers/image-pixels.ts';
import {detectScheduleLayout} from '../functions/src/schedule-parsers/schedule-layout.ts';
import {crossCheckCalendarBlocks, parseCalendarBlocks} from '../functions/src/schedule-parsers/calendar-block-schedule.ts';
import {calendarBlockLayout, cellGridLayout} from '../functions/src/schedule-parsers/schedule-strategy.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -> ${detail}` : ''}`);
};
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const pixelsOf = (name, annotation) => {
  const png = fs.readFileSync(new URL(`./fixtures/${name}.png`, import.meta.url));
  return decodeScanImage(`data:image/png;base64,${png.toString('base64')}`, annotation.pages[0].width, annotation.pages[0].height);
};
/** Letters only: Vision gets the letters of a Thai name right more reliably than its marks. */
const letters = (value) => String(value ?? '').normalize('NFKD').replace(/[็-๎]/g, '').replace(/า{2,}/g, 'า').replace(/\s+/g, '');
const DAY_EN = {จันทร์: 'MON', อังคาร: 'TUE', พุธ: 'WED', พฤหัสบดี: 'THU', ศุกร์: 'FRI', เสาร์: 'SAT', อาทิตย์: 'SUN'};

// The four classes of the reported portal view (ภาคการศึกษา 1/2569).
const PORTAL = [
  {code: '1101041', day: 'จันทร์', start: '09:00', end: '12:00', name: 'ภาษาอังกฤษเพื่อการนำเสนอทางธุรกิจ'},
  {code: '1101913', day: 'จันทร์', start: '16:00', end: '18:00', name: 'ผู้ประกอบการธุรกิจ'},
  {code: 'IST201506', day: 'พุธ', start: '15:00', end: '17:00', name: 'สุขภาพองค์รวม'},
  {code: '1101911', day: 'ศุกร์', start: '09:00', end: '12:00', name: 'โครงงานเทคโนโลยีดิจิทัล 1'},
];
// Narrower columns, a dark header, a missing Monday header, half-hour edges.
const NARROW = [
  {code: '1101041', day: 'จันทร์', start: '09:30', end: '12:00', name: 'ภาษาอังกฤษเพื่อการนำเสนอทางธุรกิจ'},
  {code: 'GEN121', day: 'อังคาร', start: '13:00', end: '14:30', name: 'การคิดเชิงวิพากษ์'},
  {code: 'IST201506', day: 'พุธ', start: '15:00', end: '16:30', name: 'สุขภาพองค์รวม'},
  {code: '1101911', day: 'ศุกร์', start: '08:00', end: '11:00', name: 'โครงงานเทคโนโลยีดิจิทัล 1'},
  {code: '1101913', day: 'เสาร์', start: '10:00', end: '12:00', name: 'ผู้ประกอบการธุรกิจ'},
];

function compareGeometry(name, entries, truth) {
  check(`${name}: one entry per class`, entries.length === truth.length, `${entries.length}: ${entries.map((e) => e.courseCode).join(' ')}`);
  for (const want of truth) {
    const got = entries.find((entry) => entry.courseCode === want.code);
    const detail = got ? `${got.day} ${got.startTime}-${got.endTime} "${got.courseName}"` : 'missing';
    check(`${name}: ${want.code} on ${want.day} ${want.start}-${want.end}`,
      Boolean(got) && got.day === want.day && got.startTime === want.start && got.endTime === want.end, detail);
    check(`${name}: ${want.code} name read from its block`, Boolean(got) && letters(got.courseName) === letters(want.name), detail);
  }
}

// --- layout detection and routing ------------------------------------------
const cases = [
  ['cal-portal', 'days-as-columns', PORTAL],
  ['cal-narrow', 'days-as-columns', NARROW],
  ['cal-rows', 'days-as-rows', PORTAL],
];
const read = {};
for (const [name, orientation, truth] of cases) {
  const annotation = fixture(`vision-${name}.json`);
  const pixels = pixelsOf(name, annotation);
  const layout = detectScheduleLayout(annotation, pixels);
  check(`${name}: detected as ${orientation}`, layout.orientation === orientation, layout.orientation);
  check(`${name}: detected as coloured blocks`, layout.kind === 'calendar-block', `${layout.kind}, ${layout.codesInBlocks}/${layout.codes} codes in ${layout.blocks.length} blocks`);
  check(`${name}: routed to the calendar reader`, calendarBlockLayout(layout));
  const geometry = parseCalendarBlocks(layout, pixels);
  check(`${name}: times measured against the ruled lines`, geometry.timeScale === 'gridlines', geometry.timeScale);
  compareGeometry(name, geometry.entries, truth);
  read[name] = {annotation, geometry, layout};
}

for (const name of ['vision-timetable.json', 'vision-grid-noheading.json', 'vision-photo-tilt3.json', 'vision-photo-tilt-neg5-glare.json', 'vision-photo-perspective.json']) {
  const layout = detectScheduleLayout(fixture(name), null);
  check(`printed timetable ${name}: still days down the side`, layout.orientation === 'days-as-rows', layout.orientation);
  check(`printed timetable ${name}: still goes to the ruled-grid reader`, cellGridLayout(layout) && !calendarBlockLayout(layout));
}

// --- the model's reading, held to the image --------------------------------
const {annotation, geometry} = read['cal-portal'];
const ocr = annotation.text;
const modelOf = (truth) => truth.map((t) => ({course_code: t.code, course_name: t.name, day: DAY_EN[t.day], end_time: t.end, start_time: t.start}));
const byCode = (entries, code) => entries.find((entry) => entry.courseCode === code);

const honest = crossCheckCalendarBlocks(geometry, modelOf(PORTAL), ocr);
check('honest model: four classes, nothing flagged', honest.entries.length === 4 && honest.entries.every((e) => !e.reviewFields.length),
  honest.entries.filter((e) => e.reviewFields.length).map((e) => `${e.courseCode}: ${e.reviewNotes.join(' | ')}`).join('; '));
check('honest model: every field exact, names spelled as printed',
  PORTAL.every((t) => {
    const e = byCode(honest.entries, t.code);
    return e && e.day === t.day && e.startTime === t.start && e.endTime === t.end && e.courseName === t.name;
  }), honest.entries.map((e) => `${e.courseCode} ${e.day} ${e.startTime}-${e.endTime} "${e.courseName}"`).join('; '));
check('honest model: the OCR tone-mark slip "น่า" is corrected from the model', honest.stats.correctedNames >= 1, JSON.stringify(honest.stats));

const lying = crossCheckCalendarBlocks(geometry, [
  ...modelOf(PORTAL).map((course) => course.course_code === 'IST201506' ? {...course, end_time: '17:45'} :
    course.course_code === '1101041' ? {...course, day: 'TUE'} : course),
  {course_code: '9999999', course_name: 'วิชาที่ไม่มีจริง', day: 'THU', end_time: '12:00', start_time: '10:00'},
], ocr);
const ist = byCode(lying.entries, 'IST201506');
check('model end time far from the block edge: edge kept, flagged with the model reading',
  ist.endTime === '17:00' && ist.reviewFields.includes('endTime') && ist.reviewNotes.some((note) => note.includes('17:45')), JSON.stringify(ist.reviewNotes));
const english = byCode(lying.entries, '1101041');
check('model day different from the column: column kept, flagged',
  english.day === 'จันทร์' && english.reviewFields.includes('day'), JSON.stringify(english.reviewNotes));
check('a course the page does not show is dropped', lying.entries.length === 4 && lying.stats.dropped === 1, JSON.stringify(lying.stats));

const cut = crossCheckCalendarBlocks({
  ...geometry,
  entries: geometry.entries.map((e) => e.courseCode === '1101913' ? {...e, endTime: null} : e),
  evidence: geometry.evidence.map((facts, i) => geometry.entries[i].courseCode === '1101913' ? {...facts, cut: true, measuredEnd: false} : facts),
}, modelOf(PORTAL), ocr);
const cutEntry = byCode(cut.entries, '1101913');
check('a block cut off by the image edge gets no end time, even from the model',
  cutEntry.endTime === null && cutEntry.reviewFields.includes('endTime') && cutEntry.reviewNotes.some((n) => n.includes('ถูกตัด')), JSON.stringify(cutEntry.reviewNotes));

// --- no pixels: starts estimated from where the code sits -----------------
const blind = parseCalendarBlocks(detectScheduleLayout(annotation, null), null);
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
check('without pixels: every class found, start estimated near its block, end unknown',
  blind.entries.length === 4 && PORTAL.every((t) => {
    const e = byCode(blind.entries, t.code);
    return e && e.endTime === null && Math.abs(minutes(e.startTime) - minutes(t.start)) <= 20;
  }), blind.entries.map((e) => `${e.courseCode} ${e.startTime}-${e.endTime}`).join('; '));
const blindChecked = crossCheckCalendarBlocks(blind, modelOf(PORTAL), ocr);
check('without pixels, honest model: starts confirmed, on-the-hour ends taken from the printed labels',
  PORTAL.every((t) => {
    const e = byCode(blindChecked.entries, t.code);
    return e.startTime === t.start && e.endTime === t.end && !e.reviewFields.length;
  }), blindChecked.entries.map((e) => `${e.courseCode} ${e.startTime}-${e.endTime} ${e.reviewNotes.join('|')}`).join('; '));
const blindOdd = crossCheckCalendarBlocks(blind, modelOf(PORTAL).map((c) => c.course_code === 'IST201506' ? {...c, end_time: '16:55'} : c), ocr);
const odd = byCode(blindOdd.entries, 'IST201506');
check('without pixels: an end time that is no printed label is not filled, and is flagged',
  odd.endTime === null && odd.reviewFields.includes('endTime') && odd.reviewNotes.some((n) => n.includes('16:55')), JSON.stringify(odd.reviewNotes));
const alone = crossCheckCalendarBlocks(blind, [], ocr);
check('without pixels or a model: estimated starts and missing ends are all flagged for the user',
  alone.entries.every((e) => e.reviewFields.includes('startTime') && e.reviewFields.includes('endTime')));

console.log(failures ? `\n${failures} calendar check(s) FAILED` : '\nschedule calendar passed: day, start, end, code and name for every block, the model held to the image');
process.exit(failures ? 1 : 0);
