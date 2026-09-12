import type {AssistantErrorKind} from '../types/assistant';

function errorText(error: unknown) {
  const code = String((error as {code?: unknown})?.code ?? '').toLowerCase();
  const message = String((error as {message?: unknown})?.message ?? '').toLowerCase();
  const details = JSON.stringify((error as {details?: unknown})?.details ?? '').toLowerCase();
  return `${code} ${message} ${details}`;
}

export function classifyAssistantError(error: unknown): AssistantErrorKind {
  const text = errorText(error);
  if (/app.?check|play integrity|native-module-missing|rnfbappmodule/.test(text)) return 'app_check';
  if (/permission-denied|insufficient permissions|forbidden|http.?403|storage\/(?:unauthorized|unauthenticated)/.test(text)) return 'permission';
  if (/unauthenticated|id.?token.*(?:expired|invalid|revoked)|user-token-expired|auth\/user-disabled|auth\/user-not-found/.test(text)) {
    return 'authentication';
  }
  if (/invalid-argument|missing required|is required|failed-precondition/.test(text)) return 'missing_input';
  if (/resource-exhausted|quota|http.?429|rate.?limit/.test(text)) return 'quota';
  if (/gemini-service|gemini-model|model-not-found|gemini|empty response|model response/.test(text)) return 'gemini';
  if (/network|unavailable|deadline-exceeded|timeout|fetch failed|offline/.test(text)) return 'network';
  if (/data-loss|invalid (?:database|model|json|response)|malformed|parse/.test(text)) return 'invalid_data';
  if (/internal|http.?5\d\d|server error|functions\/internal/.test(text)) return 'server';
  if (/firestore|firebase|functions\//.test(text)) return 'firebase';
  return 'unknown';
}

export function assistantErrorMessage(kind: AssistantErrorKind) {
  if (kind === 'app_check') return 'ระบบยืนยัน SmartLife ยังไม่พร้อมครับ หากใช้เว็บให้รีเฟรชหน้า หรือหากใช้แอปให้เปิด SmartLife build ล่าสุดแล้วลองอีกครั้ง';
  if (kind === 'authentication') return 'ระบบยืนยันตัวตนกับบริการ AI ไม่สำเร็จชั่วคราวครับ ลองอีกครั้งหรือเปิดแอปใหม่ได้เลย โดยข้อความที่ส่งมายังอยู่ในแชท';
  if (kind === 'permission') return 'ตอนนี้บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลส่วนที่ถามครับ ข้อมูลส่วนอื่นยังไม่ถูกลบหรือแก้ไข';
  if (kind === 'quota') return 'บริการ AI ถึงขีดจำกัดชั่วคราวครับ รอสักครู่แล้วลองใหม่ได้ โดยคำถามที่คำนวณจากตัวเลขในข้อความยังตอบต่อได้';
  if (kind === 'network') return 'ตอนนี้เชื่อมต่อบริการไม่สำเร็จครับ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
  if (kind === 'gemini') return 'Gemini ตอบกลับไม่สมบูรณ์ครับ ลองส่งคำถามเดิมอีกครั้งได้เลย';
  if (kind === 'invalid_data') return 'ข้อมูลที่ได้รับกลับมาไม่สมบูรณ์ จึงยังยืนยันคำตอบส่วนนี้ไม่ได้ครับ';
  if (kind === 'missing_input') return 'ยังขาดข้อมูลสำคัญสำหรับคำขอนี้ครับ';
  if (kind === 'server') return 'บริการ SmartLife ขัดข้องชั่วคราวครับ ลองใหม่อีกครั้งได้เลย';
  if (kind === 'firebase') return 'ตอนนี้อ่านข้อมูลจาก Firebase ไม่สำเร็จครับ กรุณาลองใหม่อีกครั้ง';
  if (kind === 'unsupported') return 'คำขอนี้ยังอยู่นอกความสามารถที่ SmartLife รองรับครับ';
  return 'ตอนนี้ AI ตอบคำถามนี้ไม่สำเร็จครับ กรุณาลองอีกครั้ง';
}

export function assistantActionErrorMessage(error: unknown) {
  const code = String((error as {code?: unknown})?.code ?? '').toLowerCase();
  const rawMessage = String((error as {message?: unknown})?.message ?? '').trim();
  const actionableCode = /(?:failed-precondition|invalid-argument|already-exists|aborted|not-found)/.test(code);
  const cleanedMessage = rawMessage
    .replace(/^firebaseerror:\s*/i, '')
    .replace(/^\[?functions\/(?:failed-precondition|invalid-argument|already-exists|aborted|not-found)\]?\s*:?\s*/i, '')
    .trim();
  if (actionableCode && /[\u0e00-\u0e7f]/.test(cleanedMessage)) return cleanedMessage;

  const kind = classifyAssistantError(error);
  if (kind !== 'unknown') return assistantErrorMessage(kind);
  return 'ยังบันทึกไม่สำเร็จ ข้อมูลเดิมยังไม่เปลี่ยน กรุณาลองอีกครั้งได้เลย';
}
