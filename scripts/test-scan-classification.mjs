/**
 * Guards the scan classifier's three-way decision.
 *
 * The bug this pins down: `ScanClassification.type` used to be a two-way
 * union, and `schedule > receipt` is false when both scores are zero, so a
 * document with no financial evidence whatsoever fell through to "receipt" and
 * was force-fitted into receipt fields -- a merchant name of "กิจกรรม", line
 * items priced at zero. Confidence made it worse by measuring only the margin
 * between the two categories, so 4 points against 0 reported 0.99.
 *
 * Most of these cases therefore assert the negative direction: ordinary
 * documents must classify as `document`, and must not borrow confidence they
 * have not earned.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {classifyScanText, detectAccountStatement, scheduleStructure} from '../functions/src/receipt-parsers/deterministic-receipt.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -> ${detail}` : ''}`);
};

const join = (...lines) => lines.join('\n');

// --- must be `document`: readable text that is neither receipt nor schedule --
const documents = {
  'civil-service exam announcement (the reported bug)': join(
    'ประกาศสำนักงาน ก.พ.',
    'เรื่อง รับสมัครสอบเพื่อวัดความรู้ความสามารถทั่วไปด้วยระบบอิเล็กทรอนิกส์',
    'ระดับ ปวช. ปวท. อนุปริญญา และปวส.',
    'สอบภาคเช้า เวลา 09.00-12.00 น.',
    'สอบภาคบ่าย เวลา 14.30-17.30 น.',
    'กิจกรรม',
  ),
  'meeting minutes': join(
    'บันทึกการประชุม',
    'วันที่ 8 กันยายน 2569',
    'ผู้เข้าร่วมประชุม 12 คน',
    'วาระที่ 1 เรื่องแจ้งเพื่อทราบ',
  ),
  'lecture notes': join(
    'บทที่ 4 Linked List',
    'โครงสร้างข้อมูลแบบเชื่อมโยง',
    'การแทรกและการลบมีความซับซ้อน O(1)',
  ),
  'english notice mentioning weekdays': join(
    'NOTICE TO ALL STUDENTS',
    'The library will be closed for maintenance',
    'from Monday to Friday next week.',
  ),
  'near-empty page': 'หน้าเปล่า',
  'a letter with a single baht amount': join(
    'เรียน ผู้ปกครอง',
    'ขอแจ้งค่าใช้จ่ายกิจกรรมจำนวน 500 บาท',
    'จึงเรียนมาเพื่อทราบ',
  ),
};
for (const [name, text] of Object.entries(documents)) {
  const result = classifyScanText(text);
  check(`${name} -> document`, result.type === 'document',
    `got ${result.type} (receipt:${result.scores.receipt} schedule:${result.scores.schedule})`);
}

// --- bank transfer slips: keyword scoring alone cannot reach these ---------
// A real Kasikorn slip scored 6 against a bar of 10 and fell to `document`.
// The deterministic layer is not expected to classify these correctly; what it
// must do is admit it is unsure, so the Gemini layer is consulted.
const transferSlips = {
  'Kasikorn K PLUS transfer slip': join(
    'K PLUS', 'โอนเงินสำเร็จ', '10 ก.ย. 2569  14:32 น.',
    'จาก นาย ณรงค์ชัย ท่าทอง', 'xxx-x-x1234-x',
    'ไปยัง ธ.กรุงเทพ', 'นางสาว สมหญิง ใจดี', 'xxx-x-x5678-x',
    'จำนวน 1,500.00 บาท',
  ),
};
for (const [name, text] of Object.entries(transferSlips)) {
  const result = classifyScanText(text);
  check(`${name} is NOT claimed with certainty by keywords`, result.certain === false,
    `certain=${result.certain} type=${result.type}`);
}

// --- must still be `receipt` -----------------------------------------------
const receipts = {
  'shop receipt with tax invoice header': join(
    'ใบเสร็จรับเงิน / TAX INVOICE',
    "McDonald's สาขาเซ็นทรัล",
    'TAX ID 0105536000123',
    'Big Mac x1  129.00',
    'ยอดรวม 129.00',
    'ยอดชำระ 129.00 บาท',
    'VAT 7% INCLUDED',
  ),
  'wallet payment slip': join(
    'ทำรายการสำเร็จ',
    'เป๋าตัง',
    'จำนวนเงินที่ชำระ 250.00 บาท',
    'รหัสอ้างอิง 123456789',
  ),
  'promptpay transfer slip': join(
    'โอนเงินสำเร็จ',
    'พร้อมเพย์ PROMPTPAY',
    'จำนวนเงินที่โอน 1,200.00 บาท',
    'ผู้รับเงิน นายสมชาย',
    'ยอดชำระ 1,200.00',
  ),
};
for (const [name, text] of Object.entries(receipts)) {
  const result = classifyScanText(text);
  check(`${name} -> receipt`, result.type === 'receipt',
    `got ${result.type} (receipt:${result.scores.receipt} schedule:${result.scores.schedule})`);
}

// --- must still be `schedule` ----------------------------------------------
const schedules = {
  'university timetable': join(
    'ตารางเรียน ปีการศึกษา 2569',
    'รหัสวิชา 110191 ชื่อรายวิชา Project in Digital Tech',
    'จันทร์ 09:00-12:00 ห้องเรียน 401',
    'อังคาร 13:00-16:00 SECTION 1',
  ),
  'exam timetable': join(
    'ตารางสอบ ภาคการศึกษาที่ 1',
    'รหัสวิชา 110191',
    'พุธ 09:00-12:00',
    'ศุกร์ 13:00-16:00',
  ),
  'weekday-dense timetable without a header': join(
    'จันทร์ 09:00-12:00 คณิตศาสตร์',
    'อังคาร 13:00-16:00 ฟิสิกส์',
    'พุธ 09:00-12:00 เคมี',
    'พฤหัสบดี 13:00-16:00 ชีววิทยา',
  ),
};
for (const [name, text] of Object.entries(schedules)) {
  const result = classifyScanText(text);
  check(`${name} -> schedule`, result.type === 'schedule',
    `got ${result.type} (receipt:${result.scores.receipt} schedule:${result.scores.schedule})`);
}

// --- passbooks and statements: many transactions, so a document ------------
// These carry amounts, dates and bank vocabulary, so every receipt signal
// argues for "receipt" -- and so did the model. Run through the single-receipt
// extractor a passbook came back as merchant "ธนาคารกสิกรไทย", no total, its
// rows as line items, and then could not be saved. They must be a certain
// document, so the model is never asked.
const statements = {
  'Kasikorn passbook page (the reported bug)': join(
    'ธนาคารกสิกรไทย', 'สมุดบัญชีเงินฝากออมทรัพย์', 'ชื่อบัญชี นาย ณรงค์ชัย ท่าทอง', 'เลขที่บัญชี 123-4-56789-0',
    'วันที่ รายการ ถอน ฝาก คงเหลือ',
    '01/08/69 ยอดยกมา 12,450.00',
    '03/08/69 ATM 1,000.00 11,450.00',
    '05/08/69 โอนเงิน 500.00 10,950.00',
    '10/08/69 เงินเดือน 15,000.00 25,950.00',
    '12/08/69 ชำระบิล 2,340.00 23,610.00',
  ),
  'English account statement': join(
    'BANGKOK BANK', 'STATEMENT OF ACCOUNT', 'Account No. 123-4-56789-0',
    'DATE DESCRIPTION WITHDRAWAL DEPOSIT BALANCE',
    '01/08/2026 BALANCE B/F 12,450.00',
    '03/08/2026 ATM WITHDRAWAL 1,000.00 11,450.00',
    '05/08/2026 TRANSFER 500.00 10,950.00',
    '10/08/2026 SALARY 15,000.00 25,950.00',
  ),
  'passbook with Thai month dates and no header': join(
    '1 ส.ค. 69 ยกมา 3,200.00',
    '4 ส.ค. 69 ถอน 200.00 3,000.00',
    '9 ส.ค. 69 ฝาก 1,500.00 4,500.00',
    '15 ส.ค. 69 ถอน 750.00 3,750.00',
  ),
};
for (const [name, text] of Object.entries(statements)) {
  const result = classifyScanText(text);
  check(`${name} -> document`, result.type === 'document',
    `got ${result.type} (receipt:${result.scores.receipt} schedule:${result.scores.schedule})`);
  check(`${name} is certain, so the model is not asked`, result.certain === true, `certain=${result.certain}`);
  check(`${name} is detected as a statement`, detectAccountStatement(text) === true);
}

// ...and a single transaction must not be mistaken for one.
const singleTransactions = {
  'shop receipt': receipts['shop receipt with tax invoice header'],
  'wallet slip': receipts['wallet payment slip'],
  'Kasikorn transfer slip': transferSlips['Kasikorn K PLUS transfer slip'],
  'receipt with a dated header and several items': join(
    'ใบเสร็จรับเงิน', '12/08/2026 14:30', 'ข้าวผัด 60.00', 'ชาเย็น 35.00', 'น้ำเปล่า 10.00', 'ยอดรวม 105.00',
  ),
};
for (const [name, text] of Object.entries(singleTransactions)) {
  check(`${name} is NOT a statement`, detectAccountStatement(text) === false);
}
check('the receipt with dated header and items is still a receipt',
  classifyScanText(singleTransactions['receipt with a dated header and several items']).type === 'receipt');

// --- real timetables have structure, and often no heading at all -----------
// A grid rarely prints "ตารางเรียน" and abbreviates its days, so counting
// phrases called these plain documents. And the text the server actually
// classifies is iApp's and Vision's transcripts concatenated.
const gridSchedules = {
  'grid with Thai day abbreviations and no heading': join(
    'เวลา 8.00 9.00 10.00 11.00 12.00 13.00 14.00 15.00 16.00',
    'จ. ACC315-68 Sec 01 ห้อง 410 RSU243-67 Sec 02 ห้อง 305',
    'อ. DMR209-64 Sec 01 ห้อง 412',
    'พ. DMR404-64 Sec 01 ห้อง 410',
    'พฤ. DMR303-64 Sec 01 ENL128-67 Sec 05',
    'ศ. DMR202-64 Sec 01',
  ),
  'grid with English day abbreviations and no Day/Time heading': join(
    'Semester 1/2025',
    'MON ACC315-68 Sec: 01 410 08:00-11:00 RSU243-67 Sec: 02 305 13:00-16:00',
    'TUE DMR209-64 Sec: 01 412 09:00-12:00',
    'WED DMR404-64 Sec: 01 410 13:00-16:00',
    'THU DMR303-64 Sec: 01 410 08:00-11:00',
    'FRI DMR202-64 Sec: 01 411 09:00-12:00',
  ),
  'fused iApp + Vision text, as the server classifies it': join(
    '--- iApp OCR ---', 'MON ACC315-68 RSU243-67', 'TUE DMR209-64', 'WED DMR404-64', 'THU DMR303-64 ENL128-67', 'FRI DMR202-64',
    '--- Google Vision OCR ---', 'MON', 'ACC315-68', 'Sec: 01', '410', '08:00-11:00', 'TUE', 'DMR209-64', 'Sec: 01',
  ),
};
for (const [name, text] of Object.entries(gridSchedules)) {
  const result = classifyScanText(text);
  check(`${name} -> schedule`, result.type === 'schedule',
    `got ${result.type} (receipt:${result.scores.receipt} schedule:${result.scores.schedule})`);
  check(`${name} is certain, so it never depends on the model`, result.certain === true, `certain=${result.certain}`);
}

// --- ...and documents that talk about school are not timetables --------------
// These used to come out `schedule` with certainty -- "ปีการศึกษา" was one of
// the unmistakable anchors -- so the model was never asked to overrule them.
const schoolDocuments = {
  'tuition fee notice mentioning ปีการศึกษา': join(
    'ประกาศมหาวิทยาลัย', 'เรื่อง การชำระค่าธรรมเนียมการศึกษา', 'ภาคการศึกษาที่ 1 ปีการศึกษา 2569',
    'นักศึกษาชำระได้ตั้งแต่วันจันทร์ถึงวันศุกร์', 'เวลา 08:30-16:30 น.',
  ),
  'academic calendar': join(
    'ปฏิทินการศึกษา ปีการศึกษา 2569', 'ภาคการศึกษาที่ 1',
    'วันเปิดภาคเรียน 10 ส.ค. 2569', 'สอบกลางภาค 28 ก.ย. - 4 ต.ค. 2569', 'สอบปลายภาค 23 พ.ย. - 4 ธ.ค. 2569',
  ),
  'shop opening hours': join(
    'ร้านกาแฟ บ้านสวน', 'เปิดวันจันทร์ อังคาร พุธ พฤหัสบดี ศุกร์', 'เวลา 07:00-18:00', 'หยุดวันเสาร์ อาทิตย์',
  ),
  'a letter dated in พ.ศ. (abbreviations must not read as days)': join(
    'เรียน ผู้ปกครอง', 'ลงวันที่ 5 ส.ค. พ.ศ. 2569', 'อ.เมือง จ.เชียงใหม่', 'จึงเรียนมาเพื่อทราบ',
  ),
};
for (const [name, text] of Object.entries(schoolDocuments)) {
  const result = classifyScanText(text);
  check(`${name} -> document`, result.type === 'document',
    `got ${result.type} (receipt:${result.scores.receipt} schedule:${result.scores.schedule})`);
  check(`${name} is not a certain schedule`, !(result.type === 'schedule' && result.certain));
}
check('"พ.ศ.", "ส.ค.", "อ.เมือง" and "จ.เชียงใหม่" contribute no weekdays',
  scheduleStructure(schoolDocuments['a letter dated in พ.ศ. (abbreviations must not read as days)']).dayCount === 0,
  `dayCount=${scheduleStructure(schoolDocuments['a letter dated in พ.ศ. (abbreviations must not read as days)']).dayCount}`);

// Two lines of opening hours pair days with times, but that is not proof.
const hours = classifyScanText(join('คลินิกทันตกรรม', 'จันทร์-ศุกร์ 08:00-17:00', 'เสาร์-อาทิตย์ 09:00-12:00'));
check('two lines of opening hours are not a certain schedule', !(hours.type === 'schedule' && hours.certain),
  `type=${hours.type} certain=${hours.certain}`);

// --- the same, on OCR text real scans produced -----------------------------
// Hand-typed fixtures keep one row per line, and the first statement detector
// passed all of them while failing on every real passbook: table OCR puts
// each cell on its own line. These are what analyzeScan actually stored for
// rendered documents run through iApp, Google Vision and the fusion step.
const REAL = JSON.parse(fs.readFileSync(new URL('./fixtures/scan-ocr-real.json', import.meta.url), 'utf8'));
const realExpect = {
  passbookCellPerLine: {statement: true, type: 'document', certain: true},
  passbookForcedReceiptPath: {statement: true},
  receiptThreeTranscripts: {statement: false, type: 'receipt'},
  transferSlip: {statement: false},
  academicCalendar: {statement: false, type: 'document'},
  feeNotice: {statement: false, type: 'document'},
  timetableFused: {statement: false, type: 'schedule', certain: true},
  gridThaiAbbrevNoHeading: {statement: false, type: 'schedule'},
};
for (const [key, want] of Object.entries(realExpect)) {
  const text = REAL[key];
  check(`real OCR fixture "${key}" exists`, typeof text === 'string' && text.length > 50);
  if (typeof text !== 'string') continue;
  check(`real ${key}: statement=${want.statement}`, detectAccountStatement(text) === want.statement);
  const result = classifyScanText(text);
  if (want.type) check(`real ${key} -> ${want.type}`, result.type === want.type,
    `got ${result.type} (receipt:${result.scores.receipt} schedule:${result.scores.schedule})`);
  if (want.certain !== undefined) check(`real ${key}: certain=${want.certain}`, result.certain === want.certain, `certain=${result.certain}`);
}
check('the calendar is never a certain schedule, even when the model is down',
  !(classifyScanText(REAL.academicCalendar).type === 'schedule' && classifyScanText(REAL.academicCalendar).certain));

// --- the certainty flag gates the second opinion ---------------------------
// Anchored documents skip the model call entirely; everything else is offered
// to it. Getting this wrong either costs a Gemini call on every scan or lets
// the keyword guess stand unchallenged.
check('an anchored receipt is certain (skips the model call)',
  classifyScanText(receipts['shop receipt with tax invoice header']).certain === true);
check('an anchored timetable is certain (skips the model call)',
  classifyScanText(schedules['university timetable']).certain === true);
check('a general document is never certain (always offered to the model)',
  classifyScanText(documents['meeting minutes']).certain === false);

// --- confidence must track evidence, not just the margin --------------------
const weak = classifyScanText(join('NOTICE', 'Monday to Friday', 'library closed'));
check('a weak document does not claim near-certainty as receipt/schedule',
  weak.type === 'document', `got ${weak.type}`);

const strongReceipt = classifyScanText(receipts['shop receipt with tax invoice header']);
check('a real receipt still reports high confidence', strongReceipt.confidence >= 0.9,
  String(strongReceipt.confidence));

const blank = classifyScanText('หน้าเปล่า');
check('a blank page is confidently "not structured"', blank.confidence >= 0.9,
  String(blank.confidence));

// Every type must be one of the three, and confidence a sane probability.
for (const text of [...Object.values(documents), ...Object.values(receipts), ...Object.values(schedules)]) {
  const result = classifyScanText(text);
  if (!['document', 'receipt', 'schedule'].includes(result.type)) { failures += 1; console.log('FAIL unknown type', result.type); }
  if (!(result.confidence > 0 && result.confidence <= 1)) { failures += 1; console.log('FAIL confidence out of range', result.confidence); }
}

if (failures) {
  console.error(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log('\nscan classification passed: general documents are no longer forced into a receipt');
assert.equal(failures, 0);
