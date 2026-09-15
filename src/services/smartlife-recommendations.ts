import {activities, notes, schedules} from '@/services/firestore';
import {getFunctions, httpsCallable} from 'firebase/functions';
import {ensureAppCheckReady} from '@/lib/app-check';
import {auth, firebaseApp} from '@/lib/firebase';
import {isDemoMode} from '@/lib/demo-mode';
import {withAssistantAuthRetry} from '@/services/assistant-auth-retry';
import type {Activity, ActivityType, Note, NoteCategory, Schedule, WithId} from '@/types/smartlife';

import {thailandDayStart, thailandTimeKey, thailandAtHour} from '@/lib/thailand-time';
import {futureSuggestion} from '@/lib/ux-time';

type TimeValue = Date | string | number | {seconds?: number; toDate?: () => Date; toMillis?: () => number} | null | undefined;

type BusyBlock = {
  end: Date;
  source: 'activity' | 'schedule';
  start: Date;
  title: string;
};

type FreeSlot = {
  end: Date;
  minutes: number;
  start: Date;
};

export type ActivitySuggestion = {
  detail: string;
  endAt: string;
  location: string;
  note: string;
  priority: 'low' | 'normal' | 'high' | 'important' | 'urgent';
  reasons: string[];
  score: number;
  startAt: string;
  time: string;
  title: string;
  type: ActivityType;
};

export type NoteSuggestion = {
  category: NoteCategory;
  content: string;
  detail: string;
  reasons: string[];
  score: number;
  title: string;
};

type RecommendationKind = 'activity' | 'note';
type EnhancedRecommendation = {content?: string; detail?: string; index: number; note?: string; reasons?: string[]; title?: string};
const recommendationFunctions = getFunctions(firebaseApp, 'asia-southeast1');
const enhanceRecommendationsCall = httpsCallable<
  {candidates: (ActivitySuggestion | NoteSuggestion)[]; kind: RecommendationKind},
  {items: EnhancedRecommendation[]}
>(recommendationFunctions, 'enhanceSmartLifeRecommendations');
const recommendationCache = new Map<string, {expiresAt: number; value: (ActivitySuggestion | NoteSuggestion)[]}>();

async function enhanceRecommendations<T extends ActivitySuggestion | NoteSuggestion>(uid: string, kind: RecommendationKind, candidates: T[]) {
  if (isDemoMode || !candidates.length) return candidates;
  const fingerprint = JSON.stringify(candidates);
  const cacheKey = `${uid}:${kind}:${fingerprint}`;
  const cached = recommendationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value.filter(item => !('startAt' in item) || futureSuggestion(item)) as T[];
  try {
    await ensureAppCheckReady();
    const result = await withAssistantAuthRetry(
      () => enhanceRecommendationsCall({candidates, kind}),
      {
        expectedUid: uid,
        getCurrentUid: () => auth.currentUser?.uid,
        refreshToken: () => auth.currentUser?.getIdToken(true) ?? Promise.reject(new Error('No authenticated user.')),
      },
    );
    const enhancements = Array.isArray(result.data.items) ? result.data.items : [];
    const merged = candidates.map((candidate, index) => {
      const enhanced = enhancements.find((item) => item.index === index);
      if (!enhanced) return candidate;
      return {
        ...candidate,
        ...(kind === 'note' && enhanced.title?.trim() ? {title: enhanced.title.trim()} : {}),
        ...(enhanced.detail?.trim() ? {detail: enhanced.detail.trim()} : {}),
        ...(enhanced.reasons?.length ? {reasons: enhanced.reasons.filter(Boolean).slice(0, 3)} : {}),
        ...('note' in candidate && enhanced.note?.trim() ? {note: enhanced.note.trim()} : {}),
        ...('content' in candidate && enhanced.content?.trim() ? {content: enhanced.content.trim()} : {}),
      } as T;
    });
    recommendationCache.set(cacheKey, {expiresAt: Date.now() + 2 * 60_000, value: merged});
    return merged.filter(item => !('startAt' in item) || futureSuggestion(item));
  } catch {
    // Recommendations remain usable from the deterministic, conflict-safe engine
    // while App Check, connectivity, quota, or Gemini is temporarily unavailable.
    return candidates.filter(item => !('startAt' in item) || futureSuggestion(item));
  }
}

