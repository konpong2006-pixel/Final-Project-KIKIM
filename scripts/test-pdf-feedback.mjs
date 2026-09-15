import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {editScheduleDraft} from '../src/services/assistant-draft-edit.ts';
import {clockMinutes, timetableHoursProblem} from '../src/lib/timetable-hours.ts';
const require = createRequire(import.meta.url);
const {receiptDedupeKeys} = require('../functions/lib/receipt-parsers/receipt-dedupe.js');
const {normalizeResult} = require('../functions/lib/receipt-parsers/gemini-receipt.js');
const {parseReceiptDeterministic} = require('../functions/lib/receipt-parsers/deterministic-receipt.js');

const now = new Date('2026-09-12T02:00:00Z');
const draft = {id: 'same-action', entity: 'schedule', type: 'create', status: 'pending', summary: 'งานเดิม', payload: {title: 'อ่านรายงาน', startAt: '2026-09-13T03:00:00Z', endAt: '2026-09-13T04:00:00Z', estimatedDurationMinutes: 60, aiScheduled: true, isFlexible: true, type: 'task'}};
const changed = editScheduleDraft('เปลี่ยนเป็น 2026-10-03 เวลา 18:30 นาน 90 นาที', draft, now).action;
assert.equal(changed.id, draft.id);
assert.equal(changed.payload.title, draft.payload.title);
assert.equal(changed.payload.startAt, '2026-10-03T11:30:00.000Z');
assert.equal(changed.payload.endAt, '2026-10-03T13:00:00.000Z');
assert.equal(changed.payload.dateLocked, true);
assert.equal(changed.payload.userSelectedTime, true);
assert.equal(draft.payload.startAt, '2026-09-13T03:00:00Z');
assert.equal(editScheduleDraft('เปลี่ยนเวลาเป็น 19:15', draft, now).action.payload.startAt, '2026-09-13T12:15:00.000Z');
assert.equal(editScheduleDraft('เลื่อนเป็นพรุ่งนี้', draft, now).action.payload.startAt, '2026-09-13T03:00:00.000Z');
assert.equal(editScheduleDraft('เปลี่ยนเป็นวันที่ 03/10/2569', draft, now).action.payload.startAt, '2026-10-03T03:00:00.000Z');
for (const text of ['เปลี่ยนเป็นวันที่ 30', 'เปลี่ยนเวลาเป็น 25:70', 'เปลี่ยนเป็น 2026-02-30 เวลา 10:00', 'เปลี่ยนเป็น 2026-09-01 เวลา 10:00', 'เปลี่ยนเป็น 1 ชั่วโมงครึ่ง', 'เปลี่ยนเป็นหลัง 19:00']) assert.ok(editScheduleDraft(text, draft, now).error, text);
// A reschedule with no time in it is still a reschedule. Returning null here
// handed "เลื่อนหน่อย" to the ordinary path, which answered with a second task.
for (const text of ['เลื่อนหน่อย', 'เลื่อน', 'ขยับหน่อยได้ไหม']) assert.ok(editScheduleDraft(text, draft, now)?.error, text);
assert.equal(editScheduleDraft('เพิ่มงานใหม่เวลา 20:00', draft, now), null);
assert.equal(editScheduleDraft('วันนี้ใช้เงินเท่าไหร่', draft, now), null);
assert.equal(editScheduleDraft('เปลี่ยนเวลาเป็น 19:00', {...draft, status: 'confirmed'}, now), null);
assert.ok(editScheduleDraft('เปลี่ยนเป็น 2026-10-03 เวลา 18:30', {...draft, payload: {...draft.payload, deadline: '2026-09-14T00:00:00Z'}}, now).error);

const receipt = {scanId: 'scan1', sourceImageHash: 'a'.repeat(64), reference: 'REF-123456', merchant: 'Store One', occurredAt: new Date('2026-09-12T03:00:00Z')};
const intersect = (a, b) => a.some((key) => b.includes(key));
const keys = receiptDedupeKeys(receipt);
assert.equal(keys.length, 3);
assert.ok(intersect(keys, receiptDedupeKeys({...receipt, scanId: 'scan2', reference: '', merchant: 'edited store'})), 'same image cannot duplicate after editing');
assert.ok(intersect(keys, receiptDedupeKeys({...receipt, scanId: 'scan2', sourceImageHash: 'b'.repeat(64)})), 'same reference recognizes re-encoded image');
assert.equal(intersect(receiptDedupeKeys({...receipt, sourceImageHash: '', reference: ''}), receiptDedupeKeys({...receipt, scanId: 'scan2', sourceImageHash: '', reference: ''})), false, 'same merchant and time alone must not discard genuine purchases');
assert.equal(intersect(keys, receiptDedupeKeys({...receipt, scanId: 'scan2', sourceImageHash: 'b'.repeat(64), merchant: 'Store Two'})), false);

const category = (merchant_name, name = 'สินค้า') => normalizeResult({merchant_name, document_type: 'receipt', grand_total: 200, items: [{name, quantity: 1, original_price: 200, final_price: 200}]}, '2026-09-12').category;
assert.equal(category('Cloud Prepay'), 'Others');
assert.equal(category('Pearl Shop'), 'Others');
assert.equal(category('PEA'), 'Utilities');
assert.equal(category('Cloud Prepay', 'เติมเกม Steam'), 'Entertainment');
assert.equal(parseReceiptDeterministic('Cloud Prepay\nRECEIPT\nสินค้า 200.00\nTOTAL 200.00\nPaid by TRUE MONEY\n12/09/2026').category, 'Others');
// A timetable cell whose end is not after its start used to be rewritten to
// "start plus one hour" for every week of the term, without a word on screen.
assert.equal(timetableHoursProblem('09:00', '12:00'), null);
assert.equal(timetableHoursProblem('09:00', '09:01'), null);
assert.ok(timetableHoursProblem('12:00', '09:00'), 'a backwards cell must be reported');
assert.ok(timetableHoursProblem('09:00', '09:00'), 'a zero-length cell must be reported');
assert.ok(timetableHoursProblem('16:00', '09:00').includes('16:00'), 'the message names the start time');
// Missing or garbled readings are already reported as missing fields; saying so
// twice on the same card is noise.
for (const [start, end] of [['', '12:00'], ['09:00', ''], ['ครึ่งบ่าย', '15:00'], ['09:00', '25:00'], ['09:00', '12:70']]) {
  assert.equal(timetableHoursProblem(start, end), null, `${start} -> ${end}`);
}
// The review screen decides "this field is filled in" with the same reader, so
// an hour the save would silently clamp is refused on the card instead.
assert.equal(clockMinutes('09:00'), 540);
assert.equal(clockMinutes(' 9.05 '), 545);
assert.equal(clockMinutes('23:59'), 1439);
for (const bad of ['', '25:00', '12:70', '9:0', 'ครึ่งบ่าย', '09:00-12:00']) assert.equal(clockMinutes(bad), null, bad);

console.log('PDF feedback regression tests passed (draft edits, deduplication, categories, timetable hours).');
