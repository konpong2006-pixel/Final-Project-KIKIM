import {
  explicitMutationClause,
  financeMutationKind,
  isExplicitNoteMutation,
  isReadOnlyOrAdviceRequest,
  readOnlyClausesFromMixedMessage,
} from '../src/services/assistant-action-intent.ts';
import {classifyAssistantIntent} from '../src/services/assistant-intent.ts';
import {isNoteLookupIntent, noteLookupTerms} from '../src/services/assistant-note-intent.ts';

const financeCases = [
  ['เงิน500บาทเก็บเงินยังไงให้ได้2000บาท', 500, null],
  ['เงิน500บาทเก็บที่เดือนให้ได้2000แบบนี้ต้องกินข้าว', 500, null],
  ['มีเงิน 500 ควรลงทุนอะไรดี', 500, null],
  ['งบ 300 แบ่งใช้ 3 วัน', 300, null],
  ['เดือนนี้รายจ่ายเท่าไหร่', 0, null],
  ['บันทึกค่าข้าว 50 บาท', 50, 'expense'],
  ['จ่ายค่าข้าวไป 65 บาท', 65, 'expense'],
  ['ซื้อกาแฟ 45 บาท', 45, 'expense'],
  ['จดรายจ่ายค่าเดินทาง 30 บาท', 30, 'expense'],
  ['จดรายจ่ายค่าอาหาร 65 บาท ตอนนี้', 65, 'expense'],
  ['บันทึกรายรับ 1,000 บาท', 1000, 'income'],
  ['ได้เงินมา 500 บาท', 500, 'income'],
  ['เงินเข้า 2,000 บาท', 2000, 'income'],
  ['ผมได้เงินจากรัฐเดือนละ 1000 เก็บต่อให้ได้ 3000', 1000, null],
  ['ไม่ต้องบันทึกค่าข้าว 50 บาท', 50, null],
  ['อย่าจดรายจ่าย 100 บาท', 100, null],
];

const noteCases = [
  ['ฉันมีโน้ตอะไรบ้าง', false],
  ['มีโน้ตการเรียนอะไรบ้าง', false],
  ['จากโน้ตควรทบทวนเรื่องอะไรก่อน', false],
  ['ดูโน้ตล่าสุดให้หน่อย', false],
  ['โน้ตเรื่องสอบว่าอะไร', false],
  ['ทวนโน้ตที่จดไว้เมื่อวาน', false],
  ['จดโน้ตว่าอ่านบทที่ 3', true],
  ['ช่วยเพิ่มโน้ต ทำการบ้าน Data Structures', true],
  ['บันทึกไว้ว่าเตรียมสไลด์พรุ่งนี้', true],
  ['บันทึกว่าเย็นนี้ซื้อของเข้าบ้าน', true],
  ['ไม่ต้องจดโน้ตเรื่องสอบ', false],
];

const readOnlyCases = [
  ['สวัสดีครับ', true],
  ['ควรทำอะไรก่อน', true],
  ['อยากเริ่มลงทุน', true],
  ['ผมได้เงินจากรัฐเดือนละ 1000 เก็บต่อให้ได้ 3000', true],
  ['งานไหนใกล้ถึงกำหนดส่งที่สุด', true],
  ['การบ้านอะไรเดดไลน์ใกล้สุด', true],
  ['เช็กงานที่กำหนดส่งใกล้ที่สุด', true],
  ['งานค้างมีอะไรบ้าง', true],
  ['งานนี้ยังทันไหม', true],
  ['วางแผนงานสัปดาห์นี้ให้หน่อย', true],
  ['ดูตารางเรียน งานที่ใกล้ส่ง และงบที่เหลือของฉัน แล้วบอกว่าพรุ่งนี้ควรทำอะไรก่อน พร้อมวางแผนที่ทำได้จริง', true],
  ['สรุปงานที่ต้องส่งให้หน่อย', true],
  ['พรุ่งนี้มีงานกี่อย่าง', true],
  ['มีโน้ตเรื่องสอบหรือไม่', true],
  ['จ่ายค่าข้าวไป 50 บาท', false],
];