const urgentWords = ['quiz', 'ควิซ', 'สอบ', 'ส่ง', 'deadline', 'project', 'โปรเจค', 'รายงาน', 'lab', 'แลบ'];
const studyWords = ['เรียน', 'สอบ', 'ควิซ', 'quiz', 'lab', 'แลบ', 'assignment', 'homework', 'การบ้าน', 'รายงาน'];
const workWords = ['งาน', 'task', 'todo', 'นัด', 'ประชุม', 'ส่งงาน', 'โปรเจค', 'project'];
const academicDeadlineWords = [
  'สอบ', 'สอบกลางภาค', 'สอบปลายภาค', 'ควิซ', 'แบบทดสอบ', 'ส่งงาน', 'กำหนดส่ง',
  'การบ้าน', 'exam', 'midterm', 'final', 'quiz', 'assignment', 'homework', 'deadline', 'due',
];

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function recommendationLevel(score: number) {
  if (score >= 85) return 'ด่วนมาก';
  if (score >= 70) return 'สำคัญ';
  if (score >= 55) return 'ควรทำ';
  if (score >= 40) return 'ว่างพอดี';
  return 'สำรอง';
}

function toDate(value: TimeValue) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis());
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
}

function startOfDay(date: Date, offsetDays = 0) {
  return thailandDayStart(date, offsetDays);
}

function endOfDay(date: Date, offsetDays = 0) {
  return new Date(startOfDay(date, offsetDays + 1).getTime() - 1);
}

function activeWindow(date: Date) {
  return {start: thailandAtHour(date, 8), end: thailandAtHour(date, 22)};
}

function formatTime(date: Date) { return thailandTimeKey(date); }

function formatTimeRange(start: Date, end: Date) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function normalizeText(...values: unknown[]) {
  return values.filter(Boolean).join(' ').toLowerCase();
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word.toLowerCase()));
}

function minutesUntil(date: Date, now: Date) {
  return Math.round((date.getTime() - now.getTime()) / 60000);
}

function itemDates(item: {endAt?: TimeValue; startAt?: TimeValue}) {
  const start = toDate(item.startAt);
  const end = toDate(item.endAt);
  if (!start) return null;
  return {end: end && end > start ? end : new Date(start.getTime() + 60 * 60000), start};
}

function buildBusyBlocks(scheduleItems: WithId<Schedule>[], activityItems: WithId<Activity>[]) {
  const blocks: BusyBlock[] = [];
  scheduleItems.forEach((item) => {
    const dates = itemDates(item);
    if (dates) blocks.push({source: 'schedule', title: item.title, ...dates});
  });
  activityItems.forEach((item) => {
    const dates = itemDates(item);
    if (dates && item.status !== 'cancelled') blocks.push({source: 'activity', title: item.title, ...dates});
  });
  return blocks.sort((first, second) => first.start.getTime() - second.start.getTime());
}

function findFreeSlots(blocks: BusyBlock[], day: Date, minMinutes = 30, now = new Date()) {
  const window = activeWindow(day);
  const slots: FreeSlot[] = [];
  // Leave a full minute to act; discard expired portions before fitting duration.
  let cursor = new Date(Math.max(window.start.getTime(), Math.ceil((now.getTime() + 60000) / 60000) * 60000));
  blocks
    .filter((block) => block.end > window.start && block.start < window.end)
    .forEach((block) => {
      const blockStart = new Date(Math.max(block.start.getTime(), window.start.getTime()));
      const blockEnd = new Date(Math.min(block.end.getTime(), window.end.getTime()));
      if (blockStart.getTime() - cursor.getTime() >= minMinutes * 60000) {
        slots.push({end: blockStart, minutes: Math.round((blockStart.getTime() - cursor.getTime()) / 60000), start: new Date(cursor)});
      }
      if (blockEnd > cursor) cursor = blockEnd;
    });
  if (window.end.getTime() - cursor.getTime() >= minMinutes * 60000) {
    slots.push({end: window.end, minutes: Math.round((window.end.getTime() - cursor.getTime()) / 60000), start: new Date(cursor)});
  }
  return slots;
}

function fitSlot(slot: FreeSlot, preferredMinutes: number) {
  const minutes = Math.min(slot.minutes, preferredMinutes);
  return {end: new Date(slot.start.getTime() + minutes * 60000), start: slot.start};
}

