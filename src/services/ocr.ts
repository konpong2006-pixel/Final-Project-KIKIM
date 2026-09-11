import {getFunctions, httpsCallable} from 'firebase/functions';

import {isDemoMode} from '@/lib/demo-mode';
import {ensureAppCheckReady} from '@/lib/app-check';
import {firebaseApp} from '@/lib/firebase';
import {uploadUserImage, type UploadKind} from '@/services/storage';

export type ScanType = 'auto' | 'document' | 'receipt' | 'schedule';

export type ScanClassification = {
  confidence: number;
  scores: {receipt: number; schedule: number};
  /** `document` means readable text that is neither a receipt nor a schedule. */
  type: 'document' | 'receipt' | 'schedule';
};

export type OcrResult = {
  classification: ScanClassification;
  logId: string;
  parsed: Record<string, unknown>;
  rawText: string;
  scanType: 'document' | 'receipt' | 'schedule';
  storagePath?: string;
};

export type UploadedOcrResult = OcrResult & {
  downloadUrl: string;
  storagePath: string;
};

const functions = getFunctions(firebaseApp, 'asia-southeast1');
const analyzeScan = httpsCallable<
  {scanType: ScanType; storagePath: string},
  OcrResult
>(functions, 'analyzeScan', {
  // The Firebase default is 70 s. A scan now waits on Gemini's review --
  // until 2026-09-11 that call failed instantly, so the default was never
  // tested -- and a slow model must not make the app give up on a scan the
  // server (120 s) is still finishing.
  timeout: 115_000,
});

export type ReviewedReceiptPayload = {
  amount: number;
  category: string;
  confidence: number;
  items: {
    discountAmount: number;
    finalPrice: number;
    name: string;
    quantity: number;
    unitPrice: number;
  }[];
  merchant: string;
  occurredAt: string;
  scanId: string;
  storagePath: string;
};

const saveReviewedReceiptCall = httpsCallable<
  ReviewedReceiptPayload,
  {transactionId: string}
>(functions, 'saveReviewedReceipt');

export async function saveReviewedReceipt(payload: ReviewedReceiptPayload) {
  if (isDemoMode) return `demo-transaction-${Date.now()}`;
  await ensureAppCheckReady();
  const response = await saveReviewedReceiptCall(payload);
  return response.data.transactionId;
}

export async function uploadAndAnalyzeScan({
  contentType = 'image/jpeg',
  scanType,
  uid,
  uri,
}: {
  contentType?: string;
  scanType: ScanType;
  uid: string;
  uri: string;
}): Promise<UploadedOcrResult> {
  if (isDemoMode) {
    // `auto` resolves to `document` here on purpose: it is the honest demo of
    // what the classifier now does with a page that is neither a receipt nor a
    // timetable, which is the common case for scan-to-note. Asking for
    // `receipt` or `schedule` explicitly still demos those.
    const resolvedType: OcrResult['scanType'] = scanType === 'receipt'
      ? 'receipt'
      : scanType === 'schedule'
        ? 'schedule'
        : 'document';
    const demoDocumentText = [
      'ประกาศสำนักงาน ก.พ.',
      'เรื่อง รับสมัครสอบเพื่อวัดความรู้ความสามารถทั่วไปด้วยระบบอิเล็กทรอนิกส์',
      'ระดับ ปวช. ปวท. อนุปริญญา และปวส.',
      'สอบภาคเช้า เวลา 09.00-12.00 น.',
      'สอบภาคบ่าย เวลา 14.30-17.30 น.',
    ].join('\n');
    return {
      classification: {
        confidence: resolvedType === 'document' ? 0.81 : 0.94,
        scores: {
          receipt: resolvedType === 'receipt' ? 37 : 0,
          schedule: resolvedType === 'schedule' ? 48 : resolvedType === 'document' ? 4 : 0,
        },
        type: resolvedType,
      },
      downloadUrl: uri,
      logId: 'demo-scan',
      parsed: resolvedType === 'document'
        ? {documentText: demoDocumentText, kind: 'document', lineCount: 5}
        : resolvedType === 'receipt'
        ? {merchant: "McDonald's", total: 89, currency: 'THB', date: new Date().toISOString().slice(0, 10), time: '12:20', reference: 'DEMO12345'}
        : {
          academicYear: '2569',
          entries: [
            {courseCode: 'SC1-201', courseName: 'Data Structures', day: 'MON', room: 'อาคารเรียนรวม', section: '1', startTime: '09:00', endTime: '12:00'},
            {courseCode: '110191', courseName: 'Project in Digital Tech', day: 'TUE', room: '110191', section: '1', startTime: '13:00', endTime: '16:00'},
          ],
          semesterEnd: '2026-11-15',
          semesterStart: '2026-08-01',
        },
      rawText: resolvedType === 'document'
        ? demoDocumentText
        : resolvedType === 'receipt'
          ? "McDonald's\nTotal 89.00 THB"
          : 'SC1-201 Data Structures MON 09:00-12:00\n110191 Project in Digital Tech TUE 13:00-16:00',
      scanType: resolvedType,
      storagePath: `users/${uid}/demo/${Date.now()}.jpg`,
    };
  }
  const kind: UploadKind = scanType === 'auto' || scanType === 'document' ? 'scans' : scanType === 'receipt' ? 'receipts' : 'schedules';
  const upload = await uploadUserImage({contentType, kind, uid, uri});
  const response = await analyzeScan({scanType, storagePath: upload.path});
  return {...response.data, downloadUrl: upload.downloadUrl, storagePath: upload.path};
}
