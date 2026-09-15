import type {AssistantProposedAction} from '../types/assistant';
import {shiftDateKey, thailandDateKey, thailandTimeKey, thailandWallClockToDate} from '../lib/thailand-time.ts';

/**
 * Only edits an uncommitted draft. Ambiguous instructions never create another
 * task: they come back as an `error` the caller shows as a question, and the
 * caller must not fall through to the path that proposes new work.
 */
export function editScheduleDraft(message: string, action: AssistantProposedAction, now = new Date()): {action?: AssistantProposedAction; error?: string} | null {
  if (action.entity !== 'schedule' || action.status !== 'pending') return null;
  const text = message.trim().replace(/[๐-๙]/g, (digit) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)));
  if (/เพิ่ม(?:งาน|กิจกรรม)|งานใหม่|กิจกรรมใหม่|อีกงาน|new task/i.test(text)) return null;
  const temporal = /เวลา|วัน|พรุ่งนี้|มะรืน|นาที|ชั่วโมง|\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}/.test(text);
  const editing = /แก้|เปลี่ยน|เลื่อน|ขยับ|เอาเป็น|แทน|เป็นวันที่|change|instead/i.test(text);
  const timeOnly = /^(?:เวลา|วันที่|เป็น|เอา|ตอน|ขอ)?\s*(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}:\d{2}|วันนี้|พรุ่งนี้|มะรืน)(?:\s*(?:เวลา|ตอน)?\s*\d{1,2}:\d{2})?\s*(?:ครับ|ค่ะ|นะ|หน่อย)?$/.test(text);
  // "เลื่อน" and "ขยับ" can only mean move this draft in time, so they are an
  // edit even when no clock reading follows. Returning null for them handed
  // "เลื่อนหน่อย" to the ordinary assistant path, which answered by proposing a
  // second task -- the very complaint this function exists to fix. A vague
  // reschedule now asks back instead.
  const rescheduling = /เลื่อน|ขยับ|reschedule|move it|push (?:it )?back/i.test(text);
  if (!temporal || (!editing && !timeOnly)) {
    if (!rescheduling) return null;
    return {error: 'ยังไม่เปลี่ยนร่างเดิมนะ บอกเวลาที่ต้องการด้วย เช่น “เลื่อนเป็นพรุ่งนี้ 18:30” หรือกดแก้ไขวันที่/เวลาบนการ์ด'};
  }
  const error = 'ยังไม่เปลี่ยนร่างเดิมนะ กรุณาระบุ เช่น “เปลี่ยนเป็น 2026-10-03 เวลา 18:30 นาน 60 นาที” หรือกดแก้ไขวันที่/เวลาบนการ์ด';
  if (action.payload.generatedForTimeZone && action.payload.generatedForTimeZone !== 'Asia/Bangkok') return {error};
  if (/ไม่เอา|ไม่ใช่|หลัง|ก่อน|ประมาณ|หรือ/.test(text)) return {error};
  let dateKey = thailandDateKey(action.payload.startAt);
  let timeKey = thailandTimeKey(action.payload.startAt);
  let changed = false;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  const dmy = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (iso || dmy) {
    let year = Number(iso?.[1] ?? dmy?.[3]);
    if (year < 100) year += year >= 40 ? 2500 : 2000;
    if (year > 2400) year -= 543;
    dateKey = `${year}-${String(iso?.[2] ?? dmy?.[2]).padStart(2, '0')}-${String(iso?.[3] ?? dmy?.[1]).padStart(2, '0')}`;
    changed = true;
  } else if (/วันนี้|พรุ่งนี้|มะรืน/.test(text)) {
    dateKey = shiftDateKey(thailandDateKey(now), /มะรืน/.test(text) ? 2 : /พรุ่งนี้/.test(text) ? 1 : 0);
    changed = true;
  } else if (/วัน|\d{1,2}\/\d{1,2}|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|[ก-๙]{1,2}\.[ก-๙]\./.test(text)) return {error};
  const clock = text.match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/);
  if ((text.match(/\d{1,2}:\d{2}/g) ?? []).length > 1) return {error};
  if (clock) {
    if (Number(clock[1]) > 23 || Number(clock[2]) > 59) return {error};
    timeKey = `${clock[1].padStart(2, '0')}:${clock[2]}`;
    changed = true;
  } else if (/เวลา|ตอน/.test(text) && !/ระยะเวลา/.test(text)) return {error};
  const duration = text.match(/(\d+(?:\.\d+)?)\s*(นาที|ชั่วโมง)/);
  const minutes = duration ? Number(duration[1]) * (duration[2] === 'ชั่วโมง' ? 60 : 1)
    : action.payload.estimatedDurationMinutes ?? Math.round((new Date(action.payload.endAt ?? action.payload.startAt).getTime() - new Date(action.payload.startAt).getTime()) / 60000);
  if (duration) changed = true;
  if (!changed || /ครึ่ง/.test(text) || !Number.isInteger(minutes) || minutes < 15 || minutes > 720) return {error};
  const start = thailandWallClockToDate(dateKey, timeKey);
  if (!Number.isFinite(start.getTime()) || thailandDateKey(start) !== dateKey) return {error};
  if (start.getTime() < now.getTime() + 300000) return {error: 'กรุณาเลือกเวลาในอนาคตอย่างน้อย 5 นาที ร่างเดิมยังไม่ถูกเปลี่ยน'};
  const end = new Date(start.getTime() + minutes * 60000);
  if (action.payload.deadline && end.getTime() > new Date(action.payload.deadline).getTime()) return {error: 'เวลาที่เลือกเลยกำหนดส่งของงานเดิม กรุณาตรวจวันและกำหนดส่งก่อน ร่างยังไม่ถูกบันทึก'};
  return {action: {...action, summary: `ปรับเวลาร่างเดิม “${action.payload.title}” เป็น ${dateKey} ${timeKey} (${minutes} นาที)`, payload: {...action.payload, dateLocked: true, startAt: start.toISOString(), endAt: end.toISOString(), estimatedDurationMinutes: minutes, generatedForTimeZone: 'Asia/Bangkok', userSelectedTime: true}}};
}
