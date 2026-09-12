/**
 * Guards the note maths evaluator.
 *
 * Two things matter here and pull in opposite directions: real arithmetic in a
 * note must compute, and ordinary note text -- especially Thai prose, dates and
 * phone numbers -- must NOT light up as a calculation. Most of these cases are
 * about the second half.
 */
import assert from 'node:assert/strict';

import {evaluateExpression, evaluateNoteBody} from '../src/services/note-math.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -> ${detail}` : ''}`);
};

// --- things that must evaluate ---------------------------------------------
const computes = [
  ['2+2', '4'],
  ['1200 - 350', '850'],
  ['15 * 4', '60'],
  ['100 / 8', '12.5'],
  ['2^10', '1024'],
  ['(120 + 80) * 3', '600'],
  ['0.1 + 0.2', '0.3'],            // floating-point noise must not leak through
  ['1200 + 350 =', '1550'],        // a trailing "=" is how people write it
  ['50 % 7', '1'],
];
for (const [input, expected] of computes) {
  const actual = evaluateExpression(input);
  check(`"${input}" = ${expected}`, actual === expected, `got ${actual}`);
}

// --- things that must stay plain text --------------------------------------
const ignored = [
  'สรุปบทที่ 4',                    // Thai prose with a number
  'อ่าน Linked List ก่อนควิซ',
  'ประชุม 13:00-15:00',            // a time range, not a subtraction
  '2026-09-08',                    // a date, not arithmetic
  '081-234-5678',                  // a phone number
  'TODO: ทบทวน 3 บท',
  '',
  '   ',
  '42',                            // a bare number is not a calculation
  'x + y',                         // no digits
  'ห้อง 401',
];
for (const input of ignored) {
  const actual = evaluateExpression(input);
  check(`"${input}" stays text`, actual === null, `got ${actual}`);
}

// --- the evaluator must not be a code-execution surface ---------------------
const hostile = [
  'import("fs")',
  'createUnit("x")',
  'evaluate("1+1")',
  'parse("1+1")',
  'a = 5',                          // assignment must not persist
];
for (const input of hostile) {
  const actual = evaluateExpression(input);
  check(`"${input}" is refused`, actual === null, `got ${actual}`);
}
// State must not carry between evaluations.
evaluateExpression('a = 5');
check('no state leaks between lines', evaluateExpression('a + 1') === null, `got ${evaluateExpression('a + 1')}`);

// --- whole-body scan --------------------------------------------------------
const body = [
  'ค่าใช้จ่ายสัปดาห์นี้',
  '120 + 80 + 45',
  'ยังเหลืออีก',
  '1000 - 245',
  'ไปเรียน 09:00',
].join('\n');
const lines = evaluateNoteBody(body);
check('body scan found exactly the two sums', lines.length === 2, `found ${lines.length}`);
check('first sum is right', lines[0]?.result === '245' && lines[0]?.line === 1, JSON.stringify(lines[0]));
check('second sum is right', lines[1]?.result === '755' && lines[1]?.line === 3, JSON.stringify(lines[1]));

// An overlong line is ignored rather than evaluated.
check('overlong line ignored', evaluateExpression(`1+${'1+'.repeat(200)}1`) === null);

if (failures) {
  console.error(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log('\nnote maths evaluator passed');
assert.equal(failures, 0);
