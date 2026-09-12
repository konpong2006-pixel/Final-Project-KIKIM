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
import {calendarBlockLayout, cellGridLayout, gridCellsCarryFields, sidewaysCalendarLayout} from '../functions/src/schedule-parsers/schedule-strategy.ts';
import {parseScheduleGrid} from '../functions/src/schedule-parsers/vision-schedule-grid.ts';

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
const byCodeOf = (entries, code) => entries.find((entry) => entry.courseCode === code);
const modelOf = (truth) => truth.map((t) => ({course_code: t.code, course_name: t.name, day: DAY_EN[t.day], end_time: t.end, start_time: t.start}));
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
  // Days down the side: the grid reader is offered this first and stands
  // aside (its blocks carry no cell fields), so the block reader gets it.
  ['cal-rows', 'days-as-rows', PORTAL, 'sideways'],
  // A phone screenshot: status bar with a "14:40" clock, screen header,
  // semester dropdown and week/day tabs above the grid; narrow columns where
  // Vision misreads a day header and wraps a code. The first real scan of
  // this layout put both 09:00 classes at 14:40 and left Mondays without a day.
  ['cal-phone', 'days-as-columns', PORTAL],
];
const read = {};
for (const [name, orientation, truth, route] of cases) {
  const annotation = fixture(`vision-${name}.json`);
  const pixels = pixelsOf(name, annotation);
  const layout = detectScheduleLayout(annotation, pixels);
  check(`${name}: detected as ${orientation}`, layout.orientation === orientation, layout.orientation);
  check(`${name}: detected as coloured blocks`, layout.kind === 'calendar-block', `${layout.kind}, ${layout.codesInBlocks}/${layout.codes} codes in ${layout.blocks.length} blocks`);
  check(`${name}: routed to the ${route === 'sideways' ? 'block reader as the fallback' : 'calendar reader'}`,
    route === 'sideways' ? sidewaysCalendarLayout(layout) && !calendarBlockLayout(layout) : calendarBlockLayout(layout));
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

// --- the phone screenshot: chrome above the grid ---------------------------
{
  const {geometry: phone, layout} = read['cal-phone'];
  check('phone: the status-bar clock is not taken as an hour label', !layout.timeMarks.some((mark) => mark.minutes === 14 * 60 + 40),
    layout.timeMarks.map((mark) => mark.minutes).join(','));
  const starts = phone.entries.map((entry) => entry.startTime);
  check('phone: no constant time -- blocks at different heights get different starts',
    new Set(starts).size === 3 && byCodeOf(phone.entries, '1101041').startTime !== byCodeOf(phone.entries, '1101913').startTime, starts.join(' '));
  check('phone: the code wrapped across two lines is read whole', phone.entries.some((entry) => entry.courseCode === 'IST201506'),
    phone.entries.map((entry) => entry.courseCode).join(' '));
}

// --- the REAL scan: the user's portal screenshot, ground truth for this layout
// Cut from the user's own phone screenshot of SmartLife's image viewer. Orange
// grid lines, a peach-to-white gradient, a "14:05" status-bar clock, a floating
// nav bar over 18:00-20:00, "IST20" / "1506 |" wrapped, and Vision misreading
// "นำ" as "บ้า" and dropping "ผู้". The deployed reader put both 09:00 classes
// at 14:40 and left Wednesday without a day.
{
  const REAL = [
    {code: '1101041', day: 'จันทร์', start: '09:00', end: '12:00', name: 'ภาษาอังกฤษเพื่อการนำเสนอทางธุรกิจ'},
    {code: '1101913', day: 'จันทร์', start: '16:00', end: '18:00', name: 'ผู้ประกอบการธุรกิจ'},
    {code: 'IST201506', day: 'พุธ', start: '15:00', end: '17:00', name: 'สุขภาพองค์รวม'},
    {code: '1101911', day: 'ศุกร์', start: '09:00', end: '12:00', name: 'โครงงานเทคโนโลยีดิจิทัล 1'},
  ];
  const annotation = fixture('vision-cal-real.json');
  const pixels = pixelsOf('cal-real', annotation);
  const layout = detectScheduleLayout(annotation, pixels);
  check('real scan: a calendar view, days across the top, coloured blocks',
    layout.orientation === 'days-as-columns' && layout.kind === 'calendar-block' && calendarBlockLayout(layout), `${layout.orientation} ${layout.kind}`);
  check('real scan: the "14:05" status-bar clock is not an hour label', !layout.timeMarks.some((mark) => mark.minutes === 14 * 60 + 5));
  const real = parseCalendarBlocks(layout, pixels);
  check('real scan: all four classes, IST201506 read whole across its line break', real.entries.length === 4 && Boolean(byCodeOf(real.entries, 'IST201506')),
    real.entries.map((entry) => entry.courseCode).join(' '));
  for (const want of REAL) {
    const got = byCodeOf(real.entries, want.code);
    check(`real scan: ${want.code} on ${want.day} ${want.start}-${want.end}, measured from its own block`,
      Boolean(got) && got.day === want.day && got.startTime === want.start && got.endTime === want.end &&
        real.evidence[real.entries.indexOf(got)].measuredStart && real.evidence[real.entries.indexOf(got)].measuredEnd,
      got ? `${got.day} ${got.startTime}-${got.endTime}` : 'missing');
  }
  const honestReal = crossCheckCalendarBlocks(real, modelOf(REAL), annotation.text);
  check('real scan, correct model reading: every field exact and nothing flagged',
    REAL.every((t) => {
      const e = byCodeOf(honestReal.entries, t.code);
      return e && e.day === t.day && e.startTime === t.start && e.endTime === t.end && e.courseName === t.name && !e.reviewFields.length;
    }), honestReal.entries.map((e) => `${e.courseCode} ${e.day} ${e.startTime}-${e.endTime} "${e.courseName}" ${e.reviewNotes.join('|')}`).join('; '));
  // Gemini read 1101913's end as 19:00 -- the portal's nav bar covers 18:00-20:00.
  const navBar = crossCheckCalendarBlocks(real, modelOf(REAL).map((c) => c.course_code === '1101913' ? {...c, end_time: '19:00'} : c), annotation.text);
  const hidden = byCodeOf(navBar.entries, '1101913');
  check('real scan: the model\'s 19:00 for the block under the nav bar does not replace the measured 18:00, and is flagged',
    hidden.endTime === '18:00' && hidden.reviewFields.includes('endTime') && hidden.reviewNotes.some((n) => n.includes('19:00')), JSON.stringify(hidden.reviewNotes));
}

// --- a REAL university timetable whose cells are coloured -------------------
// Days down the side, times across the top, every course in a pastel cell with
// its code, "Sec : 01", room and printed range. Cut from the user's phone
// screenshot. Those coloured cells read as blocks, which sent this scan to the
// calendar reader: it returned invented codes ("SEC101" from "Sec" + a room
// number), empty section/room/name and wrong end times. A ruled grid belongs
// to the grid reader whatever colour its cells are.
{
  const CODES = ['ACC315-68', 'RSU243-67', 'DMR209-64', 'DMR404-64', 'DMR303-64', 'ENL128-67', 'DMR202-64'];
  const annotation = fixture('vision-grid-colour-cells.json');
  const layout = detectScheduleLayout(annotation, pixelsOf('grid-colour-cells', annotation));
  check('coloured-cell timetable: days down the side, cells read as blocks',
    layout.orientation === 'days-as-rows' && layout.kind === 'calendar-block', `${layout.orientation} ${layout.kind}, ${layout.blocks.length} blocks`);
  check('coloured-cell timetable: NOT routed to the calendar reader',
    !calendarBlockLayout(layout) && cellGridLayout(layout));
  const grid = parseScheduleGrid(annotation);
  check('coloured-cell timetable: the grid reader reads exactly the seven real courses',
    grid.entries.length === 7 && CODES.every((code) => grid.entries.some((entry) => entry.courseCode === code)),
    grid.entries.map((entry) => entry.courseCode).join(' '));
  check('coloured-cell timetable: no invented course code',
    grid.entries.every((entry) => CODES.includes(entry.courseCode)), grid.entries.map((entry) => entry.courseCode).join(' '));
  check('coloured-cell timetable: every course keeps its section and room from its cell',
    grid.entries.every((entry) => entry.section && entry.room),
    grid.entries.map((entry) => `${entry.courseCode} sec=${entry.section ?? '-'} room=${entry.room ?? '-'}`).join('; '));
  check('coloured-cell timetable: its cells carry fields, so the grid reader answers',
    gridCellsCarryFields(grid.entries));
  // The sideways calendar is the other side of that rule: its blocks carry no
  // section, room or printed range, so the grid reader stands aside for the
  // block reader, which measures each block's edges.
  const sideways = fixture('vision-cal-rows.json');
  const sidewaysLayout = detectScheduleLayout(sideways, pixelsOf('cal-rows', sideways));
  check('sideways calendar: still offered to the block reader as a fallback', sidewaysCalendarLayout(sidewaysLayout));
  check('sideways calendar: its blocks carry no cell fields, so the grid reader stands aside',
    !gridCellsCarryFields(parseScheduleGrid(sideways).entries),
    parseScheduleGrid(sideways).entries.map((entry) => `${entry.courseCode} sec=${entry.section ?? '-'} room=${entry.room ?? '-'} end=${entry.endTime ?? '-'}`).join('; '));
}

// --- a time scale that cannot be trusted is refused, not used ---------------
{
  const {annotation: phoneAnnotation, layout} = read['cal-phone'];
  const scrambled = {...layout, timeMarks: layout.timeMarks.map((mark, index) => ({...mark, minutes: (index * 317) % (24 * 60)}))};
  const refused = parseCalendarBlocks(scrambled, pixelsOf('cal-phone', phoneAnnotation));
  check('scrambled hour labels: the scale is refused and no class gets a time',
    refused.timeScale === 'none' && refused.entries.length === 4 &&
    refused.entries.every((entry, index) => entry.startTime === null && entry.endTime === null && refused.evidence[index].unmeasurable),
    refused.entries.map((entry) => `${entry.courseCode} ${entry.startTime}-${entry.endTime}`).join('; '));
  const flagged = crossCheckCalendarBlocks(refused, modelOf(PORTAL), phoneAnnotation.text);
  check('scrambled hour labels: the model times are offered in the note, not filled in',
    flagged.entries.every((entry) => entry.startTime === null && entry.reviewFields.includes('startTime') &&
      entry.reviewNotes.some((note) => note.includes('วัดเวลาจากภาพไม่ได้'))),
    flagged.entries.map((entry) => `${entry.courseCode} ${entry.startTime} ${entry.reviewNotes[0] ?? ''}`).join('; '));
  check('scrambled hour labels: the days are still read from the columns', flagged.entries.every((entry) => entry.day));
}

// --- the model's reading, held to the image --------------------------------
const {annotation, geometry} = read['cal-portal'];
const ocr = annotation.text;
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