const mixedIntentCases = [
  [
    'วันนี้มีเรียนกี่โมง แล้วจดว่าเย็นนี้ต้องซื้อของ',
    'จดว่าเย็นนี้ต้องซื้อของ',
    ['วันนี้มีเรียนกี่โมง'],
  ],
  [
    'เดือนนี้เหลือเท่าไหร่ และบันทึกค่าข้าว 50 บาท',
    'บันทึกค่าข้าว 50 บาท',
    ['เดือนนี้เหลือเท่าไหร่'],
  ],
  [
    'มีโน้ตเรื่องสอบว่าอะไร',
    null,
    [],
  ],
];

const noteLookupCases = [
  ['ฉันมีโน้ตอะไรบ้าง', true, []],
  ['ดูโน้ตล่าสุดให้หน่อย', true, []],
  ['โน้ตเรื่องสอบว่าอะไร', true, ['สอบ']],
  ['ทวนโน้ตที่จดไว้เมื่อวาน', true, []],
  ['มีโน้ตการเรียนอะไรบ้าง', true, []],
  ['มีโน้ตไอเดียอะไรบ้าง', true, []],
  ['มีโน้ตเกี่ยวกับ Data Structures อะไรบ้าง', true, ['data', 'structures']],
  ['จดโน้ตว่าอ่านบทที่ 3', false, null],
];

const intentCases = [
  ['สวัสดีครับ', 'finance', 'unknown'],
  ['ควรทำอะไรก่อน', 'finance', 'task_note'],
  ['ฉันมีโน้ตอะไรบ้าง', 'unknown', 'task_note'],
  ['ลงทุนอะไรดี', 'unknown', 'finance'],
  ['งานไหนใกล้ถึงกำหนดส่งที่สุด', 'unknown', 'task_note'],
  ['การบ้านอะไรเดดไลน์ใกล้สุด', 'unknown', 'task_note'],
  ['วางแผนงานสัปดาห์นี้ให้หน่อย', 'unknown', 'task_note'],
  ['สรุปงานที่ต้องส่งให้หน่อย', 'unknown', 'task_note'],
  ['จัด ซื้อหนังสือ ช่วงเย็น', 'finance', 'schedule'],
];

const failures = [];
for (const [text, amount, expected] of financeCases) {
  const actual = financeMutationKind(text, amount);
  if (actual !== expected) failures.push({actual, expected, text, type: 'finance-action'});
}
for (const [text, expected] of noteCases) {
  const actual = isExplicitNoteMutation(text);
  if (actual !== expected) failures.push({actual, expected, text, type: 'note-action'});
}
for (const [text, expected] of readOnlyCases) {
  const actual = isReadOnlyOrAdviceRequest(text);
  if (actual !== expected) failures.push({actual, expected, text, type: 'read-only'});
}
for (const [text, expectedMutation, expectedLookups] of mixedIntentCases) {
  const actualMutation = explicitMutationClause(text);
  const actualLookups = readOnlyClausesFromMixedMessage(text);
  if (actualMutation !== expectedMutation) {
    failures.push({actual: actualMutation, expected: expectedMutation, text, type: 'mixed-mutation'});
  }
  if (JSON.stringify(actualLookups) !== JSON.stringify(expectedLookups)) {
    failures.push({actual: actualLookups, expected: expectedLookups, text, type: 'mixed-lookups'});
  }
}
for (const [text, expectedLookup, expectedTerms] of noteLookupCases) {
  const actualLookup = isNoteLookupIntent(text);
  const actualTerms = noteLookupTerms(text);
  if (actualLookup !== expectedLookup) {
    failures.push({actual: actualLookup, expected: expectedLookup, text, type: 'note-lookup'});
  }
  if (expectedTerms && JSON.stringify(actualTerms) !== JSON.stringify(expectedTerms)) {
    failures.push({actual: actualTerms, expected: expectedTerms, text, type: 'note-terms'});
  }
}
for (const [text, previousIntent, expected] of intentCases) {
  const actual = classifyAssistantIntent(text, previousIntent);
  if (actual !== expected) failures.push({actual, expected, text, type: 'intent-context'});
}

const total = financeCases.length + noteCases.length + readOnlyCases.length + intentCases.length +
  mixedIntentCases.length * 2 + noteLookupCases.length * 2;
console.log(`SmartLife assistant action tests: ${total - failures.length}/${total}`);
if (failures.length) {
  failures.forEach((failure) => console.error(failure));
  process.exitCode = 1;
}