function scoreTask(item: WithId<Activity>, now: Date) {
  const dates = itemDates(item);
  const text = normalizeText(item.title, item.note, item.category, item.location);
  let score = 22;
  const reasons: string[] = [];

  if (item.priority === 'urgent') { score += 35; reasons.push('ผู้ใช้เลือกด่วน'); }
  else if (item.priority === 'high' || item.priority === 'important') { score += 25; reasons.push('ผู้ใช้เลือกสำคัญ'); }
  else if (item.priority === 'normal') score += 10;

  if (dates) {
    const minutes = minutesUntil(dates.start, now);
    if (minutes <= 0) { score += 30; reasons.push('ถึงกำหนดแล้ว'); }
    else if (minutes <= 180) { score += 35; reasons.push('เหลือน้อยกว่า 3 ชั่วโมง'); }
    else if (minutes <= 1440) { score += 26; reasons.push('ใกล้ถึงกำหนดในวันนี้'); }
    else if (minutes <= 4320) { score += 15; reasons.push('ใกล้ถึงกำหนดใน 3 วัน'); }
  }

  if (hasAny(text, urgentWords)) { score += 12; reasons.push('มีคำสำคัญ เช่น สอบ/ควิซ/ส่งงาน'); }
  if (item.status === 'completed') score -= 75;

  return {dates, reasons, score: clampScore(score)};
}

function readableActivityTitle(item: WithId<Activity>) {
  if (/^(ทำ|อ่าน|เตรียม|ทบทวน)/i.test(item.title.trim())) return item.title.trim();
  return `ทำ ${item.title.trim()}`;
}

function isAcademicDeadline(item: WithId<Activity>) {
  if (item.status === 'completed' || item.status === 'cancelled') return false;
  return hasAny(normalizeText(item.title, item.note, item.category, item.location), academicDeadlineWords);
}

function thaiShortDate(date: Date) {
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok',
  }).format(date);
}

export function buildGroundedAcademicSuggestionsFromData(
  scheduleItems: WithId<Schedule>[],
  activityItems: WithId<Activity>[],
  now = new Date(),
) {
  const blocks = buildBusyBlocks(scheduleItems, activityItems);
  const freeSlots = [0, 1]
    .flatMap((offset) => findFreeSlots(blocks, startOfDay(now, offset), 35, now))
    .filter((slot) => slot.end > now)
    .sort((first, second) => first.start.getTime() - second.start.getTime());
  const deadlines = activityItems
    .filter(isAcademicDeadline)
    .map((item) => ({item, ...scoreTask(item, now)}))
    .filter((entry) => !entry.dates || entry.dates.start > now)
    .sort((first, second) => {
      const firstDue = first.dates?.start.getTime() ?? Number.MAX_SAFE_INTEGER;
      const secondDue = second.dates?.start.getTime() ?? Number.MAX_SAFE_INTEGER;
      return firstDue - secondDue || second.score - first.score;
    });
  const deadline = deadlines[0];
  if (!deadline) return [];
  const slot = freeSlots.find((candidate) => !deadline.dates || candidate.end <= deadline.dates.start);
  if (!slot) return [];
  const fitted = fitSlot(slot, deadline.score >= 80 ? 60 : 35);
  const dueText = deadline.dates
    ? `ก่อนกำหนด ${thaiShortDate(deadline.dates.start)} ${formatTime(deadline.dates.start)}`
    : 'จากงานสอบ/งานส่งในปฏิทินของคุณ';
  return [{
    detail: `${dueText} • ช่วงนี้ไม่ชนคาบเรียนหรือกิจกรรมอื่น`,
    endAt: fitted.end.toISOString(),
    location: deadline.item.location || 'ช่วงว่าง',
    note: `เตรียมหัวข้อจาก "${deadline.item.title}" ตามรายละเอียดที่บันทึกไว้`,
    priority: deadline.score >= 80 ? 'urgent' as const : deadline.score >= 60 ? 'high' as const : 'normal' as const,
    reasons: ['อิงจากงานสอบ/งานส่งในปฏิทินจริง', 'ตรวจแล้วว่าไม่ชนตาราง'],
    score: deadline.score,
    startAt: fitted.start.toISOString(),
    time: `${thaiShortDate(fitted.start)} ${formatTimeRange(fitted.start, fitted.end)}`,
    title: `เตรียม ${deadline.item.title.trim()}`,
    type: 'task' as const,
  } satisfies ActivitySuggestion];
}

