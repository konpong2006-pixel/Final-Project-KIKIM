import {getMessaging} from "firebase-admin/messaging";
import {
  DocumentData,
  FieldValue,
  Firestore,
  QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {
  adaptiveTimePeriod,
  calculateSchedulingPatterns as calculatePatterns,
  DEFAULT_ADAPTIVE_PREFERENCES,
  findAdaptiveTimeSlots,
  overlappingScheduleItems,
  parseClockMinutes,
  validateCandidateSlot,
  validateMovableScheduleItem,
  zonedDayStart,
} from "./engine";
import {
  ADAPTIVE_ACTIVITY_CATEGORIES,
  ADAPTIVE_BEHAVIOR_EVENT_TYPES,
  AdaptiveActivityCategory,
  AdaptiveBehaviorEventType,
  AdaptivePriority,
  AdaptiveSchedulingPattern,
  AdaptiveSchedulingPreferences,
  AdaptiveSlotRequest,
  EngineScheduleItem,
  PatternBehaviorObservation,
} from "./types";
import {validateGeminiNaturalLanguageIntent, ValidatedNaturalLanguageIntent} from "./validation";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const PENDING_SUGGESTION_TTL_MS = 7 * DAY_MS;
/** How far back the outcome sweep looks for slots that quietly went by. */
const OUTCOME_SWEEP_WINDOW_MS = 3 * DAY_MS;
/** A slot is not "skipped" the second it ends; the user may still be finishing. */
const OUTCOME_SWEEP_GRACE_MS = 30 * MINUTE_MS;
const SUGGESTION_MINIMUM_LEAD_MS = 10 * MINUTE_MS;
const GEMINI_EXPLANATION_TIMEOUT_MS = 4_500;
/** Parsing runs before anything is shown, so it may think a little longer. */
const GEMINI_PARSE_TIMEOUT_MS = 9_000;
/**
 * The same ordered candidates the assistant, receipt and schedule parsers use.
 *
 * A single hardcoded model is how this file quietly stopped reaching Gemini at
 * all: the request 404s and the deterministic fallback answers instead, with
 * nothing in the logs to say so.
 */
const GEMINI_MODEL_CANDIDATES = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];

type AdaptiveFactoryOptions = {
  db: Firestore;
  geminiApiKey: ReturnType<typeof defineSecret>;
  region: string;
};

type ActivityRecord = {
  allowAiReschedule: boolean;
  category: AdaptiveActivityCategory;
  deadlineMs: number | null;
  durationMinutes: number;
  endMs: number;
  estimatedDurationMinutes: number;
  fixedLocalDate: string | null;
  googleEventId: string;
  id: string;
  isFlexible: boolean;
  isLocked: boolean;
  ownerId: string;
  priority: AdaptivePriority;
  source: string;
  startMs: number;
  status: string;
  title: string;
  version: number;
};

type NaturalLanguageIntent = ValidatedNaturalLanguageIntent;

type GeminiInteractionResponse = {
  error?: {message?: string};
  outputs?: {text?: string}[];
  steps?: {content?: {text?: string; type?: string}[]; type?: string}[];
};

/**
 * One Gemini interactions call, retried down the model list on a 404.
 *
 * Failures are logged with the model and status only. The key never leaves the
 * request headers, and the user's message is not logged either.
 */
async function geminiInteraction(apiKey: string, body: Record<string, unknown>, timeoutMs: number, label: string) {
  const models = [...new Set([
    process.env.GEMINI_ASSISTANT_MODEL,
    ...GEMINI_MODEL_CANDIDATES,
  ].filter((value): value is string => Boolean(value)))];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (const [index, model] of models.entries()) {
      const response = await fetch("https://generativelanguage.googleapis.com/v1/interactions", {
        body: JSON.stringify({...body, model}),
        headers: {"Content-Type": "application/json", "x-goog-api-key": apiKey},
        method: "POST",
        signal: controller.signal,
      });
      const payload = await response.json() as GeminiInteractionResponse;
      if (response.ok) return {model, ok: true as const, payload};
      if (response.status !== 404 || index === models.length - 1) {
        console.error(`${label}: Gemini request failed.`, {
          detail: text(payload.error?.message, 240),
          model,
          status: response.status,
        });
        return {model, ok: false as const, payload};
      }
      console.warn(`${label}: Gemini model unavailable, trying the next candidate.`, {model, status: response.status});
    }
    return {model: "", ok: false as const, payload: {} as GeminiInteractionResponse};
  } finally {
    clearTimeout(timeout);
  }
}

function interactionText(response: GeminiInteractionResponse) {
  const stepText = response.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("")
    .trim();
  return stepText || response.outputs?.map((item) => item.text ?? "").join("").trim() || "";
}

function requiredUid(request: {auth?: {uid?: string}}) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in before using adaptive scheduling.");
  return uid;
}

function text(value: unknown, maximum = 160) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function finiteNumber(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  const result = finiteNumber(value, fallback);
  return Math.min(maximum, Math.max(minimum, result));
}

function timestampMs(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string" || typeof value === "number") {
    const result = new Date(value).getTime();
    return Number.isNaN(result) ? null : result;
  }
  return null;
}

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: value}).format();
    return true;
  } catch {
    return false;
  }
}

function validClock(value: unknown, fallback: string | null) {
  if (value === null) return null;
  const candidate = text(value, 5);
  return parseClockMinutes(candidate) === null ? fallback : candidate;
}

function category(value: unknown): AdaptiveActivityCategory {
  const candidate = text(value, 40).toLowerCase().replace(/[ -]+/g, "_");
  if ((ADAPTIVE_ACTIVITY_CATEGORIES as readonly string[]).includes(candidate)) return candidate as AdaptiveActivityCategory;
  if (/gaming|game|เล่นเกม|เกม|ไฟต์/i.test(candidate)) return "gaming";
  if (/program|code|coding|dev|เขียนโปรแกรม/i.test(candidate)) return "programming";
  if (/exercise|workout|gym|วิ่ง|ออกกำลัง/i.test(candidate)) return "exercise";
  if (/read|หนังสือ|อ่าน/i.test(candidate)) return "reading";
  if (/study|เรียน|ทบทวน/i.test(candidate)) return "study";
  if (/assign|homework|งานส่ง|การบ้าน/i.test(candidate)) return "assignment";
  return "other";
}

