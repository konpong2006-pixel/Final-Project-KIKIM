import {getFunctions, httpsCallable} from 'firebase/functions';

import {isDemoMode} from '@/lib/demo-mode';
import {ensureAppCheckReady} from '@/lib/app-check';
import {firebaseApp} from '@/lib/firebase';
import {uploadUserImage, type UploadKind} from '@/services/storage';

export type ScanType = 'auto' | 'receipt' | 'schedule';

export type ScanClassification = {
  confidence: number;
  scores: {receipt: number; schedule: number};
  type: 'receipt' | 'schedule';
};

export type OcrResult = {
  classification: ScanClassification;
  logId: string;
  parsed: Record<string, unknown>;
  rawText: string;
  scanType: 'receipt' | 'schedule';
  storagePath?: string;
};

export type UploadedOcrResult = OcrResult & {
  downloadUrl: string;
  storagePath: string;
};

const functions = getFunctions(firebaseApp, 'asia-southeast1');
const analyzeScan = httpsCallable<
  {scanType: ScanType; sourceImageHash: string; storagePath: string},
  OcrResult
>(functions, 'analyzeScan');

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
  reference?: string;
  scanId: string;
  storagePath: string;
};

const saveReviewedReceiptCall = httpsCallable<
  ReviewedReceiptPayload,
  {duplicate: boolean; transactionId: string}
>(functions, 'saveReviewedReceipt');

export async function saveReviewedReceipt(payload: ReviewedReceiptPayload) {
  if (isDemoMode) return {duplicate: false, transactionId: `demo-transaction-${Date.now()}`};
  await ensureAppCheckReady();
  const response = await saveReviewedReceiptCall(payload);
  return response.data;
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
    const resolvedType: OcrResult['scanType'] = scanType === 'receipt' ? 'receipt' : 'schedule';
    return {
      classification: {
        confidence: 0.94,
        scores: {receipt: resolvedType === 'receipt' ? 8 : 2, schedule: resolvedType === 'schedule' ? 8 : 2},
        type: resolvedType,
      },
      downloadUrl: uri,
      logId: 'demo-scan',
      parsed: resolvedType === 'receipt'
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
      rawText: resolvedType === 'receipt' ? "McDonald's\nTotal 89.00 THB" : 'SC1-201 Data Structures MON 09:00-12:00\n110191 Project in Digital Tech TUE 13:00-16:00',
      scanType: resolvedType,
      storagePath: `users/${uid}/demo/${Date.now()}.jpg`,
    };
  }
  const kind: UploadKind = scanType === 'auto' ? 'scans' : scanType === 'receipt' ? 'receipts' : 'schedules';
  const upload = await uploadUserImage({contentType, kind, uid, uri});
  const response = await analyzeScan({
    scanType,
    sourceImageHash: upload.imageHash,
    storagePath: upload.path,
  });
  return {...response.data, downloadUrl: upload.downloadUrl, storagePath: upload.path};
}
