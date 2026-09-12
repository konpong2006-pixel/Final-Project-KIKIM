/**
 * What a scanned general document is saved with: the user's corrected OCR
 * text when they edited it -- even when they cleared it -- and the scan
 * otherwise.
 */
import {documentNoteText} from '../src/services/document-note-text.ts';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
};

const parsed = 'ประกาศสำนักงาน ก.พ.\nสอบภาคเช้า 09.00-12.00 น.';
const raw = 'raw OCR text';
check('no edit: the parsed document text', documentNoteText({}, parsed, raw), parsed);
check('no edit, nothing parsed: the raw OCR text', documentNoteText({}, '', raw), raw);
check('no edit, blank parsed text: the raw OCR text', documentNoteText({}, '   ', raw), raw);
check('edited: the user text, not the scan', documentNoteText({documentText: 'ข้อความที่แก้แล้ว'}, parsed, raw), 'ข้อความที่แก้แล้ว');
check('edited: surrounding whitespace trimmed', documentNoteText({documentText: '  แก้แล้ว\n'}, parsed, raw), 'แก้แล้ว');
check('cleared by the user: empty, never the scan it replaced', documentNoteText({documentText: ''}, parsed, raw), '');
check('a non-string draft value is not an edit', documentNoteText({documentText: 42}, parsed, raw), parsed);

console.log(failures ? `\n${failures} document-note check(s) FAILED` : '\ndocument note text passed: the user edit is what gets saved');
process.exit(failures ? 1 : 0);