function adaptiveTitleFromMessage(value: string) {
  return value
    .trim()
    // The filler is tied to the verb: "จัดให้ที" is all preamble, but a bare
    // leading "ที" is far more likely to be the start of a real word.
    .replace(/^(?:ช่วย|อยาก|ขอ|please)?\s*(?:ให้)?\s*(?:(?:หาเวลา|จัดเวลา|จัดตาราง|จัดให้|วางแผน|ลงตาราง|เพิ่ม|สร้าง|บันทึก)(?:\s*(?:ที|หน่อย|ด้วย))?)?\s*/i, "")
    .replace(/[๐-๙\d]+(?:\.[๐-๙\d]+)?\s*(?:ชั่วโมง|ชม\.?|hours?|นาที|minutes?)(?:\s*(?:ครึ่ง|and a half))?(?=\s|$)/gi, " ")
    .replace(/(?:ก่อน|ภายใน|ไม่เกิน)\s*(?:วัน|วันที่|พรุ่งนี้|มะรืน|สัปดาห์|อาทิตย์).*$/i, " ")
    // Written-out dates belong to the schedule, never to the activity name.
    .replace(/[๐-๙\d]{4}-[๐-๙\d]{1,2}-[๐-๙\d]{1,2}/g, " ")
    .replace(new RegExp(`(?:วันที่|วัน|on)?\\s*[๐-๙\\d]{1,2}\\s*(?:st|nd|rd|th)?\\s*(?:เดือน\\s*)?(?:${MONTH_NAME_SOURCE})(?:\\s*(?:ปี|พ\\.?ศ\\.?|ค\\.?ศ\\.?)\\s*[๐-๙\\d]{2,4}|\\s*[๐-๙\\d]{4})?`, "gi"), " ")
    // The leading "on" goes with the date it introduces, or "buy manga on Sep 1"
    // keeps a dangling preposition once the date is taken out.
    .replace(new RegExp(`(?:\\bon\\s+)?(?:${MONTH_NAME_SOURCE})\\s*[๐-๙\\d]{1,2}\\s*(?:st|nd|rd|th)?,?(?:\\s*[๐-๙\\d]{4})?`, "gi"), " ")
    .replace(/(?:วันที่\s*)?[๐-๙\d]{1,2}\s*\/\s*[๐-๙\d]{1,2}(?:\s*\/\s*[๐-๙\d]{2,4})?/g, " ")
    .replace(/วันที่\s*[๐-๙\d]{1,2}/g, " ")
    .replace(/(?:วัน)?(?:จันทร์|อังคาร|พุธ|พฤหัส(?:บดี)?|ศุกร์|เสาร์|อาทิตย์|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:นี้|หน้า)?/gi, " ")
    .replace(/(?:(?:วัน)?มะรืน(?:นี้)?|พรุ่งนี้|วันนี้|day\s*after\s*tomorrow|tomorrow|today|tonight|this\s+(?:morning|afternoon|evening|noon|night))(?:\s*(?:ตอน|ช่วง)?\s*(?:เช้า|สาย|เที่ยง|บ่าย|เย็น|ค่ำ|คืน|ดึก))?/gi, " ")
    .replace(/(?:ตอน|ช่วง|ช่อง)?\s*(?:เช้า|สาย|เที่ยง|บ่าย|เย็น|ค่ำ|คืน|ดึก)นี้/gi, " ")
    .replace(/^\s*(?:ช่วย|อยาก|จะ|ขอ|please)?\s*(?:ให้)?\s*(?:หาเวลา|จัดเวลา|วางแผน|ลงตาราง|เพิ่ม|สร้าง|บันทึก)?\s*/i, "")
    .replace(/(?:ตอน|ช่วง|ช่อง)\s*(?:เช้า|สาย|เที่ยง|บ่าย|เย็น|ค่ำ|กลางคืน|ดึก).*$/i, " ")
    .replace(/(?:หลัง|ตั้งแต่|ไม่ก่อน|ก่อน|ไม่เกิน|ไม่หลัง|เวลา|ตอน)\s*(?:เวลา)?\s*(?:ตี|บ่าย|เที่ยง)?\s*(?:[๐-๙\d]{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|สิบเอ็ด|สิบสอง)(?:[:.][๐-๙\d]{2})?\s*(?:โมงเช้า|โมงเย็น|โมง|ทุ่ม|นาฬิกา|น\.|am|pm)?/gi, " ")
    // Politeness stacks up in real messages ("จัดให้ที", "ให้หน่อยนะครับ"), so
    // one pass over a single word is not enough to keep it out of the title.
    .replace(/(?:\s*(?:ให้หน่อย|ให้ที|ให้ด้วย|จัดให้|ช่วยด้วย|หน่อย|ด้วย|ที|นะ|ครับ|ค่ะ|คับ|จ้า))+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function normalizeThaiDigits(value: string) {
  const thaiDigits = "๐๑๒๓๔๕๖๗๘๙";
  return value.replace(/[๐-๙]/g, (digit) => String(thaiDigits.indexOf(digit)));
}

function parsedLocalClock(hourValue: string, minuteValue: string | undefined, prefixValue: string | undefined, suffixValue: string | undefined) {
  let hour = Number(hourValue);
  const minute = Number(minuteValue ?? 0);
  const marker = `${prefixValue ?? ""} ${suffixValue ?? ""}`.toLowerCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (/ทุ่ม/.test(marker)) hour = hour === 6 ? 0 : hour + 18;
  else if (/(?:pm|โมงเย็น|บ่าย|เย็น|ค่ำ|กลางคืน|ดึก)/.test(marker) && hour < 12) hour += 12;
  else if (/(?:am|ตี|เช้า)/.test(marker) && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function relationClock(message: string, relation: "after" | "at" | "before") {
  const normalized = normalizeThaiDigits(message).toLowerCase()
    .replace(/สิบสอง/g, "12").replace(/สิบเอ็ด/g, "11").replace(/สิบ/g, "10")
    .replace(/เก้า/g, "9").replace(/แปด/g, "8").replace(/เจ็ด/g, "7").replace(/หก/g, "6")
    .replace(/ห้า/g, "5").replace(/สี่/g, "4").replace(/สาม/g, "3").replace(/สอง/g, "2").replace(/หนึ่ง/g, "1");
  const relationPattern = relation === "after" ? "(?:หลัง|ตั้งแต่|ไม่ก่อน|after|from)" :
    relation === "before" ? "(?:ก่อน|ไม่เกิน|ไม่หลัง|before|by)" : "(?:ตอน|เวลา|เริ่ม(?:ตอน|เวลา)?|at)";
  const match = new RegExp(`${relationPattern}\\s*(?:เวลา)?\\s*(ตี|บ่าย|เที่ยง)?\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(โมงเช้า|โมงเย็น|โมง|ทุ่ม|นาฬิกา|น\\.|am|pm)?`, "i").exec(normalized);
  if (!match) return null;
  return parsedLocalClock(match[2], match[3], match[1], match[4]);
}

function isExclusiveAfterClock(message: string) {
  const normalized = normalizeThaiDigits(message).toLowerCase();
  return /(?:หลัง|after)\s*(?:เวลา)?\s*(?:ตี|บ่าย|เที่ยง)?\s*(?:\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|สิบเอ็ด|สิบสอง)/i.test(normalized);
}

/**
 * Day words that name a calendar day relative to today instead of by weekday.
 *
 * "บ่ายนี้", "เย็นนี้" and the rest name a part of *today*, so they resolve to
 * the same day as a bare "วันนี้"; the part of day is handled separately as a
 * preferred period. Longer offsets are listed first because "มะรืนนี้" also
 * ends in "นี้" and must not be mistaken for one of the today forms.
 */
const RELATIVE_DAY_PATTERNS: {offset: number; pattern: RegExp}[] = [
  {offset: 2, pattern: /(?:วัน)?มะรืน(?:นี้)?|day\s*after\s*tomorrow/i},
  {offset: 1, pattern: /พรุ่งนี้|tomorrow/i},
  {offset: 0, pattern: /วันนี้|today|tonight|this\s+(?:morning|afternoon|evening|noon|night)|(?:เช้า|สาย|เที่ยง|บ่าย|เย็น|ค่ำ|ดึก)นี้|(?<!เที่ยง)คืนนี้/i},
];

/**
 * The hour half of the same "this <part of day>" phrases.
 *
 * Resolving only their date left "อ่านหนังสือคืนนี้" landing at six in the
 * morning: the day was right, but nothing on the server claimed the evening,
 * and the model does not reliably fill the period in either. The server owns
 * this the same way it owns weekdays and relative dates.
 */
const RELATIVE_PERIOD_PATTERNS: {pattern: RegExp; period: RequestedPeriod}[] = [
  {pattern: /เช้านี้|this\s+morning/i, period: "morning"},
  {pattern: /สายนี้/i, period: "late_morning"},
  {pattern: /บ่ายนี้|this\s+afternoon/i, period: "afternoon"},
  {pattern: /เย็นนี้|this\s+evening/i, period: "evening"},
  {pattern: /ค่ำนี้|ดึกนี้|tonight|this\s+night|(?<!เที่ยง)คืนนี้/i, period: "night"},
];

/**
 * Month names as people actually write them: full, shortened, and the dotted
 * abbreviations, Thai and English.
 *
 * Longer spellings come first inside each entry so "กันยายน" is matched whole
 * instead of as "กันยา" with a stray "ยน" left in the title.
 */
const MONTH_NAME_PATTERNS: {month: number; pattern: string}[] = [
  {month: 1, pattern: "มกราคม|มกรา|ม\\.?ค\\.?|jan(?:uary)?"},
  {month: 2, pattern: "กุมภาพันธ์|กุมภา|ก\\.?พ\\.?|feb(?:ruary)?"},
  {month: 3, pattern: "มีนาคม|มีนา|มี\\.?ค\\.?|mar(?:ch)?"},
  {month: 4, pattern: "เมษายน|เมษา|เม\\.?ย\\.?|apr(?:il)?"},
  {month: 5, pattern: "พฤษภาคม|พฤษภา|พ\\.?ค\\.?|may"},
  {month: 6, pattern: "มิถุนายน|มิถุนา|มิ\\.?ย\\.?|jun(?:e)?"},
  {month: 7, pattern: "กรกฎาคม|กรกฎา|ก\\.?ค\\.?|jul(?:y)?"},
  {month: 8, pattern: "สิงหาคม|สิงหา|ส\\.?ค\\.?|aug(?:ust)?"},
  {month: 9, pattern: "กันยายน|กันยา|ก\\.?ย\\.?|sep(?:t(?:ember)?)?"},
  {month: 10, pattern: "ตุลาคม|ตุลา|ต\\.?ค\\.?|oct(?:ober)?"},
  {month: 11, pattern: "พฤศจิกายน|พฤศจิกา|พ\\.?ย\\.?|nov(?:ember)?"},
  {month: 12, pattern: "ธันวาคม|ธันวา|ธ\\.?ค\\.?|dec(?:ember)?"},
];

const MONTH_NAME_SOURCE = MONTH_NAME_PATTERNS.map((entry) => `(?:${entry.pattern})`).join("|");
/**
 * A year only counts when it is unmistakably a year: four digits, or two
 * digits behind an explicit ปี/พ.ศ. marker. Without that, "1 กันยา 10 โมง"
 * reads its start time as the year 2010 and schedules the past.
 */
const YEAR_SUFFIX_SOURCE = "(?:\\s*(?:ปี|พ\\.?ศ\\.?|ค\\.?ศ\\.?)\\s*(\\d{2,4})|\\s*(\\d{4}))?(?!\\d)";

function monthFromName(value: string) {
  return MONTH_NAME_PATTERNS.find((entry) => new RegExp(`^(?:${entry.pattern})$`, "i").test(value.trim()))?.month ?? null;
}

/**
 * Turns a day/month/year triple into a local ISO date.
 *
 * Thai users write both eras, so 2569 and a bare 69 both mean 2026. When no
 * year is written at all the nearest future occurrence is meant, never a date
 * that has already gone by.
 */
function resolveCalendarDate(day: number, month: number, rawYear: number | null, localDate: string) {
  if (!Number.isInteger(day) || day < 1 || day > 31 || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const todayMs = Date.parse(`${localDate}T12:00:00Z`);
  if (Number.isNaN(todayMs)) return null;
  const year = rawYear === null ? new Date(todayMs).getUTCFullYear() :
    rawYear >= 2400 ? rawYear - 543 :
      rawYear >= 1900 ? rawYear :
        rawYear >= 60 ? 2500 + rawYear - 543 : 2000 + rawYear;
  // The Date constructor rolls 31 กันยายน into 1 October; a day that does not
  // exist is a parse failure, not a different date.
  const build = (value: number) => {
    const candidate = new Date(Date.UTC(value, month - 1, day, 12));
    return candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day ? candidate : null;
  };
  const first = build(year);
  const resolved = first && rawYear === null && first.getTime() < todayMs ? build(year + 1) : first;
  return resolved ? resolved.toISOString().slice(0, 10) : null;
}

/**
 * Reads a written-out calendar date: "วันที่ 1 กันยา", "1 ก.ย. 2569", "1/9",
 * "2026-09-01", "Sep 1", or a bare "วันที่ 5" meaning the next fifth.
 *
 * This is the piece the deterministic layer never had, which is why an
 * unambiguous "วันที่ 1 กันยา" was dropped and the search ranged freely over
 * the whole fortnight.
 */
function explicitDateFromMessage(message: string, localDate: string) {
  const normalized = normalizeThaiDigits(message);
  const year = (marked: string | undefined, bare: string | undefined) =>
    marked ? Number(marked) : bare ? Number(bare) : null;

  const iso = /(?:^|\D)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(normalized);
  if (iso) return resolveCalendarDate(Number(iso[3]), Number(iso[2]), Number(iso[1]), localDate);

  const dayMonth = new RegExp(
    `(?:วันที่|วัน|on)?\\s*(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(?:เดือน\\s*)?(${MONTH_NAME_SOURCE})${YEAR_SUFFIX_SOURCE}`,
    "i",
  ).exec(normalized);
  if (dayMonth) {
    const month = monthFromName(dayMonth[2]);
    if (month) return resolveCalendarDate(Number(dayMonth[1]), month, year(dayMonth[3], dayMonth[4]), localDate);
  }

  const monthDay = new RegExp(
    `(${MONTH_NAME_SOURCE})\\s*(\\d{1,2})\\s*(?:st|nd|rd|th)?,?${YEAR_SUFFIX_SOURCE}`,
    "i",
  ).exec(normalized);
  if (monthDay) {
    const month = monthFromName(monthDay[1]);
    if (month) return resolveCalendarDate(Number(monthDay[2]), month, year(monthDay[3], monthDay[4]), localDate);
  }

  // "1/2 ชั่วโมง" is a fraction of an hour, not the first of February.
  const slashed = /(?:^|\D)(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?(?!\s*[:.]?\d)(?!\s*(?:ชั่วโมง|ชม\.?|นาที|hours?|minutes?))/.exec(normalized);
  if (slashed) return resolveCalendarDate(Number(slashed[1]), Number(slashed[2]), slashed[3] ? Number(slashed[3]) : null, localDate);

  const dayOnly = /วันที่\s*(\d{1,2})(?!\s*[:.]?\d)/.exec(normalized);
  if (dayOnly) {
    const todayMs = Date.parse(`${localDate}T12:00:00Z`);
    if (Number.isNaN(todayMs)) return null;
    const today = new Date(todayMs);
    const thisMonth = resolveCalendarDate(Number(dayOnly[1]), today.getUTCMonth() + 1, today.getUTCFullYear(), localDate);
    if (thisMonth && Date.parse(`${thisMonth}T12:00:00Z`) >= todayMs) return thisMonth;
    const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1, 12));
    return resolveCalendarDate(Number(dayOnly[1]), next.getUTCMonth() + 1, next.getUTCFullYear(), localDate);
  }

  return null;
}

function requestedDateFromMessage(message: string, localDate?: string) {
  if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
  // An explicit calendar date is unambiguous, so it outranks both a weekday
  // word and a relative day word appearing in the same sentence.
  const explicit = explicitDateFromMessage(message, localDate);
  if (explicit) return explicit;
  const weekdayPatterns: {day: number; pattern: RegExp}[] = [
    {day: 0, pattern: /(?:วัน)?อาทิตย์|sunday/i},
    {day: 1, pattern: /(?:วัน)?จันทร์|monday/i},
    {day: 2, pattern: /(?:วัน)?อังคาร|tuesday/i},
    {day: 3, pattern: /(?:วัน)?พุธ|wednesday/i},
    {day: 4, pattern: /(?:วัน)?พฤหัส(?:บดี)?|thursday/i},
    {day: 5, pattern: /(?:วัน)?ศุกร์|friday/i},
    {day: 6, pattern: /(?:วัน)?เสาร์|saturday/i},
  ];
  const base = new Date(`${localDate}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  const requestedDay = weekdayPatterns.find((entry) => entry.pattern.test(message))?.day;
  let dayOffset: number;
  if (requestedDay !== undefined) {
    dayOffset = (requestedDay - base.getUTCDay() + 7) % 7;
    if (/(?:สัปดาห์หน้า|อาทิตย์หน้า|next week)/i.test(message)) dayOffset += 7;
  } else {
    // Without this the day word is simply dropped and the engine is free to
    // range over the whole 14-day search window, which is how "วันนี้" used to
    // come back as a slot two days out.
    const relative = RELATIVE_DAY_PATTERNS.find((entry) => entry.pattern.test(message));
    if (!relative) return null;
    dayOffset = relative.offset;
  }
  base.setUTCDate(base.getUTCDate() + dayOffset);
  return base.toISOString().slice(0, 10);
}

function namedClockSemantics(message: string) {
  const normalized = normalizeThaiDigits(message).toLowerCase();
  const isMidnight = /เที่ยงคืน|midnight/.test(normalized);
  // Word boundaries matter here: without them the "noon" inside "afternoon"
  // matched, and "this afternoon" was scheduled at 12:00 sharp.
  const isNoon = !isMidnight && /เที่ยง(?!คืน)|\bnoon\b|\bmidday\b/.test(normalized);
  if (!isMidnight && !isNoon) return null;
  const phrase = isMidnight ? "(?:เที่ยงคืน|midnight)" : "(?:เที่ยง(?!คืน)|\\bnoon\\b|\\bmidday\\b)";
  if (new RegExp(`(?:หลัง|after)\\s*(?:เวลา)?\\s*${phrase}`, "i").test(normalized)) {
    return {clock: isMidnight ? "00:00" : "12:00", exclusive: true, period: isMidnight ? "night" as const : "noon" as const, relation: "after" as const};
  }
  if (new RegExp(`(?:ตั้งแต่|ไม่ก่อน|from)\\s*(?:เวลา)?\\s*${phrase}`, "i").test(normalized)) {
    return {clock: isMidnight ? "00:00" : "12:00", exclusive: false, period: isMidnight ? "night" as const : "noon" as const, relation: "after" as const};
  }
  if (new RegExp(`(?:ก่อน|ไม่เกิน|ไม่หลัง|before|by)\\s*(?:เวลา)?\\s*${phrase}`, "i").test(normalized)) {
    return {clock: isMidnight ? "00:00" : "12:00", exclusive: false, period: isMidnight ? "night" as const : "noon" as const, relation: "before" as const};
  }
  return {clock: isMidnight ? "00:00" : "12:00", exclusive: false, period: isMidnight ? "night" as const : "noon" as const, relation: "exact" as const};
}

export function applyDeterministicTemporalSemantics(
  intent: NaturalLanguageIntent,
  message: string,
  temporalContext?: {localDate?: string},
): NaturalLanguageIntent {
  const requestedLocalDate = requestedDateFromMessage(message, temporalContext?.localDate);
  const namedClock = namedClockSemantics(message);
  // An exact clock the user gave always beats a broad part of day, so this only
  // fills the gap the model left rather than overruling a stated time.
  const hasExplicitClock = Boolean(intent.earliestLocalStartTime || intent.latestLocalStartTime);
  const relativePeriod = namedClock || hasExplicitClock ? undefined :
    RELATIVE_PERIOD_PATTERNS.find((entry) => entry.pattern.test(message))?.period;
  return {
    ...intent,
    ...(requestedLocalDate ? {requestedLocalDate} : {}),
    ...(relativePeriod ? {preferredPeriod: relativePeriod} : {}),
    ...(namedClock ? {
      earliestLocalStartExclusive: namedClock.relation === "after" && namedClock.exclusive,
      earliestLocalStartTime: namedClock.relation === "before" ? null : namedClock.clock,
      latestLocalStartTime: namedClock.relation === "after" ? null : namedClock.clock,
      preferredPeriod: namedClock.period,
    } : {}),
  };
}

export function fallbackAdaptiveNaturalLanguageIntent(message: string, temporalContext?: {localDate?: string}): NaturalLanguageIntent {
  const activityCategory = category(message);
  const normalizedMessage = normalizeThaiDigits(message);
  const durationMatch = /(\d+(?:\.\d+)?)\s*(ชั่วโมง|ชม\.?|hours?|นาที|minutes?)/i.exec(normalizedMessage);
  const durationIsHours = Boolean(durationMatch && /ชั่วโมง|ชม|hour/i.test(durationMatch[2]));
  const durationHasHalfHour = durationIsHours && /(?:ชั่วโมง|ชม\.?|hours?)\s*(?:ครึ่ง|and a half)/i.test(normalizedMessage);
  const durationMinutes = durationMatch ? Math.round(Number(durationMatch[1]) * (durationIsHours ? 60 : 1) + (durationHasHalfHour ? 30 : 0)) : null;
  const namedClock = namedClockSemantics(message);
  // "คืนนี้" belongs in the night branch: /night/ only ever matched it through
  // the English "tonight", so the Thai wording alone produced no period at all.
  const preferredPeriod = namedClock?.period ?? (/บ่าย|afternoon/i.test(message) ? "afternoon" : /เย็น|evening/i.test(message) ? "evening" : /กลางคืน|ดึก|ค่ำ|(?<!เที่ยง)คืนนี้|night/i.test(message) ? "night" : /เช้า|morning/i.test(message) ? "morning" : null);
  const earliestLocalStartTime = relationClock(message, "after") ?? (namedClock?.relation === "after" ? namedClock.clock : null);
  const latestLocalStartTime = relationClock(message, "before") ?? (namedClock?.relation === "before" ? namedClock.clock : null);
  const exactLocalStartTime = earliestLocalStartTime || latestLocalStartTime ? null : relationClock(message, "at") ?? (namedClock?.relation === "exact" ? namedClock.clock : null);
  const broadTopic = /^(?:เรื่อง)?\s*(?:การเรียน|เรียน|การเงิน|เงิน|การออม|ออมเงิน|เวลา|การนอน|นอน|การอ่าน|อ่านหนังสือ|สอบ|งาน)\s*(?:ครับ|ค่ะ|คับ)?$/i.test(message.trim());
  const readOnlyQuestion = /(?:อะไร|ไหน|เมื่อไหร่|กี่โมง|เท่าไหร่|อย่างไร|ยังไง|หรือไม่|ไหม|มั้ย|บ้าง|why|what|when|which|how)/i.test(message) ||
    /^(?:ดู|เช็ก|ตรวจ|สรุป|บอก|แนะนำ|ช่วยสรุป)/i.test(message) ||
    /(?:งานค้าง|งานที่ต้องทำ)/i.test(message) && !/(?:ลง|ใส่|ย้าย|เลื่อน|จัด|วาง|แบ่ง|แทรก|เวลา|ตาราง)/i.test(message);
  const intent = /why.*move|ทำไม.*ย้าย/i.test(message) ? "explain_move" :
    /productive|ประสิทธิภาพ|ช่วงไหน.*ดี/i.test(message) ? "productivity" :
      /week|สัปดาห์/i.test(message) && /rebalance|สมดุล|เบา|ย้าย|จัด|วาง|ปรับ|plan/i.test(message) ? "rebalance_week" :
        /เบา|less busy|rebalance|unfinished|ย้าย.*งาน.*ค้าง|(?:สมดุล|ปรับ).*(?:วันนี้|พรุ่งนี้)|(?:วันนี้|พรุ่งนี้).*(?:สมดุล|เบา|ปรับ)/i.test(message) ? "rebalance_day" :
      /ไม่.*(?:เช้า|บ่าย|เย็น|ดึก)|do not|never|always|เสมอ|ตั้งค่า/i.test(message) ? "set_preference" :
        /หาเวลา|วางแผน|จัดเวลา|move|plan|schedule/i.test(message) ? "find_time" :
          !readOnlyQuestion && !broadTopic && adaptiveTitleFromMessage(message) ? "create_activity" : "unknown";
  const preferenceMode = /ไม่|อย่า|ห้าม|avoid|never/i.test(message) ? "avoid" as const : intent === "set_preference" ? "prefer" as const : null;
  const taskTitle = ["create_activity", "find_time"].includes(intent) ? adaptiveTitleFromMessage(message) || null : null;
  return {
    activityCategory,
    deadline: null,
    durationMinutes,
    earliestLocalStartExclusive: Boolean(earliestLocalStartTime && (isExclusiveAfterClock(message) || namedClock?.exclusive)),
    earliestLocalStartTime: earliestLocalStartTime ?? exactLocalStartTime,
    intent,
    latestLocalStartTime: latestLocalStartTime ?? exactLocalStartTime,
    preferredPeriod,
    preferenceMode,
    requestedLocalDate: requestedDateFromMessage(message, temporalContext?.localDate),
    requiresConfirmation: true,
    taskTitle,
  };
}

/**
 * True when the user clearly named a day or a time and nothing resolved it.
 *
 * Only consulted when Gemini was unreachable and the regex fallback answered
 * instead: an unread date word there means the request would otherwise be
 * silently widened to "anywhere in the next fortnight", which is exactly how a
 * confident-looking wrong answer gets produced. Asking is the honest move.
 */
export function unresolvedTemporalMention(message: string, intent: NaturalLanguageIntent) {
  if (intent.requestedLocalDate || intent.earliestLocalStartTime || intent.latestLocalStartTime ||
    intent.preferredPeriod || intent.deadline) return false;
  const normalized = normalizeThaiDigits(message);
  return new RegExp(`\\d\\s*(?:${MONTH_NAME_SOURCE})|(?:${MONTH_NAME_SOURCE})\\s*\\d`, "i").test(normalized) ||
    /วันที่|เดือนหน้า|สัปดาห์หน้า|อาทิตย์หน้า|next\s+(?:week|month)|\d{1,2}\s*[/-]\s*\d{1,2}|\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:โมง|ทุ่ม|นาฬิกา|น\.)/i.test(normalized);
}

type RequestedPeriod = NonNullable<NaturalLanguageIntent["preferredPeriod"]>;

const REQUESTED_PERIOD_WINDOWS: Record<RequestedPeriod, {endTime: string; startTime: string}> = {
  afternoon: {endTime: "17:00", startTime: "13:00"},
  early_morning: {endTime: "08:00", startTime: "05:00"},
  evening: {endTime: "21:00", startTime: "17:00"},
  late_morning: {endTime: "13:00", startTime: "11:00"},
  morning: {endTime: "11:00", startTime: "08:00"},
  // Night intentionally wraps across midnight. Explicit late-night requests
  // may use 00:00-05:00, while automatic suggestions still honor the user's
  // normal wake/sleep and earliest/latest settings.
  night: {endTime: "05:00", startTime: "21:00"},
  noon: {endTime: "13:00", startTime: "12:00"},
};

function clockFromMinutes(value: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function requestedWindowForIntent(intent: NaturalLanguageIntent, durationMinutes: number) {
  const hasExplicitClock = Boolean(intent.earliestLocalStartTime || intent.latestLocalStartTime);
  const period = !hasExplicitClock && intent.preferredPeriod ? REQUESTED_PERIOD_WINDOWS[intent.preferredPeriod] : null;
  const periodStart = period ? parseClockMinutes(period.startTime) : 0;
  const periodEnd = period ? parseClockMinutes(period.endTime) : 23 * 60 + 59;
  const parsedExplicitEarliest = intent.earliestLocalStartTime ? parseClockMinutes(intent.earliestLocalStartTime) : null;
  const explicitEarliest = parsedExplicitEarliest === null ? null : parsedExplicitEarliest + (intent.earliestLocalStartExclusive ? 1 : 0);
  const explicitLatest = intent.latestLocalStartTime ? parseClockMinutes(intent.latestLocalStartTime) : null;
  if (!period && explicitEarliest === null && explicitLatest === null) return undefined;
  const startMinutes = Math.max(periodStart ?? 0, explicitEarliest ?? 0);
  const endMinutes = Math.min(periodEnd ?? 23 * 60 + 59, explicitLatest === null ? 23 * 60 + 59 : explicitLatest + durationMinutes);
  return {endTime: clockFromMinutes(endMinutes), startTime: clockFromMinutes(startMinutes)};
}

function priority(value: unknown): AdaptivePriority {
  const candidate = text(value, 20).toLowerCase();
  if (/urgent|ด่วน/.test(candidate)) return "urgent";
  if (/high|สูง|สำคัญ/.test(candidate)) return "high";
  if (/low|ต่ำ/.test(candidate)) return "low";
  return "medium";
}

function plainMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 20).flatMap(([key, item]) => {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    if (!safeKey || !["boolean", "number", "string"].includes(typeof item)) return [];
    return [[safeKey, typeof item === "string" ? item.slice(0, 200) : item] as const];
  });
  return Object.fromEntries(entries);
}

function sanitizePreferences(value: unknown, base: AdaptiveSchedulingPreferences = DEFAULT_ADAPTIVE_PREFERENCES): AdaptiveSchedulingPreferences {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const preferredInput = data.preferredTimeByCategory && typeof data.preferredTimeByCategory === "object" ?
    data.preferredTimeByCategory as Record<string, unknown> : {};
  const preferredTimeByCategory: AdaptiveSchedulingPreferences["preferredTimeByCategory"] = {...base.preferredTimeByCategory};
  Object.entries(preferredInput).slice(0, 10).forEach(([key, period]) => {
    if (!(ADAPTIVE_ACTIVITY_CATEGORIES as readonly string[]).includes(key) || !period || typeof period !== "object") return;
    const record = period as Record<string, unknown>;
    const startTime = validClock(record.startTime, null);
    const endTime = validClock(record.endTime, null);
    if (startTime && endTime) preferredTimeByCategory[key as AdaptiveActivityCategory] = {endTime, startTime};
  });
  const unavailablePeriods = Array.isArray(data.unavailablePeriods) ? data.unavailablePeriods.slice(0, 30).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const startTime = validClock(record.startTime, null);
    const endTime = validClock(record.endTime, null);
    const days = Array.isArray(record.days) ? [...new Set(record.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))] : [];
    const itemCategory = (ADAPTIVE_ACTIVITY_CATEGORIES as readonly string[]).includes(text(record.category, 40)) ? category(record.category) : undefined;
    return startTime && endTime && days.length ? [{...(itemCategory ? {category: itemCategory} : {}), days, endTime, startTime}] : [];
  }) : base.unavailablePeriods;
  const scoreInput = data.scoreWeights && typeof data.scoreWeights === "object" ? data.scoreWeights as Record<string, unknown> : {};
  const thresholdInput = data.thresholds && typeof data.thresholds === "object" ? data.thresholds as Record<string, unknown> : {};
  const availableDays = Array.isArray(data.availableDays) ?
    [...new Set(data.availableDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))] : base.availableDays;
  const timeZone = text(data.timeZone, 80) || base.timeZone;
  return {
    allowAiSuggestions: typeof data.allowAiSuggestions === "boolean" ? data.allowAiSuggestions : base.allowAiSuggestions,
    allowAutomaticRescheduling: typeof data.allowAutomaticRescheduling === "boolean" ? data.allowAutomaticRescheduling : base.allowAutomaticRescheduling,
    allowBehavioralPersonalization: typeof data.allowBehavioralPersonalization === "boolean" ? data.allowBehavioralPersonalization : base.allowBehavioralPersonalization,
    allowGeminiInsights: typeof data.allowGeminiInsights === "boolean" ? data.allowGeminiInsights : base.allowGeminiInsights,
    availableDays: availableDays.length ? availableDays : base.availableDays,
    earliestSchedulingTime: validClock(data.earliestSchedulingTime, base.earliestSchedulingTime) ?? base.earliestSchedulingTime,
    latestSchedulingTime: validClock(data.latestSchedulingTime, base.latestSchedulingTime) ?? base.latestSchedulingTime,
    maximumDailyWorkMinutes: Math.round(boundedNumber(data.maximumDailyWorkMinutes, 60, 960, base.maximumDailyWorkMinutes)),
    maximumFocusSessionMinutes: Math.round(boundedNumber(data.maximumFocusSessionMinutes, 15, 240, base.maximumFocusSessionMinutes)),
    minimumAutomaticConfidence: boundedNumber(data.minimumAutomaticConfidence, 0.6, 1, base.minimumAutomaticConfidence),
    minimumBreakMinutes: Math.round(boundedNumber(data.minimumBreakMinutes, 5, 120, base.minimumBreakMinutes)),
    notificationsEnabled: typeof data.notificationsEnabled === "boolean" ? data.notificationsEnabled : base.notificationsEnabled,
    preferredTimeByCategory,
    sleepTime: validClock(data.sleepTime, base.sleepTime),
    scoreWeights: {
      burnoutPenalty: boundedNumber(scoreInput.burnoutPenalty, 0, 100, base.scoreWeights.burnoutPenalty),
      categoryPreference: boundedNumber(scoreInput.categoryPreference, 0, 100, base.scoreWeights.categoryPreference),
      completionProbability: boundedNumber(scoreInput.completionProbability, 0, 100, base.scoreWeights.completionProbability),
      deadlineUrgency: boundedNumber(scoreInput.deadlineUrgency, 0, 100, base.scoreWeights.deadlineUrgency),
      postponementPenalty: boundedNumber(scoreInput.postponementPenalty, 0, 100, base.scoreWeights.postponementPenalty),
      priority: boundedNumber(scoreInput.priority, 0, 100, base.scoreWeights.priority),
      userPreference: boundedNumber(scoreInput.userPreference, 0, 100, base.scoreWeights.userPreference),
      workloadPenalty: boundedNumber(scoreInput.workloadPenalty, 0, 100, base.scoreWeights.workloadPenalty),
    },
    thresholds: {
      highObservationCount: Math.round(boundedNumber(thresholdInput.highObservationCount, 8, 100, base.thresholds.highObservationCount)),
      lowObservationCount: Math.round(boundedNumber(thresholdInput.lowObservationCount, 2, 10, base.thresholds.lowObservationCount)),
      mediumObservationCount: Math.round(boundedNumber(thresholdInput.mediumObservationCount, 4, 30, base.thresholds.mediumObservationCount)),
    },
    timeZone: validTimeZone(timeZone) ? timeZone : base.timeZone,
    transitionMinutes: Math.round(boundedNumber(data.transitionMinutes, 0, 120, base.transitionMinutes)),
    unavailablePeriods,
    wakeTime: validClock(data.wakeTime, base.wakeTime),
  };
}

function activityFromDocument(document: QueryDocumentSnapshot<DocumentData> | {id: string; data(): DocumentData}): ActivityRecord {
  const data = document.data();
  const startMs = timestampMs(data.startAt) ?? Date.now();
  const endMs = timestampMs(data.endAt) ?? startMs + 60 * MINUTE_MS;
  const type = text(data.type, 30);
  const attendees = text(data.attendees, 500);
  const inferredFlexible = (type === "activity" || type === "task") && !attendees;
  const durationMinutes = Math.max(15, Math.round((endMs - startMs) / MINUTE_MS));
  return {
    allowAiReschedule: data.allowAiReschedule !== false,
    category: category(data.category || type),
    deadlineMs: timestampMs(data.deadline),
    durationMinutes,
    endMs,
    estimatedDurationMinutes: Math.round(boundedNumber(data.estimatedDurationMinutes, 15, 720, durationMinutes)),
    fixedLocalDate: /^\d{4}-\d{2}-\d{2}$/.test(text(data.fixedLocalDate, 10)) ? text(data.fixedLocalDate, 10) : null,
    googleEventId: text(data.googleEventId, 512),
    id: document.id,
    isFlexible: data.isFlexible === true || (!Object.prototype.hasOwnProperty.call(data, "isFlexible") && inferredFlexible),
    isLocked: data.isLocked === true,
    ownerId: text(data.ownerId, 128),
    priority: priority(data.priority),
    source: text(data.source, 40),
    startMs,
    status: text(data.status, 30),
    title: text(data.title, 160) || "กิจกรรม",
    version: Math.max(0, Math.round(finiteNumber(data.scheduleVersion, 0))),
  };
}

function movable(activity: ActivityRecord) {
  const result = validateMovableScheduleItem(activity);
  if (result.ok) return null;
  const messages = {
    disabled: "กิจกรรมนี้ไม่อนุญาตให้ AI เลื่อนเวลา",
    external: "ไม่สามารถย้ายรายการจาก Google Calendar โดยอัตโนมัติ",
    fixed: "กิจกรรมนี้เป็นรายการแบบ Fixed",
    locked: "กิจกรรมนี้ถูกล็อกไว้",
  };
  return {code: "failed-precondition" as const, message: messages[result.code]};
}

function dayOfWeek(timestamp: number, timeZone: string) {
  const short = new Intl.DateTimeFormat("en-US", {timeZone, weekday: "short"}).format(new Date(timestamp));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

function localHour(timestamp: number, timeZone: string) {
  const hour = new Intl.DateTimeFormat("en-US", {hour: "2-digit", hour12: false, timeZone}).format(new Date(timestamp));
  return Number(hour) % 24;
}

function localDateKey(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).format(new Date(timestamp));
}

function userFacingConflicts(startMs: number, endMs: number, items: EngineScheduleItem[]) {
  return overlappingScheduleItems(startMs, endMs, items)
    .filter((item) => item.kind !== "suggestion")
    .map((item) => ({
      endAt: new Date(item.endMs).toISOString(),
      id: item.id,
      kind: item.kind === "schedule" ? "schedule" as const : "activity" as const,
      startAt: new Date(item.startMs).toISOString(),
      title: item.title || "รายการในตาราง",
    }))
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
}

function localTime(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).format(new Date(timestamp));
}

function verifiedTemporalContext(
  setting: AdaptiveSchedulingPreferences,
  scheduleItems: EngineScheduleItem[],
  requestedScheduleMs?: number,
) {
  const nowMs = Date.now();
  const today = localDateKey(nowMs, setting.timeZone);
  const hour = localHour(nowMs, setting.timeZone);
  const currentTimePeriod = adaptiveTimePeriod(hour);
  const currentMinute = hour * 60 + Number(localTime(nowMs, setting.timeZone).slice(3, 5));
  const latestMinute = Math.min(
    parseClockMinutes(setting.latestSchedulingTime) ?? 22 * 60,
    parseClockMinutes(setting.sleepTime ?? "") ?? 24 * 60,
  );
  const minuteOfDay = (timestamp: number) => {
    const [itemHour, itemMinute] = localTime(timestamp, setting.timeZone).split(":").map(Number);
    return (itemHour % 24) * 60 + itemMinute;
  };
  const remainingIntervals = scheduleItems.flatMap((item) => {
    if (item.endMs <= nowMs) return [];
    const startsToday = localDateKey(item.startMs, setting.timeZone) === today;
    const endsToday = localDateKey(item.endMs, setting.timeZone) === today;
    const activeNow = item.startMs <= nowMs && item.endMs > nowMs;
    if (!startsToday && !endsToday && !activeNow) return [];
    const startMinute = Math.max(currentMinute, item.startMs <= nowMs ? currentMinute : minuteOfDay(item.startMs));
    const endMinute = Math.min(latestMinute, endsToday ? minuteOfDay(item.endMs) : latestMinute);
    return endMinute > startMinute ? [[startMinute, endMinute] as [number, number]] : [];
  }).sort((left, right) => left[0] - right[0]);
  const mergedIntervals: [number, number][] = [];
  remainingIntervals.forEach(([startMinute, endMinute]) => {
    const previous = mergedIntervals[mergedIntervals.length - 1];
    if (!previous || startMinute > previous[1]) mergedIntervals.push([startMinute, endMinute]);
    else previous[1] = Math.max(previous[1], endMinute);
  });
  const todayRemainingBusyMinutes = mergedIntervals.reduce((sum, [startMinute, endMinute]) => sum + endMinute - startMinute, 0);
  const nextSevenDays = scheduleItems.filter((item) => item.endMs > nowMs && item.startMs < nowMs + 7 * DAY_MS);
  const workloadIntervals = nextSevenDays.map((item): [number, number] => [
    Math.max(nowMs, item.startMs),
    Math.min(nowMs + 7 * DAY_MS, item.endMs),
  ]).filter(([startMs, endMs]) => endMs > startMs).sort((left, right) => left[0] - right[0]);
  const mergedWorkload: [number, number][] = [];
  workloadIntervals.forEach(([startMs, endMs]) => {
    const previous = mergedWorkload[mergedWorkload.length - 1];
    if (!previous || startMs > previous[1]) mergedWorkload.push([startMs, endMs]);
    else previous[1] = Math.max(previous[1], endMs);
  });
  return {
    currentDateTime: new Date(nowMs).toISOString(),
    currentTimePeriod,
    currentWorkload: {
      nextSevenDaysMinutes: mergedWorkload.reduce((sum, [startMs, endMs]) => sum + Math.round((endMs - startMs) / MINUTE_MS), 0),
      todayRemainingBusyMinutes,
    },
    localDate: today,
    localDayOfWeek: new Intl.DateTimeFormat("en-US", {timeZone: setting.timeZone, weekday: "long"}).format(new Date(nowMs)),
    localTime: localTime(nowMs, setting.timeZone),
    remainingAvailableTimeToday: Math.max(0, latestMinute - currentMinute - todayRemainingBusyMinutes),
    requestedScheduleDate: requestedScheduleMs ? localDateKey(requestedScheduleMs, setting.timeZone) : null,
    upcomingFixedEvents: nextSevenDays.filter((item) => item.isFixed).slice(0, 20).map((item) => ({
      endAt: new Date(item.endMs).toISOString(),
      startAt: new Date(item.startMs).toISOString(),
    })),
    userTimeZone: setting.timeZone,
  };
}

function patternFromData(data: DocumentData): AdaptiveSchedulingPattern {
  return {
    activityCategory: category(data.activityCategory),
    averageDurationMinutes: finiteNumber(data.averageDurationMinutes, 60),
    averageStartDelayMinutes: finiteNumber(data.averageStartDelayMinutes),
    completionRate: finiteNumber(data.completionRate),
    confidenceLevel: ["high", "insufficient", "low", "medium"].includes(data.confidenceLevel) ? data.confidenceLevel : "insufficient",
    confidenceScore: finiteNumber(data.confidenceScore),
    dayOfWeek: data.dayOfWeek === null ? null : finiteNumber(data.dayOfWeek),
    observationCount: finiteNumber(data.observationCount),
    postponementRate: finiteNumber(data.postponementRate),
    preferredEndHour: finiteNumber(data.preferredEndHour, 10),
    preferredStartHour: finiteNumber(data.preferredStartHour, 9),
    suggestionAcceptanceRate: finiteNumber(data.suggestionAcceptanceRate),
  };
}

function serializeDocument(document: QueryDocumentSnapshot<DocumentData>) {
  const data = document.data();
  return Object.fromEntries(Object.entries({id: document.id, ...data}).map(([key, value]) => {
    const timestamp = value as {toDate?: () => Date};
    if (typeof timestamp?.toDate === "function") return [key, timestamp.toDate().toISOString()];
    return [key, value];
  }));
}

/**
 * The slot to offer for a new activity, relaxing what was asked for only as far
 * as it has to.
 *
 * A request for an exact hour that is already taken used to be a dead end: the
 * user was told to go and pick another time themselves. Now the same search
 * that serves open-ended requests runs again with one constraint loosened at a
 * time, so a clash comes back as a concrete alternative the user can accept in
 * one tap instead of a refusal.
 *
 * Every step calls `findAdaptiveTimeSlots` on a copy of the same request, so
 * conflict checks, availability, workload limits and the learned-pattern
 * scoring all apply exactly as they do on the first attempt -- this is not a
 * second "next free slot" search that ignores what 3a has learned.
 */
export function nearestAvailableSlot(request: AdaptiveSlotRequest, intent: NaturalLanguageIntent) {
  const exact = findAdaptiveTimeSlots(request, 1)[0];
  if (exact) return {slot: exact, unavailableRequest: ""};

  // Nothing to fall back from: the request never named a time or a day.
  if (!request.requiredLocalTimeWindow && !request.requiredLocalDate) return {slot: undefined, unavailableRequest: ""};

  const askedClock = request.requiredLocalTimeWindow?.startTime;
  const askedFor = [
    request.requiredLocalDate ? `วันที่ ${request.requiredLocalDate}` : "",
    askedClock ? `เวลา ${askedClock}` : "",
  ].filter(Boolean).join(" ");

  /** Widen the exact hour to the part of day it sits in, keeping the day. */
  const surroundingPeriod = () => {
    if (!askedClock) return undefined;
    const minutes = parseClockMinutes(askedClock);
    if (minutes === null) return undefined;
    const period: RequestedPeriod = intent.preferredPeriod ?? adaptiveTimePeriod(Math.floor(minutes / 60));
    const window = REQUESTED_PERIOD_WINDOWS[period];
    // Only useful if it is genuinely wider than what already failed.
    return window.startTime === request.requiredLocalTimeWindow?.startTime ? undefined : window;
  };

  // A calendar date the user named is a hard constraint. Widen an exact hour
  // to another free hour on that date, but never silently move a birthday,
  // appointment, exam, or other dated activity to a different day.
  const relaxations: {requiredLocalDate?: string; requiredLocalTimeWindow?: {endTime: string; startTime: string}}[] = request.requiredLocalDate
    ? [
      {requiredLocalDate: request.requiredLocalDate, requiredLocalTimeWindow: surroundingPeriod()},
      {requiredLocalDate: request.requiredLocalDate, requiredLocalTimeWindow: undefined},
    ]
    : [
      {requiredLocalDate: undefined, requiredLocalTimeWindow: surroundingPeriod()},
      {requiredLocalDate: undefined, requiredLocalTimeWindow: undefined},
    ];

  for (const relaxation of relaxations) {
    const slot = findAdaptiveTimeSlots({...request, ...relaxation}, 1)[0];
    if (slot) return {slot, unavailableRequest: askedFor};
  }
  return {slot: undefined, unavailableRequest: ""};
}

export function createAdaptiveSchedulingFunctions({db, geminiApiKey, region}: AdaptiveFactoryOptions) {
  const callableOptions = {
    enforceAppCheck: true,
    maxInstances: 20,
    memory: "256MiB" as const,
    region,
    timeoutSeconds: 60,
  };

  const userRef = (uid: string) => db.collection("users").doc(uid);
  const settingsRef = (uid: string) => userRef(uid).collection("settings").doc("adaptiveScheduling");

  async function preferences(uid: string) {
    const snapshot = await settingsRef(uid).get();
    return sanitizePreferences(snapshot.exists ? snapshot.data() : {});
  }

  async function writePreferences(uid: string, patch: unknown) {
    const reference = settingsRef(uid);
    const current = await reference.get();
    const previous = sanitizePreferences(current.data() ?? {});
    const next = sanitizePreferences(patch, previous);
    await reference.set({
      ...next,
      createdAt: current.exists ? current.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      ownerId: uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: false});
    const validityKeys: (keyof AdaptiveSchedulingPreferences)[] = [
      "availableDays", "earliestSchedulingTime", "latestSchedulingTime", "maximumDailyWorkMinutes",
      "maximumFocusSessionMinutes", "minimumBreakMinutes", "preferredTimeByCategory", "sleepTime",
      "timeZone", "transitionMinutes", "unavailablePeriods", "wakeTime",
    ];
    const validityChanged = validityKeys.some((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
    if (validityChanged) {
      const pending = await userRef(uid).collection("schedulingSuggestions").where("status", "==", "pending").limit(500).get();
      if (!pending.empty) {
        const batch = db.batch();
        pending.docs.forEach((document) => batch.update(document.ref, {
          expiredAt: FieldValue.serverTimestamp(),
          invalidatedReason: "preferences_changed",
          status: "expired",
          updatedAt: FieldValue.serverTimestamp(),
          validUntil: Timestamp.now(),
        }));
        await batch.commit();
      }
    }
    return next;
  }

  async function sendAdaptiveNotification(uid: string, title: string, body: string, data: Record<string, string>) {
    const setting = await preferences(uid);
    if (!setting.notificationsEnabled) return;
    const notificationId = text(data.notificationId, 128) || `adaptive-${Date.now()}`;
    await userRef(uid).collection("notifications").doc(notificationId).set({
      createdAt: FieldValue.serverTimestamp(),
      kind: "schedule",
      message: body.slice(0, 2000),
      ownerId: uid,
      read: false,
      title: title.slice(0, 160),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    const tokens = await userRef(uid).collection("pushTokens").where("active", "==", true).limit(20).get();
    const tokenValues = tokens.docs.map((item) => text(item.data().token, 4096)).filter(Boolean);
    if (!tokenValues.length) return;
    try {
      const response = await getMessaging().sendEachForMulticast({
        android: {notification: {channelId: "adaptive-scheduling"}},
        data,
        notification: {body: body.slice(0, 1000), title: title.slice(0, 160)},
        tokens: tokenValues,
      });
      const invalid = response.responses.flatMap((item, index) => item.success ? [] :
        ["messaging/invalid-registration-token", "messaging/registration-token-not-registered"].includes(item.error?.code ?? "") ? [tokens.docs[index].ref] : []);
      if (invalid.length) {
        const batch = db.batch();
        invalid.forEach((reference) => batch.update(reference, {active: false, updatedAt: FieldValue.serverTimestamp()}));
        await batch.commit();
      }
    } catch (error) {
      console.warn("Adaptive Scheduling push notification failed; Firestore notification was preserved.", {error, uid});
    }
  }

  async function sendAdaptiveNotificationBestEffort(uid: string, title: string, body: string, data: Record<string, string>) {
    try {
      await sendAdaptiveNotification(uid, title, body, data);
    } catch (error) {
      // The schedule transaction has already committed; delivery failures must not make the caller retry it.
      console.warn("Adaptive Scheduling notification could not be completed after a committed schedule change.", {error, uid});
    }
  }

  async function listPatterns(uid: string) {
    const snapshot = await userRef(uid).collection("schedulingPatterns").limit(100).get();
    return snapshot.docs.map((document) => patternFromData(document.data()));
  }

  async function constraints(uid: string, fromMs: number, toMs: number, excludeActivityId?: string) {
    const from = Timestamp.fromMillis(fromMs - DAY_MS);
    const to = Timestamp.fromMillis(toMs + DAY_MS);
    const user = userRef(uid);
    const [scheduleSnapshot, activitySnapshot, suggestionSnapshot] = await Promise.all([
      user.collection("schedules").where("startAt", ">=", from).where("startAt", "<", to).limit(500).get(),
      user.collection("activities").where("startAt", ">=", from).where("startAt", "<", to).limit(500).get(),
      user.collection("schedulingSuggestions").where("status", "==", "pending").limit(100).get(),
    ]);
    const scheduleItems: EngineScheduleItem[] = scheduleSnapshot.docs.flatMap((document) => {
      const data = document.data();
      const startMs = timestampMs(data.startAt);
      const endMs = timestampMs(data.endAt);
      if (startMs === null || endMs === null) return [];
      return [{category: category(data.courseCode || data.title), endMs, id: document.id, isDifficult: true, isFixed: true, kind: "schedule" as const, startMs, title: text(data.title, 120) || text(data.courseName, 120) || "ตารางเรียน"}];
    });
    activitySnapshot.docs.forEach((document) => {
      if (document.id === excludeActivityId) return;
      const item = activityFromDocument(document);
      if (["cancelled", "completed"].includes(item.status)) return;
      scheduleItems.push({
        category: item.category,
        endMs: item.endMs,
        id: item.id,
        isDifficult: ["high", "urgent"].includes(item.priority) || item.durationMinutes >= 90,
        isFixed: !item.isFlexible || item.isLocked,
        kind: "activity",
        startMs: item.startMs,
        title: item.title,
      });
    });
    suggestionSnapshot.docs.forEach((document) => {
      const data = document.data();
      if (text(data.scheduleItemId, 128) === excludeActivityId) return;
      const startMs = timestampMs(data.suggestedStartAt);
      const endMs = timestampMs(data.suggestedEndAt);
      const expiresAt = timestampMs(data.expiresAt) ?? timestampMs(data.validUntil) ?? 0;
      if (startMs === null || endMs === null || endMs <= fromMs || startMs >= toMs || expiresAt <= Date.now()) return;
      scheduleItems.push({
        category: category(data.activityCategory),
        endMs,
        id: `suggestion-${document.id}`,
        isDifficult: false,
        isFixed: true,
        kind: "suggestion",
        startMs,
        title: text(data.taskTitle, 120) || "คำแนะนำที่รอยืนยัน",
      });
    });
    return scheduleItems;
  }

  async function schedulingRequest(
    uid: string,
    activity: ActivityRecord,
    preferredStartMs?: number,
    requiredLocalTimeWindow?: {endTime: string; startTime: string},
    requiredLocalDate?: string,
    allowOutsideAvailability = false,
  ) {
    const setting = await preferences(uid);
    const effectiveRequiredLocalDate = requiredLocalDate ?? activity.fixedLocalDate ?? undefined;
    const durationMinutes = activity.estimatedDurationMinutes || activity.durationMinutes;
    const now = Date.now();
    // An explicit date may be years away. Jump the scan directly to that local
    // day instead of walking every 30-minute slot from today or clipping it to
    // the old 60-day horizon.
    const requestedReferenceMs = effectiveRequiredLocalDate ? Date.parse(`${effectiveRequiredLocalDate}T12:00:00Z`) : Number.NaN;
    const requestedDayStartMs = Number.isNaN(requestedReferenceMs) ? null : zonedDayStart(requestedReferenceMs, setting.timeZone);
    const earliestStartMs = preferredStartMs ?? (requestedDayStartMs === null ? Math.max(now + 15 * MINUTE_MS, activity.startMs - DAY_MS) : Math.max(now + 15 * MINUTE_MS, requestedDayStartMs));
    const horizonMs = requestedDayStartMs === null ? now + 14 * DAY_MS : requestedDayStartMs + DAY_MS;
    const latestEndMs = Math.min(activity.deadlineMs ?? horizonMs, horizonMs);
    const [patterns, scheduleItems] = await Promise.all([
      listPatterns(uid),
      constraints(uid, earliestStartMs, latestEndMs, activity.id),
    ]);
    const request: AdaptiveSlotRequest = {
      allowOutsideAvailability,
      category: activity.category,
      deadlineMs: activity.deadlineMs,
      durationMinutes,
      earliestStartMs,
      latestEndMs,
      patterns,
      preferences: setting,
      priority: activity.priority,
      requiredLocalDate: effectiveRequiredLocalDate,
      requiredLocalTimeWindow,
      scheduleItems,
    };
    return {patterns, request, setting};
  }

  async function proposeNewFlexibleActivity(uid: string, intent: NaturalLanguageIntent, message: string) {
    const setting = await preferences(uid);
    // The model's title goes through the same cleaner as the fallback's, so a
    // model that echoes the whole sentence back still cannot name an activity
    // "ซื้อมังงะวันที่ 1 กันยาให้หน่อย".
    const title = adaptiveTitleFromMessage(text(intent.taskTitle, 160)) || adaptiveTitleFromMessage(message);
    if (!title) return {message: "บอกกิจกรรมที่อยากเพิ่มได้เลย เช่น อ่านบทที่ 4 หรือทำรายงานกลุ่ม"};

    const now = Date.now();
    const durationWasDefaulted = intent.durationMinutes === null;
    const durationMinutes = durationWasDefaulted
      ? Math.min(60, setting.maximumFocusSessionMinutes)
      : Math.round(boundedNumber(intent.durationMinutes, 15, 720, 60));
    const deadlineMs = intent.deadline ? timestampMs(intent.deadline) : null;
    if (deadlineMs !== null && deadlineMs <= now + durationMinutes * MINUTE_MS) {
      return {message: "กำหนดเสร็จที่ระบุใกล้หรือผ่านไปแล้ว ลองบอกวันใหม่ หรือไม่ระบุกำหนดเพื่อให้ระบบหาช่วงว่างภายใน 14 วัน"};
    }

    const activityCategory = intent.activityCategory ?? category(title);
    const placeholderStartMs = now + 15 * MINUTE_MS;
    const activity: ActivityRecord = {
      allowAiReschedule: true,
      category: activityCategory,
      deadlineMs,
      durationMinutes,
      endMs: placeholderStartMs + durationMinutes * MINUTE_MS,
      estimatedDurationMinutes: durationMinutes,
      fixedLocalDate: intent.requestedLocalDate ?? null,
      googleEventId: "",
      id: "__adaptive_new_activity__",
      isFlexible: true,
      isLocked: false,
      ownerId: uid,
      priority: deadlineMs !== null && deadlineMs - now <= 2 * DAY_MS ? "high" : "medium",
      source: "ai",
      startMs: placeholderStartMs,
      status: "planned",
      title,
      version: 0,
    };
    const requestedWindow = requestedWindowForIntent(intent, durationMinutes);
    const {request} = await schedulingRequest(
      uid,
      activity,
      undefined,
      requestedWindow,
      intent.requestedLocalDate ?? undefined,
      Boolean(requestedWindow),
    );
    const nearest = nearestAvailableSlot(request, intent);
    if (!nearest.slot) {
      // Every relaxation was tried and the fortnight really is full, so say so
      // rather than inventing something outside what was asked for.
      const requestedScope = intent.requestedLocalDate ?
        ` ในวันที่ ${intent.requestedLocalDate}${requestedWindow ? ` ช่วง ${requestedWindow.startTime}-${requestedWindow.endTime}` : ""}` : "";
      return {message: requestedScope ?
        `ยังไม่พบช่วงว่างที่พอดีกับกิจกรรมนี้${requestedScope} ลองลดระยะเวลา เลือกวันอื่น หรือปรับเวลาที่พร้อมใช้งาน` :
        "ยังไม่พบช่วงว่างที่พอดีกับกิจกรรมนี้ ลองลดระยะเวลา ขยายกำหนดเสร็จ หรือปรับเวลาที่พร้อมใช้งาน"};
    }
    const {slot, unavailableRequest} = nearest;
    const defaultNote = durationWasDefaulted ? ` ใช้เวลาเริ่มต้น ${durationMinutes} นาทีเพราะยังไม่ได้ระบุระยะเวลา` : "";
    const explanation = unavailableRequest
      ? `${unavailableRequest} ไม่ว่างเพราะชนกับรายการในตาราง จึงเสนอช่วงว่างที่ใกล้ที่สุดที่ผ่านการตรวจแล้วแทน${defaultNote}`
      : requestedWindow
        ? `พบช่วงว่างที่ไม่ชนตารางและตรงกับช่วงเวลาที่คุณขอ${defaultNote}`
        : `พบช่วงว่างที่ไม่ชนตารางและอยู่ในเวลาที่ตั้งไว้${defaultNote}`;
    return {
      proposedActivity: {
        activityCategory,
        deadline: deadlineMs === null ? null : new Date(deadlineMs).toISOString(),
        durationMinutes,
        dateLocked: Boolean(intent.requestedLocalDate),
        endAt: new Date(slot.endMs).toISOString(),
        explanation,
        generatedForTimeZone: setting.timeZone,
        startAt: new Date(slot.startMs).toISOString(),
        title,
        // A clock window written by the user is authoritative even when it is
        // inside the default sleep window. Conflicts are still checked.
        userSelectedTime: Boolean(requestedWindow),
        // Present only when the exact time asked for was taken, so the card can
        // say what it is offering instead of what was requested.
        ...(unavailableRequest ? {unavailableRequest} : {}),
      },
    };
  }

  function deterministicExplanation(activity: ActivityRecord, pattern: AdaptiveSchedulingPattern | undefined, startMs: number, benefit: string, timeZone: string) {
    const oldTime = new Intl.DateTimeFormat("th-TH", {dateStyle: "medium", timeStyle: "short", timeZone}).format(new Date(activity.startMs));
    const newTime = new Intl.DateTimeFormat("th-TH", {dateStyle: "medium", timeStyle: "short", timeZone}).format(new Date(startMs));
    if (!pattern || pattern.observationCount < 3) {
      return `แนะนำย้าย ${activity.title} จาก ${oldTime} เป็น ${newTime} เพราะ${benefit} คำแนะนำนี้อิงจากค่าที่คุณตั้งไว้และยังมีข้อมูลพฤติกรรมไม่เพียงพอ`;
    }
    return `แนะนำย้าย ${activity.title} จาก ${oldTime} เป็น ${newTime} เพราะอัตราทำสำเร็จในรูปแบบที่ใกล้เคียงกันอยู่ที่ ${Math.round(pattern.completionRate * 100)}% จาก ${pattern.observationCount} ครั้ง และ${benefit}`;
  }

  async function geminiExplanation(apiKey: string, facts: Record<string, unknown>, fallback: string) {
    if (!apiKey) return fallback;
    try {
      const result = await geminiInteraction(apiKey, {
        // Wide enough that the thinking budget cannot truncate the explanation
        // the way it silently truncated the parsed intent.
        generation_config: {max_output_tokens: 900, thinking_level: "low"},
        input: `VERIFIED_SCHEDULING_FACTS:\n${JSON.stringify(facts)}`,
        response_format: {
          mime_type: "application/json",
          schema: {properties: {explanation: {maxLength: 600, type: "string"}}, required: ["explanation"], type: "object"},
          type: "text",
        },
        store: false,
        system_instruction: "Write one clear Thai scheduling explanation using only the verified facts. Never invent statistics, dates, conflicts, or user behavior. Do not claim that Gemini selected the time.",
      }, GEMINI_EXPLANATION_TIMEOUT_MS, "adaptiveSchedulingExplanation");
      if (!result.ok) return fallback;
      const output = interactionText(result.payload);
      if (!output) return fallback;
      const parsed = JSON.parse(output) as {explanation?: unknown};
      return text(parsed.explanation, 600) || fallback;
    } catch {
      return fallback;
    }
  }

  async function createSuggestion(
    uid: string,
    activityId: string,
    automatic = false,
    requestedStartMs?: number,
    enrichWithGemini = true,
    requiredLocalTimeWindow?: {endTime: string; startTime: string},
    requiredLocalDate?: string,
  ) {
    const activityReference = userRef(uid).collection("activities").doc(activityId);
    const snapshot = await activityReference.get();
    if (!snapshot.exists) throw new HttpsError("not-found", "ไม่พบงานหรือกิจกรรมที่ต้องการจัดเวลา");
    const activity = activityFromDocument({id: snapshot.id, data: () => snapshot.data() ?? {}});
    const blocked = movable(activity);
    if (blocked) throw new HttpsError(blocked.code, blocked.message);
    const recentSuggestions = await userRef(uid).collection("schedulingSuggestions").orderBy("createdAt", "desc").limit(50).get();
    const sameActivity = recentSuggestions.docs.filter((document) => text(document.data().scheduleItemId, 128) === activity.id);
    const nowMs = Date.now();
    const {patterns, request, setting} = await schedulingRequest(
      uid,
      activity,
      requestedStartMs,
      requiredLocalTimeWindow,
      requiredLocalDate,
      Boolean(requiredLocalTimeWindow),
    );
    if (!setting.allowAiSuggestions) throw new HttpsError("failed-precondition", "ปิดคำแนะนำ Adaptive Scheduling ไว้");
    const existing = sameActivity.find((document) => {
      const data = document.data();
      return data.status === "pending" &&
        (timestampMs(data.expiresAt) ?? 0) > nowMs &&
        (timestampMs(data.suggestedStartAt) ?? 0) >= nowMs + SUGGESTION_MINIMUM_LEAD_MS &&
        finiteNumber(data.originalScheduleVersion, -1) === activity.version;
    });
    if (existing) {
      const data = existing.data();
      const startMs = timestampMs(data.suggestedStartAt) ?? activity.startMs;
      const endMs = timestampMs(data.suggestedEndAt) ?? activity.endMs;
      const stillValid = startMs >= nowMs + SUGGESTION_MINIMUM_LEAD_MS &&
        endMs > startMs &&
        validateCandidateSlot(request, startMs, endMs).ok;
      if (stillValid) {
        return {
          activityCategory: activity.category,
          alternativeOptions: Array.isArray(data.alternativeOptions) ? data.alternativeOptions : [],
          confidence: boundedNumber(data.confidence, 0, 1, 0),
          createdAt: (data.createdAt as Timestamp | undefined)?.toDate?.().toISOString() ?? new Date(nowMs).toISOString(),
          expectedBenefit: text(data.expectedBenefit, 300),
          explanation: text(data.explanation, 600),
          expiresAt: new Date(timestampMs(data.expiresAt) ?? nowMs).toISOString(),
          generatedForLocalDate: text(data.generatedForLocalDate, 20),
          generatedForTimeZone: text(data.generatedForTimeZone, 80) || "Asia/Bangkok",
          id: existing.id,
          mode: data.mode === "automatic" ? "automatic" as const : "suggestion" as const,
          observationCount: Math.max(0, Math.round(finiteNumber(data.observationCount))),
          originalEndAt: new Date(timestampMs(data.originalEndAt) ?? activity.endMs).toISOString(),
          originalStartAt: new Date(timestampMs(data.originalStartAt) ?? activity.startMs).toISOString(),
          reused: true,
          scheduleItemId: activity.id,
          slot: {breakdown: data.scoreBreakdown ?? {}, endMs, expectedBenefit: text(data.expectedBenefit, 300), startMs, totalScore: finiteNumber(data.score)},
          status: "pending" as const,
          suggestedEndAt: new Date(endMs).toISOString(),
          suggestedStartAt: new Date(startMs).toISOString(),
          taskTitle: activity.title,
          validUntil: new Date(timestampMs(data.validUntil) ?? timestampMs(data.expiresAt) ?? nowMs).toISOString(),
        };
      }
      await existing.ref.update({
        expiredAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(nowMs),
        invalidatedReason: "constraints_changed",
        status: "expired",
        updatedAt: FieldValue.serverTimestamp(),
        validUntil: Timestamp.fromMillis(nowMs),
      });
    }
    const rejectedStarts = new Set(sameActivity.filter((document) => document.data().status === "rejected" && (timestampMs(document.data().updatedAt) ?? 0) > Date.now() - 30 * DAY_MS)
      .map((document) => timestampMs(document.data().suggestedStartAt)).filter((value): value is number => value !== null));
    const slots = findAdaptiveTimeSlots(request, 8).filter((slot) => Math.abs(slot.startMs - activity.startMs) >= 15 * MINUTE_MS && !rejectedStarts.has(slot.startMs));
    const selected = requestedStartMs ? slots.find((slot) => slot.startMs === requestedStartMs) : slots[0];
    if (!selected) throw new HttpsError("not-found", "ไม่พบช่วงว่างที่ผ่านเงื่อนไขทั้งหมดก่อนกำหนดส่ง");
    const pattern = patterns
      .filter((item) => item.activityCategory === activity.category)
      .sort((left, right) => right.confidenceScore - left.confidenceScore)[0];
    const confidence = pattern?.confidenceScore ?? (setting.preferredTimeByCategory[activity.category] ? 0.4 : 0.2);
    const fallback = deterministicExplanation(activity, pattern, selected.startMs, selected.expectedBenefit, setting.timeZone);
    const temporalContext = verifiedTemporalContext(setting, request.scheduleItems, selected.startMs);
    const explanation = setting.allowGeminiInsights && enrichWithGemini ? await geminiExplanation(geminiApiKey.value(), {
      activityCategory: activity.category,
      completionRate: pattern?.completionRate ?? null,
      confidence,
      deadline: activity.deadlineMs ? new Date(activity.deadlineMs).toISOString() : null,
      expectedBenefit: selected.expectedBenefit,
      observationCount: pattern?.observationCount ?? 0,
      oldTime: new Date(activity.startMs).toISOString(),
      postponementRate: pattern?.postponementRate ?? null,
      suggestedTime: new Date(selected.startMs).toISOString(),
      taskTitle: activity.title,
      verifiedTemporalContext: temporalContext,
    }, fallback) : fallback;
    const alternativeCandidates = slots.filter((slot) => slot.startMs !== selected.startMs);
    const selectedAlternatives: {label: string; slot: typeof selected; tradeoff: string}[] = [];
    const addAlternative = (slot: typeof selected | undefined, label: string, tradeoff: string) => {
      if (!slot || selectedAlternatives.some((item) => item.slot.startMs === slot.startMs)) return;
      selectedAlternatives.push({label, slot, tradeoff});
    };
    addAlternative(
      [...alternativeCandidates].sort((left, right) => left.startMs - right.startMs)[0],
      "ทางเลือกที่เริ่มได้เร็วที่สุด",
      "เริ่มได้เร็ว แต่คะแนนรวมอาจต่ำกว่าเวลาหลัก",
    );
    addAlternative(
      [...alternativeCandidates].sort((left, right) =>
        left.breakdown.workloadPenalty - right.breakdown.workloadPenalty || right.totalScore - left.totalScore)[0],
      "วันที่ภาระเบากว่า",
      "ลดภาระรวมของวัน แต่อาจต้องเริ่มช้าหรือย้ายไปวันอื่น",
    );
    addAlternative(
      alternativeCandidates.find((slot) => /ตรงกับ|สอดคล้องกับรูปแบบ/.test(slot.expectedBenefit)),
      "ตรงกับช่วงที่คุณถนัด",
      "อิงจากค่าที่ตั้งไว้หรือพฤติกรรมเดิม แต่ไม่ใช่เวลาที่เร็วที่สุด",
    );
    addAlternative(alternativeCandidates[0], "ตัวเลือกที่สมดุล", "คะแนนรวมรองลงมาและยังผ่านเงื่อนไขทั้งหมด");
    const alternativeOptions = selectedAlternatives.slice(0, 3).map(({label, slot, tradeoff}) => ({
      endAt: new Date(slot.endMs).toISOString(),
      expectedBenefit: slot.expectedBenefit,
      label,
      startAt: new Date(slot.startMs).toISOString(),
      tradeoff,
    }));
    const validUntilMs = Math.min(
      nowMs + PENDING_SUGGESTION_TTL_MS,
      Math.max(nowMs + 5 * MINUTE_MS, selected.startMs - 5 * MINUTE_MS),
    );
    const reference = userRef(uid).collection("schedulingSuggestions").doc();
    await reference.set({
      activityCategory: activity.category,
      alternativeOptions,
      basedOnScheduleVersion: activity.version,
      confidence,
      createdAt: FieldValue.serverTimestamp(),
      expectedBenefit: selected.expectedBenefit,
      expiresAt: Timestamp.fromMillis(validUntilMs),
      explanation,
      generatedForLocalDate: localDateKey(selected.startMs, setting.timeZone),
      generatedForTimeZone: setting.timeZone,
      mode: automatic ? "automatic" : "suggestion",
      observationCount: pattern?.observationCount ?? 0,
      originalEndAt: Timestamp.fromMillis(activity.endMs),
      originalScheduleVersion: activity.version,
      originalStartAt: Timestamp.fromMillis(activity.startMs),
      ownerId: uid,
      score: selected.totalScore,
      scoreBreakdown: selected.breakdown,
      scheduleItemId: activity.id,
      status: "pending",
      suggestedEndAt: Timestamp.fromMillis(selected.endMs),
      suggestedStartAt: Timestamp.fromMillis(selected.startMs),
      taskTitle: activity.title,
      updatedAt: FieldValue.serverTimestamp(),
      validUntil: Timestamp.fromMillis(validUntilMs),
    });
    return {
      activityCategory: activity.category,
      alternativeOptions,
      confidence,
      createdAt: new Date(nowMs).toISOString(),
      expectedBenefit: selected.expectedBenefit,
      explanation,
      expiresAt: new Date(validUntilMs).toISOString(),
      generatedForLocalDate: localDateKey(selected.startMs, setting.timeZone),
      generatedForTimeZone: setting.timeZone,
      id: reference.id,
      mode: automatic ? "automatic" as const : "suggestion" as const,
      observationCount: pattern?.observationCount ?? 0,
      originalEndAt: new Date(activity.endMs).toISOString(),
      originalStartAt: new Date(activity.startMs).toISOString(),
      scheduleItemId: activity.id,
      slot: selected,
      status: "pending" as const,
      suggestedEndAt: new Date(selected.endMs).toISOString(),
      suggestedStartAt: new Date(selected.startMs).toISOString(),
      taskTitle: activity.title,
      validUntil: new Date(validUntilMs).toISOString(),
    };
  }

  async function recordEvent(uid: string, data: Record<string, unknown>) {
    const eventType = text(data.eventType, 60) as AdaptiveBehaviorEventType;
    if (!(ADAPTIVE_BEHAVIOR_EVENT_TYPES as readonly string[]).includes(eventType)) {
      throw new HttpsError("invalid-argument", "eventType is invalid.");
    }
    const scheduleItemId = text(data.scheduleItemId, 128);
    if (!scheduleItemId) throw new HttpsError("invalid-argument", "scheduleItemId is required.");
    const [activity, setting] = await Promise.all([
      userRef(uid).collection("activities").doc(scheduleItemId).get(),
      preferences(uid),
    ]);
    if (!activity.exists) throw new HttpsError("not-found", "ไม่พบกิจกรรมที่ต้องการบันทึกพฤติกรรม");
    const item = activityFromDocument({id: activity.id, data: () => activity.data() ?? {}});
    const actualStartMs = timestampMs(data.actualStart) ?? timestampMs(activity.data()?.actualStart);
    const updatedStartMs = timestampMs(data.updatedScheduledStart) ?? item.startMs;
    // A postpone moves the activity first, so by the time this runs the document
    // already holds the new start. The caller has to say what the slot was
    // before it moved, or every postpone would record a move from the new time
    // to itself and the engine would learn nothing from it.
    const claimedOriginalMs = timestampMs(data.originalScheduledStart);
    const originalStartMs = claimedOriginalMs !== null && Math.abs(claimedOriginalMs - Date.now()) <= 366 * DAY_MS
      ? claimedOriginalMs
      : item.startMs;
    const referenceMs = actualStartMs ?? updatedStartMs;
    const reference = userRef(uid).collection("schedulingBehaviorEvents").doc();
    await reference.set({
      activityCategory: item.category,
      actualDurationMinutes: data.actualDurationMinutes === null ? null : boundedNumber(data.actualDurationMinutes, 0, 1440, finiteNumber(activity.data()?.actualDurationMinutes)) || null,
      actualEnd: timestampMs(data.actualEnd) === null ? null : Timestamp.fromMillis(timestampMs(data.actualEnd) as number),
      actualStart: actualStartMs === null ? null : Timestamp.fromMillis(actualStartMs),
      createdAt: FieldValue.serverTimestamp(),
      dayOfWeek: dayOfWeek(referenceMs, setting.timeZone),
      estimatedDurationMinutes: item.estimatedDurationMinutes,
      eventType,
      metadata: plainMetadata(data.metadata),
      originalScheduledStart: Timestamp.fromMillis(originalStartMs),
      ownerId: uid,
      scheduleItemId,
      source: ["ai_suggestion", "automatic_scheduler"].includes(text(data.source, 30)) ? text(data.source, 30) : "user",
      timePeriod: adaptiveTimePeriod(localHour(referenceMs, setting.timeZone)),
      updatedAt: FieldValue.serverTimestamp(),
      updatedScheduledStart: Timestamp.fromMillis(updatedStartMs),
    });
    return reference.id;
  }

  async function calculateUserPatterns(uid: string) {
    const setting = await preferences(uid);
    if (!setting.allowBehavioralPersonalization) return {patterns: 0};
    const snapshot = await userRef(uid).collection("schedulingBehaviorEvents").orderBy("createdAt", "desc").limit(500).get();
    const observations: PatternBehaviorObservation[] = snapshot.docs.map((document) => {
      const data = document.data();
      return {
        actualDurationMinutes: data.actualDurationMinutes === null ? null : finiteNumber(data.actualDurationMinutes),
        actualStartMs: timestampMs(data.actualStart),
        category: category(data.activityCategory),
        eventType: text(data.eventType, 60) as AdaptiveBehaviorEventType,
        originalStartMs: timestampMs(data.originalScheduledStart),
        updatedStartMs: timestampMs(data.updatedScheduledStart),
      };
    }).filter((item) => (ADAPTIVE_BEHAVIOR_EVENT_TYPES as readonly string[]).includes(item.eventType));
    const patterns = calculatePatterns(observations, setting.thresholds, setting.timeZone);
    const existing = await userRef(uid).collection("schedulingPatterns").get();
    const batch = db.batch();
    existing.docs.forEach((document) => batch.delete(document.ref));
    patterns.forEach((pattern) => {
      const id = `${pattern.activityCategory}-${pattern.dayOfWeek ?? "all"}`;
      batch.set(userRef(uid).collection("schedulingPatterns").doc(id), {
        ...pattern,
        lastCalculatedAt: FieldValue.serverTimestamp(),
        ownerId: uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    const best = [...patterns].sort((left, right) => right.confidenceScore - left.confidenceScore)[0];
    batch.set(userRef(uid).collection("productivityInsights").doc("adaptive-summary"), {
      activityCategory: best?.activityCategory ?? "other",
      createdAt: FieldValue.serverTimestamp(),
      kind: "adaptive-summary",
      message: best ? `ช่วงที่ทำ ${best.activityCategory} สำเร็จบ่อยเริ่มประมาณ ${String(best.preferredStartHour).padStart(2, "0")}:00 น.` : "ยังมีข้อมูลไม่พอสำหรับสรุปรูปแบบการทำงาน",
      observationCount: best?.observationCount ?? 0,
      ownerId: uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    await batch.commit();
    return {patterns: patterns.length};
  }

  /**
   * Records the two outcomes nobody presses a button for.
   *
   * `task_skipped` and `reminder_ignored` are the behaviour events that by
   * definition have no user action behind them: the user let a scheduled slot
   * pass, or let a suggestion lapse without answering it. They can only be
   * observed by looking backwards, which is why they are swept here instead of
   * being hooked to a screen the way `task_completed` and `task_postponed` are.
   *
   * Both writes use a document id derived from the thing being judged, so a
   * re-run - a retry, an overlapping schedule, a manual invocation - restates
   * the same event rather than inflating the user's postponement rate. The
   * already-recorded ids are read back first so a repeat run does not push
   * `createdAt` forward and keep the same skip alive in the 2-day window the
   * pattern recalculation reads.
   */
  async function sweepUserOutcomes(uid: string, nowMs: number) {
    const setting = await preferences(uid);
    const fromMs = nowMs - OUTCOME_SWEEP_WINDOW_MS;
    const toMs = nowMs - OUTCOME_SWEEP_GRACE_MS;
    const [activitySnapshot, pendingSnapshot] = await Promise.all([
      userRef(uid).collection("activities")
        .where("endAt", ">=", Timestamp.fromMillis(fromMs))
        .where("endAt", "<", Timestamp.fromMillis(toMs))
        .limit(200).get(),
      userRef(uid).collection("schedulingSuggestions").where("status", "==", "pending").limit(200).get(),
    ]);

    const skipped = activitySnapshot.docs
      .map(activityFromDocument)
      .filter((item) => !["cancelled", "completed"].includes(item.status));
    const lapsed = pendingSnapshot.docs.filter((document) => {
      const expiresAtMs = timestampMs(document.data().expiresAt) ?? timestampMs(document.data().validUntil);
      return expiresAtMs !== null && expiresAtMs <= nowMs;
    });

    const events = userRef(uid).collection("schedulingBehaviorEvents");
    const candidates = [
      ...skipped.map((item) => events.doc(`skipped-${item.id}`)),
      ...lapsed.map((document) => events.doc(`ignored-${document.id}`)),
    ];
    const recorded = candidates.length
      ? new Set((await db.getAll(...candidates)).filter((document) => document.exists).map((document) => document.id))
      : new Set<string>();

    const batch = db.batch();
    let written = 0;
    skipped.forEach((item) => {
      if (recorded.has(`skipped-${item.id}`)) return;
      batch.set(events.doc(`skipped-${item.id}`), {
        activityCategory: item.category,
        actualDurationMinutes: null,
        actualEnd: null,
        actualStart: null,
        createdAt: FieldValue.serverTimestamp(),
        dayOfWeek: dayOfWeek(item.startMs, setting.timeZone),
        estimatedDurationMinutes: item.estimatedDurationMinutes,
        eventType: "task_skipped",
        metadata: {detectedBy: "outcome_sweep", scheduledEndAt: new Date(item.endMs).toISOString()},
        originalScheduledStart: Timestamp.fromMillis(item.startMs),
        ownerId: uid,
        scheduleItemId: item.id,
        source: "automatic_scheduler",
        timePeriod: adaptiveTimePeriod(localHour(item.startMs, setting.timeZone)),
        updatedAt: FieldValue.serverTimestamp(),
        updatedScheduledStart: Timestamp.fromMillis(item.startMs),
      });
      written += 1;
    });
    lapsed.forEach((document) => {
      const data = document.data();
      const suggestedStartMs = timestampMs(data.suggestedStartAt) ?? nowMs;
      const expiresAtMs = timestampMs(data.expiresAt) ?? timestampMs(data.validUntil) ?? nowMs;
      batch.update(document.ref, {
        expiredAt: FieldValue.serverTimestamp(),
        invalidatedReason: "time_elapsed",
        status: "expired",
        updatedAt: FieldValue.serverTimestamp(),
        validUntil: Timestamp.fromMillis(expiresAtMs),
      });
      if (recorded.has(`ignored-${document.id}`)) return;
      batch.set(events.doc(`ignored-${document.id}`), {
        activityCategory: category(data.activityCategory),
        actualDurationMinutes: null,
        actualEnd: null,
        actualStart: null,
        createdAt: FieldValue.serverTimestamp(),
        dayOfWeek: dayOfWeek(suggestedStartMs, setting.timeZone),
        estimatedDurationMinutes: Math.max(15, Math.round(((timestampMs(data.suggestedEndAt) ?? suggestedStartMs) - suggestedStartMs) / MINUTE_MS)),
        eventType: "reminder_ignored",
        metadata: {detectedBy: "outcome_sweep", suggestionId: document.id},
        originalScheduledStart: data.originalStartAt ?? Timestamp.fromMillis(suggestedStartMs),
        ownerId: uid,
        scheduleItemId: text(data.scheduleItemId, 128),
        source: "ai_suggestion",
        timePeriod: adaptiveTimePeriod(localHour(suggestedStartMs, setting.timeZone)),
        updatedAt: FieldValue.serverTimestamp(),
        updatedScheduledStart: data.suggestedStartAt ?? Timestamp.fromMillis(suggestedStartMs),
      });
      written += 1;
    });
    if (!written && !lapsed.length) return {expired: 0, recorded: 0};
    await batch.commit();
    // Nothing else would fold these into completionRate until the next nightly
    // recalculation, and a skip that only counts tomorrow is a skip the user
    // cannot see the effect of.
    if (written) await calculateUserPatterns(uid).catch((error) => console.warn("Pattern recalculation after the outcome sweep failed.", {error, uid}));
    return {expired: lapsed.length, recorded: written};
  }

  async function suggestionTransaction(uid: string, suggestionId: string, automatic: boolean) {
    const suggestionReference = userRef(uid).collection("schedulingSuggestions").doc(suggestionId);
    const result = await db.runTransaction(async (transaction) => {
      const suggestionSnapshot = await transaction.get(suggestionReference);
      if (!suggestionSnapshot.exists) throw new HttpsError("not-found", "ไม่พบคำแนะนำนี้");
      const suggestion = suggestionSnapshot.data() ?? {};
      if (suggestion.status !== "pending") throw new HttpsError("failed-precondition", "คำแนะนำนี้ถูกจัดการแล้ว");
      const expiresAt = timestampMs(suggestion.expiresAt);
      if (expiresAt !== null && expiresAt < Date.now()) throw new HttpsError("failed-precondition", "คำแนะนำนี้หมดอายุแล้ว");
      const activityId = text(suggestion.scheduleItemId, 128);
      const activityReference = userRef(uid).collection("activities").doc(activityId);
      const activitySnapshot = await transaction.get(activityReference);
      if (!activitySnapshot.exists) throw new HttpsError("not-found", "ไม่พบกิจกรรมเดิม");
      const activity = activityFromDocument({id: activitySnapshot.id, data: () => activitySnapshot.data() ?? {}});
      const blocked = movable(activity);
      if (blocked) throw new HttpsError(blocked.code, blocked.message);
      if (activity.version !== finiteNumber(suggestion.originalScheduleVersion) || activity.startMs !== timestampMs(suggestion.originalStartAt)) {
        throw new HttpsError("aborted", "ตารางถูกแก้จากอุปกรณ์อื่น กรุณาสร้างคำแนะนำใหม่");
      }
      const newStartMs = timestampMs(suggestion.suggestedStartAt);
      const newEndMs = timestampMs(suggestion.suggestedEndAt);
      if (newStartMs === null || newEndMs === null) throw new HttpsError("data-loss", "เวลาที่แนะนำไม่สมบูรณ์");
      if (newStartMs < Date.now() + 5 * MINUTE_MS) {
        throw new HttpsError("failed-precondition", "เวลาที่แนะนำผ่านไปหรือใกล้เกินไปแล้ว กรุณาสร้างคำแนะนำใหม่");
      }
      const settingSnapshot = await transaction.get(settingsRef(uid));
      const setting = sanitizePreferences(settingSnapshot.data() ?? {});
      if (automatic && (!setting.allowAutomaticRescheduling || finiteNumber(suggestion.confidence) < setting.minimumAutomaticConfidence)) {
        throw new HttpsError("failed-precondition", "ยังไม่ผ่านเกณฑ์การเลื่อนอัตโนมัติ");
      }
      const dayStart = newStartMs - DAY_MS;
      const dayEnd = newEndMs + DAY_MS;
      const schedulesQuery = userRef(uid).collection("schedules")
        .where("startAt", ">=", Timestamp.fromMillis(dayStart)).where("startAt", "<", Timestamp.fromMillis(dayEnd)).limit(300);
      const activitiesQuery = userRef(uid).collection("activities")
        .where("startAt", ">=", Timestamp.fromMillis(dayStart)).where("startAt", "<", Timestamp.fromMillis(dayEnd)).limit(300);
      const scheduleSnapshot = await transaction.get(schedulesQuery);
      const activityConstraintsSnapshot = await transaction.get(activitiesQuery);
      const scheduleItems: EngineScheduleItem[] = [];
      scheduleSnapshot.docs.forEach((document) => {
        const data = document.data();
        const startMs = timestampMs(data.startAt);
        const endMs = timestampMs(data.endAt);
        if (startMs !== null && endMs !== null) scheduleItems.push({category: "study", endMs, id: document.id, isDifficult: true, isFixed: true, startMs});
      });
      activityConstraintsSnapshot.docs.forEach((document) => {
        if (document.id === activity.id) return;
        const item = activityFromDocument(document);
        if (["cancelled", "completed"].includes(item.status)) return;
        scheduleItems.push({category: item.category, endMs: item.endMs, id: item.id, isDifficult: ["high", "urgent"].includes(item.priority), isFixed: !item.isFlexible || item.isLocked, startMs: item.startMs});
      });
      const validation = validateCandidateSlot({
        category: activity.category,
        deadlineMs: activity.deadlineMs,
        durationMinutes: Math.round((newEndMs - newStartMs) / MINUTE_MS),
        earliestStartMs: newStartMs,
        latestEndMs: newEndMs,
        patterns: [],
        preferences: setting,
        priority: activity.priority,
        scheduleItems,
      }, newStartMs, newEndMs);
      if (!validation.ok) throw new HttpsError("failed-precondition", validation.message ?? "ช่วงเวลานี้ไม่ผ่านการตรวจสอบ");
      const historyReference = userRef(uid).collection("scheduleChangeHistory").doc();
      const eventReference = userRef(uid).collection("schedulingBehaviorEvents").doc();
      const notificationReference = userRef(uid).collection("notifications").doc(`adaptive-${suggestionId}-accepted`);
      const nextVersion = activity.version + 1;
      transaction.set(historyReference, {
        actionLabel: automatic ? "Adaptive AI ปรับตารางอัตโนมัติ" : "ผู้ใช้ยืนยันคำแนะนำ Adaptive AI",
        actor: automatic ? "adaptive_ai" : "user",
        automatic,
        canUndoUntil: Timestamp.fromMillis(Date.now() + PENDING_SUGGESTION_TTL_MS),
        createdAt: FieldValue.serverTimestamp(),
        newEndAt: Timestamp.fromMillis(newEndMs),
        newScheduleVersion: nextVersion,
        newStartAt: Timestamp.fromMillis(newStartMs),
        ownerId: uid,
        previousEndAt: Timestamp.fromMillis(activity.endMs),
        previousScheduleVersion: activity.version,
        previousStartAt: Timestamp.fromMillis(activity.startMs),
        reason: text(suggestion.explanation, 600),
        scheduleItemId: activity.id,
        source: automatic ? "automatic_scheduler" : "confirmed_suggestion",
        status: "applied",
        suggestionId,
        syncStatus: activity.googleEventId ? "pending" : "not_required",
        taskTitle: activity.title,
        timeZone: setting.timeZone,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(activityReference, {
        aiConfidence: boundedNumber(suggestion.confidence, 0, 1, 0),
        aiReason: text(suggestion.explanation, 600),
        aiScheduled: true,
        googleSyncStatus: activity.googleEventId ? "pending" : "not_required",
        originalScheduledStart: activitySnapshot.data()?.originalScheduledStart ?? Timestamp.fromMillis(activity.startMs),
        scheduleVersion: nextVersion,
        startAt: Timestamp.fromMillis(newStartMs),
        endAt: Timestamp.fromMillis(newEndMs),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(suggestionReference, {acceptedAt: FieldValue.serverTimestamp(), status: "accepted", updatedAt: FieldValue.serverTimestamp()});
      transaction.set(eventReference, {
        activityCategory: activity.category,
        actualDurationMinutes: null,
        actualEnd: null,
        actualStart: null,
        createdAt: FieldValue.serverTimestamp(),
        dayOfWeek: dayOfWeek(newStartMs, setting.timeZone),
        estimatedDurationMinutes: activity.estimatedDurationMinutes,
        eventType: "suggestion_accepted",
        metadata: {suggestionId},
        originalScheduledStart: Timestamp.fromMillis(activity.startMs),
        ownerId: uid,
        scheduleItemId: activity.id,
        source: automatic ? "automatic_scheduler" : "ai_suggestion",
        timePeriod: adaptiveTimePeriod(localHour(newStartMs, setting.timeZone)),
        updatedAt: FieldValue.serverTimestamp(),
        updatedScheduledStart: Timestamp.fromMillis(newStartMs),
      });
      transaction.set(notificationReference, {
        createdAt: FieldValue.serverTimestamp(), kind: "schedule", message: `ย้าย ${activity.title} ไปยังเวลาที่ผ่านการตรวจสอบแล้ว`,
        ownerId: uid, read: false, title: automatic ? "ปรับตารางอัตโนมัติแล้ว" : "ปรับตารางแล้ว", updatedAt: FieldValue.serverTimestamp(),
      });
      return {activityId: activity.id, historyId: historyReference.id, newEndMs, newStartMs, title: activity.title};
    });
    await sendAdaptiveNotificationBestEffort(uid, automatic ? "ปรับตารางอัตโนมัติแล้ว" : "ปรับตารางแล้ว", `ย้าย ${result.title} ไปยังเวลาที่แนะนำแล้ว แตะเพื่อดูหรือย้อนกลับ`, {
      historyId: result.historyId,
      notificationId: `adaptive-${suggestionId}-accepted`,
      route: "/user/smartlife_adaptive_scheduling",
      suggestionId,
      type: "adaptive_schedule_changed",
    });
    return result;
  }

  async function rejectSuggestion(uid: string, suggestionId: string) {
    const reference = userRef(uid).collection("schedulingSuggestions").doc(suggestionId);
    const setting = await preferences(uid);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new HttpsError("not-found", "ไม่พบคำแนะนำนี้");
      const data = snapshot.data() ?? {};
      if (data.status !== "pending") throw new HttpsError("failed-precondition", "คำแนะนำนี้ถูกจัดการแล้ว");
      const activityId = text(data.scheduleItemId, 128);
      const eventReference = userRef(uid).collection("schedulingBehaviorEvents").doc();
      transaction.update(reference, {rejectedAt: FieldValue.serverTimestamp(), status: "rejected", updatedAt: FieldValue.serverTimestamp()});
      transaction.set(eventReference, {
        activityCategory: category(data.activityCategory), actualDurationMinutes: null, actualEnd: null, actualStart: null,
        createdAt: FieldValue.serverTimestamp(), dayOfWeek: dayOfWeek(timestampMs(data.suggestedStartAt) ?? Date.now(), setting.timeZone),
        estimatedDurationMinutes: Math.max(15, Math.round(((timestampMs(data.suggestedEndAt) ?? 0) - (timestampMs(data.suggestedStartAt) ?? 0)) / MINUTE_MS)),
        eventType: "suggestion_rejected", metadata: {suggestionId}, originalScheduledStart: data.originalStartAt ?? null,
        ownerId: uid, scheduleItemId: activityId, source: "ai_suggestion", timePeriod: adaptiveTimePeriod(localHour(timestampMs(data.suggestedStartAt) ?? Date.now(), setting.timeZone)),
        updatedAt: FieldValue.serverTimestamp(), updatedScheduledStart: data.suggestedStartAt ?? null,
      });
    });
    return {ok: true};
  }

  async function alternativeTime(uid: string, suggestionId: string, startMs: number) {
    const reference = userRef(uid).collection("schedulingSuggestions").doc(suggestionId);
    const suggestion = await reference.get();
    if (!suggestion.exists || suggestion.data()?.status !== "pending") throw new HttpsError("failed-precondition", "คำแนะนำนี้ไม่พร้อมแก้ไข");
    const activityId = text(suggestion.data()?.scheduleItemId, 128);
    const activitySnapshot = await userRef(uid).collection("activities").doc(activityId).get();
    if (!activitySnapshot.exists) throw new HttpsError("not-found", "ไม่พบกิจกรรมเดิม");
    const activity = activityFromDocument({id: activitySnapshot.id, data: () => activitySnapshot.data() ?? {}});
    if (startMs < Date.now() + SUGGESTION_MINIMUM_LEAD_MS) {
      throw new HttpsError("failed-precondition", "กรุณาเลือกเวลาอย่างน้อย 10 นาทีจากเวลาปัจจุบัน");
    }
    const {request, setting} = await schedulingRequest(uid, activity, startMs);
    const endMs = startMs + activity.estimatedDurationMinutes * MINUTE_MS;
    const validation = validateCandidateSlot(request, startMs, endMs);
    if (!validation.ok) throw new HttpsError("failed-precondition", validation.message ?? "ช่วงเวลานี้ใช้ไม่ได้");
    const validUntilMs = Math.min(Date.now() + PENDING_SUGGESTION_TTL_MS, startMs - 5 * MINUTE_MS);
    await db.runTransaction(async (transaction) => {
      const freshSuggestion = await transaction.get(reference);
      const freshSuggestionData = freshSuggestion.data() ?? {};
      if (!freshSuggestion.exists || freshSuggestionData.status !== "pending") {
        throw new HttpsError("failed-precondition", "คำแนะนำนี้ถูกยืนยัน ปฏิเสธ หรือหมดอายุแล้ว");
      }
      const transactionNowMs = Date.now();
      const freshExpiresAtMs = timestampMs(freshSuggestionData.expiresAt);
      const freshValidUntilMs = timestampMs(freshSuggestionData.validUntil);
      if (freshExpiresAtMs === null || freshValidUntilMs === null ||
          freshExpiresAtMs <= transactionNowMs || freshValidUntilMs <= transactionNowMs) {
        throw new HttpsError("failed-precondition", "คำแนะนำนี้หมดอายุแล้ว กรุณาสร้างคำแนะนำใหม่");
      }
      const freshActivity = await transaction.get(userRef(uid).collection("activities").doc(activityId));
      if (!freshActivity.exists) throw new HttpsError("not-found", "ไม่พบกิจกรรมเดิม");
      const freshActivityData = freshActivity.data() ?? {};
      if (finiteNumber(freshActivityData.scheduleVersion) !== finiteNumber(freshSuggestionData.originalScheduleVersion) ||
          timestampMs(freshActivityData.startAt) !== timestampMs(freshSuggestionData.originalStartAt)) {
        throw new HttpsError("aborted", "ตารางเปลี่ยนแล้ว กรุณาสร้างคำแนะนำใหม่ก่อนเลือกเวลาอื่น");
      }
      if (startMs < Date.now() + SUGGESTION_MINIMUM_LEAD_MS) {
        throw new HttpsError("failed-precondition", "เวลาที่เลือกใกล้หรือผ่านไปแล้ว กรุณาเลือกเวลาใหม่");
      }
      transaction.update(reference, {
        expectedBenefit: "ช่วงเวลาที่ผู้ใช้เลือกและผ่านการตรวจสอบ deterministic",
        expiresAt: Timestamp.fromMillis(validUntilMs),
        suggestedEndAt: Timestamp.fromMillis(endMs),
        suggestedStartAt: Timestamp.fromMillis(startMs),
        updatedAt: FieldValue.serverTimestamp(),
        userModified: true,
        validUntil: Timestamp.fromMillis(validUntilMs),
      });
      // Overriding the proposed time is neither accepting nor rejecting it, and
      // it is not the user postponing their own work either - it only tells the
      // engine the hour it picked was not the hour the user wanted.
      transaction.set(userRef(uid).collection("schedulingBehaviorEvents").doc(`modified-${suggestionId}`), {
        activityCategory: activity.category,
        actualDurationMinutes: null,
        actualEnd: null,
        actualStart: null,
        createdAt: FieldValue.serverTimestamp(),
        dayOfWeek: dayOfWeek(startMs, setting.timeZone),
        estimatedDurationMinutes: activity.estimatedDurationMinutes,
        eventType: "suggestion_modified",
        metadata: {suggestionId},
        originalScheduledStart: Timestamp.fromMillis(timestampMs(freshSuggestionData.suggestedStartAt) ?? activity.startMs),
        ownerId: uid,
        scheduleItemId: activityId,
        source: "user",
        timePeriod: adaptiveTimePeriod(localHour(startMs, setting.timeZone)),
        updatedAt: FieldValue.serverTimestamp(),
        updatedScheduledStart: Timestamp.fromMillis(startMs),
      });
    });
    return {endAt: new Date(endMs).toISOString(), startAt: new Date(startMs).toISOString()};
  }

  async function parseNaturalLanguage(
    apiKey: string,
    message: string,
    temporalContext: ReturnType<typeof verifiedTemporalContext>,
  ): Promise<{intent: NaturalLanguageIntent; usedGemini: boolean}> {
    // The reason is logged so a silent regression back to the regex parser is
    // visible in the function logs instead of only in a wrong suggestion.
    const fallback = (reason: string) => {
      console.warn("processNaturalLanguageScheduleCommand: parsing fell back to the deterministic reader.", {
        messageLength: message.length,
        reason,
      });
      return {intent: fallbackAdaptiveNaturalLanguageIntent(message, temporalContext), usedGemini: false};
    };
    if (!apiKey) return fallback("missing-api-key");
    try {
      const result = await geminiInteraction(apiKey, {
          // Thought tokens are spent out of max_output_tokens, so "medium" plus a
        // 450-token ceiling returned JSON that stopped mid-object on every
        // request; JSON.parse threw and the old code silently answered from the
        // regex reader instead. "low" matches the assistant chat, which is the
        // one Gemini configuration this project has seen work, and the wider
        // ceiling keeps a longer answer from being cut off again.
        generation_config: {max_output_tokens: 1_200, thinking_level: "low"},
          input: JSON.stringify({message, verifiedTemporalContext: temporalContext}),
          response_format: {
            mime_type: "application/json",
            schema: {
              properties: {
                activityCategory: {enum: [...ADAPTIVE_ACTIVITY_CATEGORIES, null], type: ["string", "null"]},
                deadline: {type: ["string", "null"]},
                durationMinutes: {maximum: 720, minimum: 15, type: ["integer", "null"]},
                earliestLocalStartExclusive: {type: "boolean"},
                earliestLocalStartTime: {pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$", type: ["string", "null"]},
                intent: {enum: ["create_activity", "explain_move", "find_time", "productivity", "rebalance_day", "rebalance_week", "set_preference", "unknown"], type: "string"},
                latestLocalStartTime: {pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$", type: ["string", "null"]},
                preferredPeriod: {enum: ["afternoon", "early_morning", "evening", "late_morning", "morning", "night", "noon", null], type: ["string", "null"]},
                preferenceMode: {enum: ["avoid", "prefer", null], type: ["string", "null"]},
                requestedLocalDate: {pattern: "^\\d{4}-\\d{2}-\\d{2}$", type: ["string", "null"]},
                requiresConfirmation: {type: "boolean"},
                taskTitle: {maxLength: 160, type: ["string", "null"]},
              },
              required: ["activityCategory", "deadline", "durationMinutes", "earliestLocalStartExclusive", "earliestLocalStartTime", "intent", "latestLocalStartTime", "preferredPeriod", "preferenceMode", "requestedLocalDate", "requiresConfirmation", "taskTitle"],
              type: "object",
            },
            type: "text",
          },
          store: false,
          system_instruction: "Convert the user's Thai or English adaptive scheduling request into the exact schema by meaning, not by requiring command keywords. The verifiedTemporalContext is authoritative server context. In this scheduling interface, a concrete standalone activity such as 'อ่านหนังสือทบทวนบทเรียน', 'finish the report', or 'ออกกำลังกาย' means create_activity even without command words. A broad topic alone such as 'การเรียน', 'การเงิน', 'เวลา', 'การนอน', or 'งาน' is unknown so the general assistant can answer it. Use find_time when the user clearly refers to placing or moving an existing task. Read-only questions about saved data are unknown. Use preferenceMode=avoid for negative preferences and prefer for positive preferences. Extract taskTitle only from the user's activity words; remove weekday, date, duration, and timing phrases, and remove polite filler such as 'ให้หน่อย', 'หน่อยนะ', 'จัดให้ที', 'ช่วย', 'ที', 'ด้วย', 'ครับ' and 'ค่ะ'. taskTitle is the activity alone, for example 'ซื้อมังงะวันที่ 1 กันยาให้หน่อย' has taskTitle 'ซื้อมังงะ'; never echo the user's whole sentence back as the title. Preserve explicit clock semantics exactly: 'หลัง/after 7 PM' means earliestLocalStartTime='19:00' and earliestLocalStartExclusive=true, so 19:00 itself is invalid; 'ตั้งแต่/from 7 PM' means the same clock with earliestLocalStartExclusive=false; 'ก่อน/by 7 PM' means latestLocalStartTime='19:00'; an exact 'ตอน/at 7 PM' sets both clock fields to '19:00' and exclusive=false. Never reduce an explicit clock to only a broad preferredPeriod. Convert Thai and English durations faithfully: '1 ชั่วโมงครึ่ง' and '1 hour and a half' are 90 minutes. Treat เที่ยง/noon/midday as exactly 12:00 PM by default: set both local start-time fields to '12:00' and preferredPeriod='noon'. Treat เที่ยงคืน/midnight as exactly 00:00, never 12:00, and use preferredPeriod='night'. Resolve a named weekday to the next matching local calendar date from verifiedTemporalContext.localDate, and resolve relative day words the same way: วันนี้/today and any 'this morning/afternoon/evening/tonight' form such as เช้านี้, บ่ายนี้, เย็นนี้ or คืนนี้ are verifiedTemporalContext.localDate itself, พรุ่งนี้/tomorrow is the next day, and มะรืนนี้ is two days later. Resolve an explicit calendar date into requestedLocalDate as well: 'วันที่ 1 กันยายน', '1 ก.ย.', '1 กันยา', '1/9', 'Sep 1' and '2026-09-01' all mean the first of September, using the year from verifiedTemporalContext.localDate when none is written and rolling to the next year only if that date has already passed. Convert a Thai Buddhist year by subtracting 543, so 2569 is 2026. An explicit calendar date always outranks a weekday word, a relative day word, and any default. The server deterministically recalculates explicit calendar dates, named weekdays, relative day words, noon, and midnight after model output, so do not guess dates. Never move an explicit calendar date, requested weekday, or requested relative day to another day merely because another slot scores higher; birthdays and similar dated events must stay on their requested date and only their time may be optimized. preferredPeriod may also be present, but exact clock fields and requestedLocalDate take priority. Never invent a deadline, title, duration, preference, date, or time; missing values must be null because the app supplies transparent defaults. Never resolve a requested time into the past. All schedule changes require confirmation.",
      }, GEMINI_PARSE_TIMEOUT_MS, "processNaturalLanguageScheduleCommand");
      if (!result.ok) return fallback("request-failed");
      const output = interactionText(result.payload);
      if (!output) return fallback("empty-output");
      // A truncated answer is still well-formed text, so it only shows up as a
      // parse error. Name it, rather than reporting a bare SyntaxError.
      let decoded: unknown;
      try {
        decoded = JSON.parse(output);
      } catch {
        return fallback(`unparseable-output:${output.length}-chars`);
      }
      const parsed = validateGeminiNaturalLanguageIntent(decoded);
      if (!parsed) return fallback("invalid-intent");
      return {intent: applyDeterministicTemporalSemantics(parsed, message, temporalContext), usedGemini: true};
    } catch (error) {
      return fallback(error instanceof Error ? `${error.name}` : "unknown-error");
    }
  }

  async function dashboard(uid: string) {
    const user = userRef(uid);
    const now = Timestamp.now();
    const weekEnd = Timestamp.fromMillis(Date.now() + 7 * DAY_MS);
    const [setting, suggestions, patterns, history, insights, activities] = await Promise.all([
      preferences(uid),
      user.collection("schedulingSuggestions").where("status", "==", "pending").orderBy("createdAt", "desc").limit(20).get(),
      user.collection("schedulingPatterns").limit(100).get(),
      user.collection("scheduleChangeHistory").orderBy("createdAt", "desc").limit(20).get(),
      user.collection("productivityInsights").orderBy("updatedAt", "desc").limit(20).get(),
      user.collection("activities").where("startAt", ">=", now).where("startAt", "<", weekEnd).limit(200).get(),
    ]);
    const daily = new Map<string, number>();
    activities.docs.forEach((document) => {
      const item = activityFromDocument(document);
      if (["cancelled", "completed"].includes(item.status)) return;
      const key = new Intl.DateTimeFormat("en-CA", {timeZone: setting.timeZone}).format(new Date(item.startMs));
      daily.set(key, (daily.get(key) ?? 0) + item.durationMinutes);
    });
    const currentMs = Date.now();
    const staleSuggestions = suggestions.docs.filter((item) => {
      const data = item.data();
      return (timestampMs(data.expiresAt) ?? Infinity) <= currentMs ||
        (timestampMs(data.suggestedStartAt) ?? 0) < currentMs + 5 * MINUTE_MS ||
        (text(data.generatedForTimeZone, 80) && text(data.generatedForTimeZone, 80) !== setting.timeZone);
    });
    if (staleSuggestions.length) {
      const batch = db.batch();
      staleSuggestions.forEach((document) => batch.update(document.ref, {
        expiredAt: FieldValue.serverTimestamp(),
        invalidatedReason: text(document.data().generatedForTimeZone, 80) !== setting.timeZone ? "time_zone_changed" : "time_elapsed",
        status: "expired",
        updatedAt: FieldValue.serverTimestamp(),
        validUntil: Timestamp.now(),
      }));
      await batch.commit();
    }
    const staleIds = new Set(staleSuggestions.map((document) => document.id));
    return {
      dailyWorkload: [...daily.entries()].map(([date, minutes]) => ({date, highWorkload: minutes > setting.maximumDailyWorkMinutes * 0.85, minutes})),
      history: history.docs.map(serializeDocument),
      insights: insights.docs.map(serializeDocument),
      patterns: patterns.docs.map(serializeDocument),
      preferences: setting,
      serverNow: new Date().toISOString(),
      suggestions: suggestions.docs.filter((item) => !staleIds.has(item.id)).map(serializeDocument),
      weeklyWorkloadMinutes: [...daily.values()].reduce((sum, value) => sum + value, 0),
    };
  }

  async function createFastSuggestions(uid: string, items: ActivityRecord[], limit = 3) {
    const suggestions: Awaited<ReturnType<typeof createSuggestion>>[] = [];
    let attempted = 0;
    while (attempted < items.length && suggestions.length < limit) {
      const item = items[attempted];
      attempted += 1;
      try {
        // Sequential planning lets each newly persisted pending suggestion
        // reserve its slot before the next activity is evaluated.
        suggestions.push(await createSuggestion(uid, item.id, false, undefined, false));
      } catch (error) {
        console.info("Adaptive suggestion candidate skipped.", {activityId: item.id, error, uid});
      }
    }
    return {attempted, suggestions: suggestions.slice(0, limit)};
  }

  async function createDayRebalanceSuggestions(uid: string, targetMs: number) {
    const setting = await preferences(uid);
    const dayStart = zonedDayStart(targetMs, setting.timeZone);
    const dayEnd = zonedDayStart(dayStart, setting.timeZone, 1);
    const snapshot = await userRef(uid).collection("activities")
      .where("startAt", ">=", Timestamp.fromMillis(dayStart))
      .where("startAt", "<", Timestamp.fromMillis(dayEnd)).limit(100).get();
    const items = snapshot.docs.map(activityFromDocument).filter((item) => item.isFlexible && !item.isLocked && item.allowAiReschedule)
      .filter((item) => !["cancelled", "completed"].includes(item.status))
      .sort((left, right) => ({low: 0, medium: 1, high: 2, urgent: 3}[right.priority] - {low: 0, medium: 1, high: 2, urgent: 3}[left.priority]) ||
        (left.deadlineMs ?? Number.MAX_SAFE_INTEGER) - (right.deadlineMs ?? Number.MAX_SAFE_INTEGER));
    return (await createFastSuggestions(uid, items, 3)).suggestions;
  }

  async function createWeekRebalanceSuggestions(uid: string, targetMs: number) {
    const setting = await preferences(uid);
    const weekStart = zonedDayStart(targetMs, setting.timeZone);
    const weekEnd = zonedDayStart(weekStart, setting.timeZone, 7);
    const [snapshot, scheduleItems] = await Promise.all([
      userRef(uid).collection("activities")
        .where("startAt", ">=", Timestamp.fromMillis(weekStart)).where("startAt", "<", Timestamp.fromMillis(weekEnd)).limit(200).get(),
      constraints(uid, weekStart, weekEnd),
    ]);
    const workloadByDay = new Map<string, number>();
    scheduleItems.forEach((item) => {
      const key = localDateKey(item.startMs, setting.timeZone);
      workloadByDay.set(key, (workloadByDay.get(key) ?? 0) + Math.max(0, Math.round((item.endMs - item.startMs) / MINUTE_MS)));
    });
    const priorityWeight = {high: 2, low: 0, medium: 1, urgent: 3};
    const candidates = snapshot.docs.map(activityFromDocument)
      .filter((item) => item.isFlexible && !item.isLocked && item.allowAiReschedule && !["cancelled", "completed"].includes(item.status))
      .sort((left, right) => {
        const workloadDifference = (workloadByDay.get(localDateKey(right.startMs, setting.timeZone)) ?? 0) -
          (workloadByDay.get(localDateKey(left.startMs, setting.timeZone)) ?? 0);
        return workloadDifference || priorityWeight[right.priority] - priorityWeight[left.priority] ||
          (left.deadlineMs ?? Number.MAX_SAFE_INTEGER) - (right.deadlineMs ?? Number.MAX_SAFE_INTEGER);
      });
    return (await createFastSuggestions(uid, candidates.slice(0, 6), 3)).suggestions;
  }

  async function activateAdaptiveForUser(uid: string) {
    const setting = await writePreferences(uid, {allowAiSuggestions: true});
    const nowMs = Date.now();
    const snapshot = await userRef(uid).collection("activities").where("status", "==", "planned").limit(150).get();
    const priorityWeight = {high: 2, low: 0, medium: 1, urgent: 3};
    const candidates = snapshot.docs.map(activityFromDocument)
      .filter((item) => item.isFlexible && !item.isLocked && item.allowAiReschedule)
      .filter((item) => item.startMs < nowMs + 7 * DAY_MS || (item.deadlineMs !== null && item.deadlineMs < nowMs + 14 * DAY_MS))
      .sort((left, right) => {
        const leftOverdue = left.startMs < nowMs ? 1 : 0;
        const rightOverdue = right.startMs < nowMs ? 1 : 0;
        return rightOverdue - leftOverdue || priorityWeight[right.priority] - priorityWeight[left.priority] ||
          (left.deadlineMs ?? Number.MAX_SAFE_INTEGER) - (right.deadlineMs ?? Number.MAX_SAFE_INTEGER);
      });
    const result = await createFastSuggestions(uid, candidates.slice(0, 6), 3);
    const suggestions = result.suggestions;
    return {
      diagnostics: {
        eligibleActivities: candidates.length,
        skippedActivities: Math.max(0, result.attempted - suggestions.length),
      },
      enabled: setting.allowAiSuggestions,
      suggestions,
    };
  }

  const createAdaptiveActivity = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    const allowOverlap = request.data?.allowOverlap === true;
    const userSelectedTime = request.data?.userSelectedTime === true;
    const clientRequestId = text(request.data?.clientRequestId, 256);
    const requestKey = clientRequestId ? Buffer.from(clientRequestId).toString("base64url") : "";
    const activityCollection = userRef(uid).collection("activities");
    const eventCollection = userRef(uid).collection("schedulingBehaviorEvents");
    const activityReference = requestKey ? activityCollection.doc(`adaptive-create-${requestKey}`) : activityCollection.doc();
    const eventReference = requestKey ? eventCollection.doc(`adaptive-create-${requestKey}-event`) : eventCollection.doc();
    const committedResult = (data: DocumentData) => {
      const existingStartMs = timestampMs(data.startAt);
      const existingEndMs = timestampMs(data.endAt);
      if (data.ownerId !== uid || (clientRequestId && text(data.clientRequestId, 256) !== clientRequestId) || existingStartMs === null || existingEndMs === null) {
        throw new HttpsError("data-loss", "พบข้อมูลคำขอสร้างกิจกรรมเดิมที่ไม่สอดคล้องกัน");
      }
      return {
        adjusted: false,
        conflicts: [],
        endAt: new Date(existingEndMs).toISOString(),
        id: activityReference.id,
        requiresConflictConfirmation: false,
        saved: true,
        startAt: new Date(existingStartMs).toISOString(),
      };
    };
    // A client can lose the response after commit. Return that exact committed result before validating a now-stale slot.
    if (clientRequestId) {
      const existing = await activityReference.get();
      if (existing.exists) return committedResult(existing.data() ?? {});
    }
    const title = text(request.data?.title, 120);
    const requestedStartMs = timestampMs(request.data?.startAt);
    const requestedEndMs = timestampMs(request.data?.endAt);
    const deadlineMs = request.data?.deadline === null || request.data?.deadline === undefined ? null : timestampMs(request.data.deadline);
    const activityCategory = category(request.data?.activityCategory);
    const dateLocked = request.data?.dateLocked === true;
    const durationMinutes = Math.round(boundedNumber(
      request.data?.durationMinutes,
      15,
      720,
      requestedStartMs !== null && requestedEndMs !== null ? (requestedEndMs - requestedStartMs) / MINUTE_MS : 60,
    ));
    if (!title || requestedStartMs === null || requestedEndMs === null || requestedStartMs >= requestedEndMs) {
      throw new HttpsError("invalid-argument", "Activity title and a valid time range are required.");
    }
    if (deadlineMs !== null && deadlineMs <= Date.now()) {
      throw new HttpsError("failed-precondition", "กำหนดส่งของกิจกรรมนี้ผ่านไปแล้ว กรุณาเลือกวันใหม่");
    }
    const requestedTimeZone = text(request.data?.generatedForTimeZone, 80);
    const lockTimeZone = validTimeZone(requestedTimeZone) ? requestedTimeZone : (await preferences(uid)).timeZone;
    const fixedLocalDate = dateLocked ? localDateKey(requestedStartMs, lockTimeZone) : null;

    const activity: ActivityRecord = {
      allowAiReschedule: true,
      category: activityCategory,
      deadlineMs,
      durationMinutes,
      endMs: requestedStartMs + durationMinutes * MINUTE_MS,
      estimatedDurationMinutes: durationMinutes,
      fixedLocalDate,
      googleEventId: "",
      id: "__adaptive_confirmed_activity__",
      isFlexible: true,
      isLocked: false,
      ownerId: uid,
      priority: deadlineMs !== null && deadlineMs - Date.now() <= 2 * DAY_MS ? "high" : "medium",
      source: "ai",
      startMs: requestedStartMs,
      status: "planned",
      title,
      version: 0,
    };
    const {request: slotRequest} = await schedulingRequest(uid, activity, requestedStartMs, undefined, fixedLocalDate ?? undefined);
    const requestedEndAtMs = requestedStartMs + durationMinutes * MINUTE_MS;
    const conflictResult = (conflicts: ReturnType<typeof userFacingConflicts>) => ({
      adjusted: false,
      conflicts,
      endAt: new Date(requestedEndAtMs).toISOString(),
      id: "",
      requiresConflictConfirmation: true,
      saved: false,
      startAt: new Date(requestedStartMs).toISOString(),
    });
    const preliminaryConflicts = userFacingConflicts(requestedStartMs, requestedEndAtMs, slotRequest.scheduleItems);
    if (preliminaryConflicts.length && !allowOverlap) return conflictResult(preliminaryConflicts);
    const requestedInWindow = requestedStartMs >= Math.max(Date.now() + 5 * MINUTE_MS, slotRequest.earliestStartMs) && requestedEndAtMs <= slotRequest.latestEndMs;
    const requestedValidation = validateCandidateSlot(slotRequest, requestedStartMs, requestedEndAtMs, {allowConflicts: allowOverlap, userSelectedTime});
    const requestedIsValid = requestedInWindow && requestedValidation.ok;
    if (!requestedIsValid) {
      throw new HttpsError(
        "failed-precondition",
        `${requestedValidation.message ?? "เวลาที่ยืนยันไว้ไม่ผ่านการตรวจสอบล่าสุด"} กรุณาวิเคราะห์ใหม่และยืนยันช่วงเวลาใหม่ก่อนบันทึก`,
      );
    }
    const startMs = requestedStartMs;
    const endMs = requestedEndAtMs;
    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(activityReference);
      if (existing.exists) {
        return committedResult(existing.data() ?? {});
      }
      const settingsSnapshot = await transaction.get(settingsRef(uid));
      const freshSetting = sanitizePreferences(settingsSnapshot.data() ?? {});
      const validationEnd = Timestamp.fromMillis(endMs + DAY_MS);
      const scheduleSnapshot = await transaction.get(userRef(uid).collection("schedules")
        .where("startAt", "<", validationEnd).orderBy("startAt", "desc").limit(500));
      const activitySnapshot = await transaction.get(userRef(uid).collection("activities")
        .where("startAt", "<", validationEnd).orderBy("startAt", "desc").limit(500));
      const suggestionSnapshot = await transaction.get(userRef(uid).collection("schedulingSuggestions")
        .where("status", "==", "pending").limit(100));
      const freshScheduleItems: EngineScheduleItem[] = [];
      scheduleSnapshot.docs.forEach((document) => {
        const data = document.data();
        const itemStartMs = timestampMs(data.startAt);
        const itemEndMs = timestampMs(data.endAt);
        if (itemStartMs !== null && itemEndMs !== null) freshScheduleItems.push({
          category: category(data.courseCode || data.title), endMs: itemEndMs, id: document.id,
          isDifficult: true, isFixed: true, kind: "schedule", startMs: itemStartMs,
          title: text(data.title, 120) || text(data.courseName, 120) || "ตารางเรียน",
        });
      });
      activitySnapshot.docs.forEach((document) => {
        const item = activityFromDocument(document);
        if (["cancelled", "completed"].includes(item.status)) return;
        freshScheduleItems.push({
          category: item.category, endMs: item.endMs, id: item.id,
          isDifficult: ["high", "urgent"].includes(item.priority),
          isFixed: !item.isFlexible || item.isLocked, kind: "activity", startMs: item.startMs, title: item.title,
        });
      });
      suggestionSnapshot.docs.forEach((document) => {
        const data = document.data();
        const itemStartMs = timestampMs(data.suggestedStartAt);
        const itemEndMs = timestampMs(data.suggestedEndAt);
        const expiresAt = timestampMs(data.expiresAt) ?? timestampMs(data.validUntil) ?? 0;
        if (itemStartMs === null || itemEndMs === null || itemEndMs <= startMs || itemStartMs >= endMs || expiresAt <= Date.now()) return;
        freshScheduleItems.push({
          category: category(data.activityCategory), endMs: itemEndMs, id: `suggestion-${document.id}`,
          isDifficult: false, isFixed: true, kind: "suggestion", startMs: itemStartMs,
          title: text(data.taskTitle, 120) || "คำแนะนำที่รอยืนยัน",
        });
      });
      const freshConflicts = userFacingConflicts(startMs, endMs, freshScheduleItems);
      if (freshConflicts.length && !allowOverlap) return conflictResult(freshConflicts);
      const freshValidation = validateCandidateSlot({
        category: activityCategory,
        deadlineMs,
        durationMinutes,
        earliestStartMs: startMs,
        latestEndMs: endMs,
        patterns: [],
        preferences: freshSetting,
        priority: activity.priority,
        requiredLocalDate: fixedLocalDate ?? undefined,
        scheduleItems: freshScheduleItems,
      }, startMs, endMs, {allowConflicts: allowOverlap, userSelectedTime});
      if (!freshValidation.ok || startMs < Date.now() + 5 * MINUTE_MS) {
        throw new HttpsError("failed-precondition", `${freshValidation.ok ? "เวลาที่เลือกใกล้หรือผ่านไปแล้ว" : freshValidation.message} กรุณาวิเคราะห์และยืนยันเวลาใหม่`);
      }
      transaction.create(activityReference, {
      aiReason: text(request.data?.explanation, 600) || "จัดเวลาจาก Adaptive AI และตรวจสอบตารางก่อนบันทึก",
      aiScheduled: true,
      allowAiReschedule: !dateLocked,
      category: activityCategory,
      color: "#BB9293",
      ...(clientRequestId ? {clientRequestId} : {}),
      createdAt: FieldValue.serverTimestamp(),
      ...(deadlineMs === null ? {} : {deadline: Timestamp.fromMillis(deadlineMs)}),
      endAt: Timestamp.fromMillis(endMs),
      estimatedDurationMinutes: durationMinutes,
      ...(fixedLocalDate ? {fixedLocalDate} : {}),
      isFlexible: true,
      isLocked: dateLocked,
      location: "",
      ownerId: uid,
      priority: activity.priority,
      scheduleVersion: 0,
      source: "ai",
      startAt: Timestamp.fromMillis(startMs),
      status: "planned",
      title,
      type: "task",
      updatedAt: FieldValue.serverTimestamp(),
      userSelectedTime,
    });
      transaction.create(eventReference, {
      activityCategory,
      actualDurationMinutes: null,
      actualEnd: null,
      actualStart: null,
      createdAt: FieldValue.serverTimestamp(),
      dayOfWeek: dayOfWeek(startMs, freshSetting.timeZone),
      estimatedDurationMinutes: durationMinutes,
      eventType: "task_created",
      metadata: {adjustedAfterValidation: false, allowOverlap, conflictingItemCount: freshConflicts.length, userSelectedTime, ...(clientRequestId ? {clientRequestId} : {})},
      originalScheduledStart: Timestamp.fromMillis(startMs),
      ownerId: uid,
      scheduleItemId: activityReference.id,
      source: "ai_suggestion",
      timePeriod: adaptiveTimePeriod(localHour(startMs, freshSetting.timeZone)),
      updatedAt: FieldValue.serverTimestamp(),
      updatedScheduledStart: Timestamp.fromMillis(startMs),
    });
      return {
        adjusted: false,
        conflicts: freshConflicts,
        endAt: new Date(endMs).toISOString(),
        id: activityReference.id,
        requiresConflictConfirmation: false,
        saved: true,
        startAt: new Date(startMs).toISOString(),
      };
    });
  });

  const getAdaptiveSchedulingDashboard = onCall(callableOptions, async (request) => dashboard(requiredUid(request)));

  const updateAdaptiveSchedulingPreferences = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    return {preferences: await writePreferences(uid, request.data?.preferences ?? {})};
  });

  const recordSchedulingBehavior = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    const id = await recordEvent(uid, request.data ?? {});
    // The learned rates have to move on the action that caused them, not at
    // 03:15 tomorrow. Recalculating here is what makes marking a task done or
    // postponing it visibly change the next suggestion; the nightly job stays
    // as the backstop for events nobody was present for.
    const {patterns} = await calculateUserPatterns(uid)
      .catch((error) => { console.warn("Pattern recalculation after a behaviour event failed.", {error, uid}); return {patterns: -1}; });
    return {id, patterns};
  });

  // "Recalculate now" has to see the slots that quietly went by as well as the
  // ones the user pressed a button on, otherwise the number it produces is only
  // ever the optimistic half of the user's week.
  const calculateSchedulingPatterns = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    const swept = await sweepUserOutcomes(uid, Date.now())
      .catch((error) => { console.warn("Outcome sweep before an on-demand recalculation failed.", {error, uid}); return {expired: 0, recorded: 0}; });
    return {...await calculateUserPatterns(uid), ...swept};
  });

  const generateAdaptiveSuggestion = onCall({...callableOptions, secrets: [geminiApiKey]}, async (request) => {
    const uid = requiredUid(request);
    const activityId = text(request.data?.activityId, 128);
    if (!activityId) throw new HttpsError("invalid-argument", "activityId is required.");
    return createSuggestion(uid, activityId);
  });

  const acceptSchedulingSuggestion = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    const suggestionId = text(request.data?.suggestionId, 128);
    if (!suggestionId) throw new HttpsError("invalid-argument", "suggestionId is required.");
    return suggestionTransaction(uid, suggestionId, false);
  });

  const rejectSchedulingSuggestion = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    const suggestionId = text(request.data?.suggestionId, 128);
    if (!suggestionId) throw new HttpsError("invalid-argument", "suggestionId is required.");
    return rejectSuggestion(uid, suggestionId);
  });

  const chooseAlternativeSchedulingTime = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    const suggestionId = text(request.data?.suggestionId, 128);
    const startMs = timestampMs(request.data?.startAt);
    if (!suggestionId || startMs === null) throw new HttpsError("invalid-argument", "suggestionId and startAt are required.");
    return alternativeTime(uid, suggestionId, startMs);
  });

  const lockAdaptiveScheduleItem = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    const activityId = text(request.data?.activityId, 128);
    if (!activityId) throw new HttpsError("invalid-argument", "activityId is required.");
    const reference = userRef(uid).collection("activities").doc(activityId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new HttpsError("not-found", "ไม่พบกิจกรรมนี้");
      const pendingSuggestions = await transaction.get(userRef(uid).collection("schedulingSuggestions").where("status", "==", "pending").limit(100));
      transaction.update(reference, {
        allowAiReschedule: false,
        isLocked: true,
        scheduleVersion: Math.max(0, finiteNumber(snapshot.data()?.scheduleVersion)) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      pendingSuggestions.docs.filter((document) => text(document.data().scheduleItemId, 128) === activityId).forEach((document) => {
        transaction.update(document.ref, {
          expiredAt: FieldValue.serverTimestamp(),
          invalidatedReason: "activity_locked",
          status: "expired",
          updatedAt: FieldValue.serverTimestamp(),
          validUntil: Timestamp.now(),
        });
      });
    });
    return {ok: true};
  });

  const undoScheduleChange = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    const historyId = text(request.data?.historyId, 128);
    if (!historyId) throw new HttpsError("invalid-argument", "historyId is required.");
    const historyReference = userRef(uid).collection("scheduleChangeHistory").doc(historyId);
    const result = await db.runTransaction(async (transaction) => {
      const historySnapshot = await transaction.get(historyReference);
      if (!historySnapshot.exists) throw new HttpsError("not-found", "ไม่พบประวัติการเปลี่ยนแปลง");
      const history = historySnapshot.data() ?? {};
      if (history.status !== "applied") throw new HttpsError("failed-precondition", "รายการนี้ย้อนกลับแล้วหรือใช้ไม่ได้");
      if ((timestampMs(history.canUndoUntil) ?? 0) < Date.now()) throw new HttpsError("failed-precondition", "หมดเวลาสำหรับการย้อนกลับแล้ว");
      const activityId = text(history.scheduleItemId, 128);
      const activityReference = userRef(uid).collection("activities").doc(activityId);
      const activitySnapshot = await transaction.get(activityReference);
      if (!activitySnapshot.exists) throw new HttpsError("not-found", "ไม่พบกิจกรรมเดิม");
      const activity = activityFromDocument({id: activitySnapshot.id, data: () => activitySnapshot.data() ?? {}});
      if (activity.version !== finiteNumber(history.newScheduleVersion) || activity.startMs !== timestampMs(history.newStartAt)) {
        throw new HttpsError("aborted", "กิจกรรมถูกแก้จากอุปกรณ์อื่น จึงย้อนกลับอัตโนมัติไม่ได้");
      }
      const previousStartMs = timestampMs(history.previousStartAt);
      const previousEndMs = timestampMs(history.previousEndAt);
      if (previousStartMs === null || previousEndMs === null) throw new HttpsError("data-loss", "ประวัติเวลาเดิมไม่สมบูรณ์");
      if (previousStartMs < Date.now() + 5 * MINUTE_MS) {
        throw new HttpsError("failed-precondition", "เวลาเดิมผ่านไปหรือใกล้เกินไปแล้ว จึงไม่สามารถย้อนกลับได้");
      }
      const settingSnapshot = await transaction.get(settingsRef(uid));
      const setting = sanitizePreferences(settingSnapshot.data() ?? {});
      const rangeStart = Timestamp.fromMillis(previousStartMs - DAY_MS);
      const rangeEnd = Timestamp.fromMillis(previousEndMs + DAY_MS);
      const scheduleSnapshot = await transaction.get(userRef(uid).collection("schedules")
        .where("startAt", ">=", rangeStart).where("startAt", "<", rangeEnd).limit(300));
      const activityConstraintsSnapshot = await transaction.get(userRef(uid).collection("activities")
        .where("startAt", ">=", rangeStart).where("startAt", "<", rangeEnd).limit(300));
      const scheduleItems: EngineScheduleItem[] = [];
      scheduleSnapshot.docs.forEach((document) => {
        const data = document.data();
        const startMs = timestampMs(data.startAt);
        const endMs = timestampMs(data.endAt);
        if (startMs !== null && endMs !== null) scheduleItems.push({category: "study", endMs, id: document.id, isDifficult: true, isFixed: true, startMs});
      });
      activityConstraintsSnapshot.docs.forEach((document) => {
        if (document.id === activity.id) return;
        const item = activityFromDocument(document);
        if (["cancelled", "completed"].includes(item.status)) return;
        scheduleItems.push({
          category: item.category,
          endMs: item.endMs,
          id: item.id,
          isDifficult: ["high", "urgent"].includes(item.priority),
          isFixed: !item.isFlexible || item.isLocked,
          startMs: item.startMs,
        });
      });
      const restoreValidation = validateCandidateSlot({
        category: activity.category,
        deadlineMs: activity.deadlineMs,
        durationMinutes: Math.max(1, Math.round((previousEndMs - previousStartMs) / MINUTE_MS)),
        earliestStartMs: previousStartMs,
        latestEndMs: previousEndMs,
        patterns: [],
        preferences: setting,
        priority: activity.priority,
        scheduleItems,
      }, previousStartMs, previousEndMs);
      if (!restoreValidation.ok) {
        throw new HttpsError("failed-precondition", `คืนเวลาเดิมไม่ได้: ${restoreValidation.message ?? "ช่วงเวลาเดิมไม่ว่างแล้ว"}`);
      }
      transaction.update(activityReference, {
        aiReason: null,
        aiScheduled: false,
        endAt: Timestamp.fromMillis(previousEndMs),
        scheduleVersion: activity.version + 1,
        startAt: Timestamp.fromMillis(previousStartMs),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(historyReference, {status: "undone", undoneAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
      transaction.set(userRef(uid).collection("schedulingBehaviorEvents").doc(), {
        activityCategory: activity.category, actualDurationMinutes: null, actualEnd: null, actualStart: null,
        createdAt: FieldValue.serverTimestamp(), dayOfWeek: dayOfWeek(previousStartMs, setting.timeZone), estimatedDurationMinutes: activity.estimatedDurationMinutes,
        eventType: "automatic_change_undone", metadata: {historyId}, originalScheduledStart: history.newStartAt,
        ownerId: uid, scheduleItemId: activity.id, source: "user", timePeriod: adaptiveTimePeriod(localHour(previousStartMs, text(history.timeZone, 80) || "Asia/Bangkok")),
        updatedAt: FieldValue.serverTimestamp(), updatedScheduledStart: history.previousStartAt,
      });
      return {activityId, title: activity.title};
    });
    await sendAdaptiveNotificationBestEffort(uid, "ย้อนกลับตารางแล้ว", `คืนเวลาเดิมของ ${result.title} เรียบร้อยแล้ว`, {
      historyId,
      notificationId: `adaptive-${historyId}-undone`,
      route: "/user/smartlife_adaptive_scheduling",
      type: "adaptive_schedule_undone",
    });
    return result;
  });

  const deleteSchedulingPattern = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    const patternId = text(request.data?.patternId, 128);
    if (!patternId) throw new HttpsError("invalid-argument", "patternId is required.");
    await userRef(uid).collection("schedulingPatterns").doc(patternId).delete();
    return {ok: true};
  });

  const deleteSchedulingBehaviorHistory = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    let deleted = 0;
    while (deleted < 5000) {
      const snapshot = await userRef(uid).collection("schedulingBehaviorEvents").limit(400).get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
      deleted += snapshot.size;
    }
    const patterns = await userRef(uid).collection("schedulingPatterns").get();
    if (!patterns.empty) {
      const batch = db.batch();
      patterns.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
    return {deleted};
  });

  const registerAdaptivePushToken = onCall(callableOptions, async (request) => {
    const uid = requiredUid(request);
    const token = text(request.data?.token, 4096);
    const platform = text(request.data?.platform, 20);
    if (!token || !["android", "ios"].includes(platform)) throw new HttpsError("invalid-argument", "A native Android or iOS push token is required.");
    const id = Buffer.from(token).toString("base64url").slice(0, 180);
    await userRef(uid).collection("pushTokens").doc(id).set({
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      ownerId: uid,
      platform,
      token,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return {ok: true};
  });

  const activateAdaptiveScheduling = onCall(callableOptions, async (request) => {
    return activateAdaptiveForUser(requiredUid(request));
  });

  const processNaturalLanguageScheduleCommand = onCall({...callableOptions, secrets: [geminiApiKey]}, async (request) => {
    const uid = requiredUid(request);
    const message = text(request.data?.message, 1000);
    if (!message) throw new HttpsError("invalid-argument", "message is required.");
    const nowMs = Date.now();
    const [setting, contextItems] = await Promise.all([
      preferences(uid),
      constraints(uid, nowMs, nowMs + 7 * DAY_MS),
    ]);
    const {intent, usedGemini} = await parseNaturalLanguage(
      geminiApiKey.value(),
      message,
      verifiedTemporalContext(setting, contextItems),
    );
    const response: Record<string, unknown> = {intent};
    // Gemini is the reader for messy phrasing. When it could not answer and the
    // regex fallback also failed to place a day or time the user plainly wrote,
    // say so instead of quietly scheduling whatever the open search returns.
    if (!usedGemini && ["create_activity", "find_time"].includes(intent.intent) && unresolvedTemporalMention(message, intent)) {
      return {
        ...response,
        message: "ยังอ่านวันหรือเวลาที่ระบุไม่ออกแน่ชัด ช่วยพิมพ์ใหม่ให้ชัดขึ้นได้ไหม เช่น \"ซื้อมังงะ วันที่ 1 ก.ย. 10:00\"",
      };
    }
    if (intent.intent === "productivity") {
      response.dashboard = await dashboard(uid);
      return response;
    }
    if (intent.intent === "set_preference" && intent.activityCategory && intent.preferredPeriod) {
      const periods = REQUESTED_PERIOD_WINDOWS;
      if (intent.preferenceMode === "avoid") {
        const setting = await preferences(uid);
        response.preferencePatch = {unavailablePeriods: [...setting.unavailablePeriods, {category: intent.activityCategory, days: setting.availableDays, ...periods[intent.preferredPeriod]}].slice(-30)};
      } else {
        response.preferencePatch = {preferredTimeByCategory: {[intent.activityCategory]: periods[intent.preferredPeriod]}};
      }
      return response;
    }
    if (intent.intent === "create_activity") {
      return {...response, ...await proposeNewFlexibleActivity(uid, intent, message)};
    }
    if (intent.intent === "find_time") {
      const candidates = await userRef(uid).collection("activities").where("status", "==", "planned").limit(100).get();
      const matched = candidates.docs.map(activityFromDocument).filter((item) => item.isFlexible && !item.isLocked && item.allowAiReschedule)
        .filter((item) => (!intent.activityCategory || item.category === intent.activityCategory) && (!intent.taskTitle || item.title.toLowerCase().includes(intent.taskTitle.toLowerCase())))
        .sort((left, right) => left.startMs - right.startMs)[0];
      if (!matched) return {...response, ...await proposeNewFlexibleActivity(uid, intent, message)};
      response.suggestion = await createSuggestion(
        uid,
        matched.id,
        false,
        undefined,
        true,
        requestedWindowForIntent(intent, matched.estimatedDurationMinutes || matched.durationMinutes),
        intent.requestedLocalDate ?? undefined,
      );
      return response;
    }
    if (intent.intent === "rebalance_day") {
      response.suggestions = await createDayRebalanceSuggestions(uid, zonedDayStart(Date.now(), setting.timeZone, 1));
      return response;
    }
    if (intent.intent === "rebalance_week") {
      response.suggestions = await createWeekRebalanceSuggestions(uid, zonedDayStart(Date.now(), setting.timeZone));
      return response;
    }
    if (intent.intent === "explain_move") {
      const latest = await userRef(uid).collection("scheduleChangeHistory").orderBy("createdAt", "desc").limit(1).get();
      response.history = latest.empty ? null : serializeDocument(latest.docs[0]);
      return response;
    }
    return response;
  });

  const rebalanceUserDay = onCall({...callableOptions, secrets: [geminiApiKey]}, async (request) => {
    const uid = requiredUid(request);
    const setting = await preferences(uid);
    const targetMs = timestampMs(request.data?.date) ?? zonedDayStart(Date.now(), setting.timeZone, 1);
    return {suggestions: await createDayRebalanceSuggestions(uid, targetMs)};
  });

  const rebalanceUserWeek = onCall({...callableOptions, secrets: [geminiApiKey]}, async (request) => {
    const uid = requiredUid(request);
    const setting = await preferences(uid);
    const targetMs = timestampMs(request.data?.date) ?? zonedDayStart(Date.now(), setting.timeZone);
    return {suggestions: await createWeekRebalanceSuggestions(uid, targetMs)};
  });

  /**
   * Runs before the 03:15 recalculation so the skips and ignored suggestions it
   * finds are already in the window that job reads.
   */
  const scheduledAdaptiveOutcomeSweep = onSchedule({region, schedule: "every day 02:45", timeZone: "Asia/Bangkok"}, async () => {
    const nowMs = Date.now();
    const settings = await db.collectionGroup("settings").limit(500).get();
    for (const document of settings.docs.filter((item) => item.id === "adaptiveScheduling")) {
      const uid = document.ref.parent.parent?.id;
      if (!uid) continue;
      try {
        await sweepUserOutcomes(uid, nowMs);
      } catch (error) {
        console.error("Adaptive outcome sweep failed.", {error, uid});
      }
    }
  });

  const scheduledAdaptivePatternRecalculation = onSchedule({region, schedule: "every day 03:15", timeZone: "Asia/Bangkok"}, async () => {
    const recent = await db.collectionGroup("schedulingBehaviorEvents")
      .where("createdAt", ">=", Timestamp.fromMillis(Date.now() - 2 * DAY_MS)).limit(1000).get();
    const users = [...new Set(recent.docs.flatMap((document) => {
      const user = document.ref.parent.parent;
      return user?.id ? [user.id] : [];
    }))];
    for (const uid of users.slice(0, 200)) {
      try { await calculateUserPatterns(uid); } catch (error) { console.error("Adaptive pattern recalculation failed.", {error, uid}); }
    }
  });

  const scheduledAutomaticAdaptiveScheduling = onSchedule({region, schedule: "every day 04:15", secrets: [geminiApiKey], timeZone: "Asia/Bangkok"}, async () => {
    const settings = await db.collectionGroup("settings").where("allowAutomaticRescheduling", "==", true).limit(100).get();
    for (const settingDocument of settings.docs.filter((document) => document.id === "adaptiveScheduling")) {
      const uid = settingDocument.ref.parent.parent?.id;
      if (!uid) continue;
      const setting = sanitizePreferences(settingDocument.data());
      const tomorrow = zonedDayStart(Date.now(), setting.timeZone, 1);
      const tomorrowEnd = zonedDayStart(tomorrow, setting.timeZone, 1);
      const activities = await userRef(uid).collection("activities")
        .where("startAt", ">=", Timestamp.fromMillis(tomorrow)).where("startAt", "<", Timestamp.fromMillis(tomorrowEnd)).limit(50).get();
      for (const activity of activities.docs.map(activityFromDocument).filter((item) => item.isFlexible && !item.isLocked && item.allowAiReschedule).slice(0, 2)) {
        try {
          const suggestion = await createSuggestion(uid, activity.id, true, undefined, false);
          if (suggestion.confidence >= setting.minimumAutomaticConfidence) await suggestionTransaction(uid, suggestion.id, true);
        } catch (error) {
          console.warn("Automatic adaptive scheduling skipped an activity.", {activityId: activity.id, error, uid});
        }
      }
    }
  });

  return {
    acceptSchedulingSuggestion,
    activateAdaptiveScheduling,
    calculateSchedulingPatterns,
    chooseAlternativeSchedulingTime,
    createAdaptiveActivity,
    deleteSchedulingBehaviorHistory,
    deleteSchedulingPattern,
    generateAdaptiveSuggestion,
    getAdaptiveSchedulingDashboard,
    lockAdaptiveScheduleItem,
    processNaturalLanguageScheduleCommand,
    rebalanceUserDay,
    rebalanceUserWeek,
    recordSchedulingBehavior,
    registerAdaptivePushToken,
    rejectSchedulingSuggestion,
    scheduledAdaptiveOutcomeSweep,
    scheduledAdaptivePatternRecalculation,
    scheduledAutomaticAdaptiveScheduling,
    undoScheduleChange,
    updateAdaptiveSchedulingPreferences,
  };
}