function noteCategoryFromText(text: string): NoteCategory {
  if (hasAny(text, workWords)) return 'work';
  if (hasAny(text, studyWords)) return 'study';
  return 'personal';
}

function isDuplicateNote(title: string, existingNotes: WithId<Note>[]) {
  const normalized = title.toLowerCase().replace(/\s+/g, '');
  return existingNotes.some((note) => note.title.toLowerCase().replace(/\s+/g, '').includes(normalized) || normalized.includes(note.title.toLowerCase().replace(/\s+/g, '')));
}

export function buildActivitySuggestionsFromData(
  scheduleItems: WithId<Schedule>[],
  activityItems: WithId<Activity>[],
  now = new Date(),
) {
  const today = startOfDay(now);
  const blocks = buildBusyBlocks(scheduleItems, activityItems);
  const slots = findFreeSlots(blocks, today, 30, now).filter((slot) => slot.end > now);
  const tasks = activityItems
    .filter((item) => item.type === 'task' && item.status !== 'completed')
    .map((item) => ({item, ...scoreTask(item, now)}))
    .filter((item) => item.score > 0)
    .sort((first, second) => second.score - first.score);

  const suggestions: ActivitySuggestion[] = [];
  const bestTask = tasks[0];
  const taskSlot = slots.find((slot) => slot.minutes >= 35);
  if (bestTask && taskSlot) {
    const fitted = fitSlot(taskSlot, bestTask.score >= 80 ? 60 : 35);
    suggestions.push({
      detail: `${bestTask.reasons.slice(0, 2).join(' • ') || 'งานนี้ควรวางไว้ในช่วงว่าง'} และไม่ชนตารางเรียน`,
      endAt: fitted.end.toISOString(),
      location: bestTask.item.location || 'เวลาว่าง',
      note: bestTask.item.note || `AI แนะนำให้เริ่มจากงานสำคัญที่สุดก่อน: ${bestTask.item.title}`,
      priority: bestTask.score >= 80 ? 'urgent' : bestTask.score >= 60 ? 'high' : 'normal',
      reasons: [...bestTask.reasons, 'มีช่วงว่างพอทำได้จริง'],
      score: bestTask.score,
      startAt: fitted.start.toISOString(),
      time: formatTimeRange(fitted.start, fitted.end),
      title: readableActivityTitle(bestTask.item),
      type: 'task',
    });
  }

  const nextClass = scheduleItems
    .map((item) => ({dates: itemDates(item), item}))
    .filter((entry): entry is {dates: {end: Date; start: Date}; item: WithId<Schedule>} => entry.dates !== null && entry.dates.start >= now)
    .sort((first, second) => first.dates.start.getTime() - second.dates.start.getTime())[0];
  if (nextClass) {
    const afterClassSlot = slots.find((slot) => slot.start >= nextClass.dates.end && slot.minutes >= 30) ?? slots.find((slot) => slot.minutes >= 30);
    if (afterClassSlot) {
      const fitted = fitSlot(afterClassSlot, 45);
      suggestions.push({
        detail: `เหมาะหลัง ${nextClass.item.title} เพื่อทบทวนทันที`,
        endAt: fitted.end.toISOString(),
        location: nextClass.item.location || 'ห้องเรียน/หอพัก',
        note: `ทบทวนหัวข้อจาก ${nextClass.item.title} และจดสิ่งที่ยังไม่เข้าใจ`,
        priority: 'normal',
        reasons: ['อิงจากตารางเรียนจริง', 'มีช่องว่างไม่ชนรายการอื่น'],
        score: 62,
        startAt: fitted.start.toISOString(),
        time: formatTimeRange(fitted.start, fitted.end),
        title: `ทบทวน ${nextClass.item.courseCode || nextClass.item.title}`,
        type: 'activity',
      });
    }
  }

  const remainingSlot = slots.find((slot) => slot.minutes >= 30 && !suggestions.some((item) => item.startAt === slot.start.toISOString()));
  if (remainingSlot && suggestions.length < 2) {
    const fitted = fitSlot(remainingSlot, 30);
    suggestions.push({
      detail: 'ช่วงนี้ไม่มีตารางชน เหมาะสำหรับจัดงานค้างหรือพักแบบมีแผน',
      endAt: fitted.end.toISOString(),
      location: 'เวลาว่าง',
      note: 'ใช้ช่วงนี้เคลียร์งานเล็ก ๆ หรือวางแผนงานต่อไป',
      priority: 'low',
      reasons: ['พบช่องว่างในตารางวันนี้', 'ช่วยลดงานสะสม'],
      score: 45,
      startAt: fitted.start.toISOString(),
      time: formatTimeRange(fitted.start, fitted.end),
      title: 'เคลียร์งานสั้น ๆ',
      type: 'task',
    });
  }

  return suggestions.sort((first, second) => second.score - first.score).slice(0, 3);
}

export function buildNoteSuggestionsFromData(
  scheduleItems: WithId<Schedule>[],
  activityItems: WithId<Activity>[],
  noteItems: WithId<Note>[],
  now = new Date(),
) {
  const suggestions: NoteSuggestion[] = [];
  const scoredTasks = activityItems
    .filter((item) => item.status !== 'completed')
    .map((item) => ({item, ...scoreTask(item, now)}))
    .sort((first, second) => second.score - first.score);

  scoredTasks.slice(0, 2).forEach(({item, reasons, score}) => {
    const text = normalizeText(item.title, item.note, item.category, item.location);
    const title = `Checklist: ${item.title}`;
    if (isDuplicateNote(title, noteItems)) return;
    suggestions.push({
      category: noteCategoryFromText(text),
      content: `สิ่งที่ต้องทำสำหรับ ${item.title}\n- สรุปสิ่งที่ต้องส่ง/ต้องเตรียม\n- แยกขั้นตอนที่ทำได้ภายใน 30-45 นาที\n- เช็กไฟล์หรือเอกสารก่อนถึงเวลา`,
      detail: reasons.slice(0, 2).join(' • ') || 'แนะนำจากงานที่ยังไม่เสร็จ',
      reasons: [...reasons, 'ยังไม่มีโน้ตซ้ำในระบบ'],
      score,
      title,
    });
  });

  scheduleItems
    .map((item) => ({dates: itemDates(item), item}))
    .filter((entry): entry is {dates: {end: Date; start: Date}; item: WithId<Schedule>} => entry.dates !== null && entry.dates.start >= now)
    .sort((first, second) => first.dates.start.getTime() - second.dates.start.getTime())
    .slice(0, 2)
    .forEach(({item}) => {
      const title = `โน้ต ${item.courseCode || item.title}`;
      if (isDuplicateNote(title, noteItems)) return;
      suggestions.push({
        category: 'study',
        content: `หัวข้อที่ควรจดจาก ${item.title}\n- ประเด็นที่อาจารย์เน้น\n- ตัวอย่าง/โจทย์ที่ยังไม่เข้าใจ\n- งานหรือการบ้านที่เกี่ยวข้อง`,
        detail: 'แนะนำจากตารางเรียนที่กำลังจะมาถึง',
        reasons: ['อิงจากตารางเรียนจริง', 'ช่วยเตรียมตัวก่อน/หลังเรียน'],
        score: 58,
        title,
      });
    });

  return suggestions.sort((first, second) => second.score - first.score).slice(0, 3);
}

export async function getActivitySuggestions(uid: string) {
  const now = new Date();
  const from = startOfDay(now);
  const to = endOfDay(now, 1);
  const [scheduleItems, activityItems] = await Promise.all([
    schedules.between(uid, from, to),
    activities.between(uid, from, to),
  ]);
  return enhanceRecommendations(uid, 'activity', buildActivitySuggestionsFromData(scheduleItems, activityItems, now));
}

export async function getGroundedAcademicSuggestions(uid: string) {
  const now = new Date();
  const from = startOfDay(now);
  const [scheduleItems, activityItems] = await Promise.all([
    schedules.between(uid, from, endOfDay(now, 1)),
    activities.between(uid, from, endOfDay(now, 14)),
  ]);
  const grounded = buildGroundedAcademicSuggestionsFromData(scheduleItems, activityItems, now);
  return enhanceRecommendations(uid, 'activity', grounded);
}

export async function getNoteSuggestions(uid: string) {
  const now = new Date();
  const from = startOfDay(now);
  const to = endOfDay(now, 7);
  const [scheduleItems, activityItems, noteItems] = await Promise.all([
    schedules.between(uid, from, to),
    activities.between(uid, from, to),
    notes.list(uid),
  ]);
  return enhanceRecommendations(uid, 'note', buildNoteSuggestionsFromData(scheduleItems, activityItems, noteItems, now));
}
