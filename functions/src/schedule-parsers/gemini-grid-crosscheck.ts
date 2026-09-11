// Schemas here carry no minimum/maximum/maxItems/minItems: /v1/interactions
// rejects them alongside nullable types ("Request contains an invalid
// argument"), and the values are range-checked after parsing anyway.
import type {StandardScheduleEntry} from "./types";

/**
 * A second reading of the timetable from the image itself, trusted only as far
 * as the OCR text bears it out.
 *
 * The geometry parser reads what Vision printed, but it cannot see cell
 * borders, so it cannot tell where a merged cell ends when no time range is
 * printed inside it. A model looking at the image can. It can also be
 * confidently wrong on a blurred or glared cell, so every value it offers is
 * checked against the words OCR actually found before it is used:
 *
 * - it fills a field the grid left empty only when the value appears in the
 *   OCR text; otherwise the field stays empty and is flagged, with the
 *   model's reading in the note;
 * - it never overwrites a value the grid read -- a disagreement is flagged;
 * - a course only the model found is kept, flagged, when its code is in the
 *   OCR text, and dropped when it is not.
 */

export type GeminiGridCourse = {
  course_code: string | null;
  day: string | null;
  end_time: string | null;
  room: string | null;
  section: string | null;
  start_time: string | null;
};

export type CrossCheckStats = {
  added: number;
  agreed: number;
  conflicts: number;
  dropped: number;
  filled: number;
  flagged: number;
  geminiCourses: number;
  rejected: number;
};

const THAI_DAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
const DAY_ALIASES: string[][] = [
  ["จันทร์", "จ", "mon", "monday"],
  ["อังคาร", "อ", "tue", "tues", "tuesday"],
  ["พุธ", "พ", "wed", "wednesday"],
  ["พฤหัสบดี", "พฤหัส", "พฤ", "thu", "thur", "thurs", "thursday"],
  ["ศุกร์", "ศ", "fri", "friday"],
  ["เสาร์", "ส", "sat", "saturday"],
  ["อาทิตย์", "อา", "sun", "sunday"],
];

export const GRID_EXTRACTION_PROMPT = `You read a weekly class timetable image for a Thai student app.

List every class placed in the timetable grid. For each one return:
- course_code: exactly as printed (for example ACC315-68 or 2110101)
- section: the section or group printed with it (Sec, กลุ่ม, ตอน), or null
- room: the room or building printed with it, or null
- day: MON, TUE, WED, THU, FRI, SAT or SUN -- the day row (or column) the class sits in
- start_time and end_time as HH:MM. If a time range is printed inside the cell,
  use it. Otherwise a class drawn across several time columns (a merged cell)
  starts at the left edge of its first column and ends at the right edge of
  its last column, read against the time headers.

Rules: report only what is visibly in the grid. Never invent a room, section
or time -- use null when it is not printed. A course meeting on two days
appears twice. Ignore any separate course list or exam table outside the grid.
Reply with JSON only.`;

const nullableString = {type: ["string", "null"]} as const;
const GRID_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    courses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          course_code: nullableString,
          day: nullableString,
          end_time: nullableString,
          room: nullableString,
          section: nullableString,
          start_time: nullableString,
        },
        required: ["course_code", "day", "end_time", "room", "section", "start_time"],
      },
    },
  },
  required: ["courses"],
} as const;

const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];

type InteractionResponse = {
  error?: {message?: string};
  steps?: {content?: {text?: string; type?: string}[]; type?: string}[];
};

/** Reads every class in the grid from the image, or null when the model cannot answer. */
export async function extractScheduleGridWithGemini({
  apiKey,
  imageDataUrl,
  ocrText,
  timeoutMs = 18000,
}: {
  apiKey: string;
  imageDataUrl: string;
  ocrText: string;
  timeoutMs?: number;
}): Promise<{courses: GeminiGridCourse[]; model: string} | null> {
  const image = imageDataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!apiKey || !image) return null;
  for (const [index, model] of MODELS.entries()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1/interactions", {
        method: "POST",
        headers: {"Content-Type": "application/json", "x-goog-api-key": apiKey},
        body: JSON.stringify({
          model,
          store: false,
          system_instruction: GRID_EXTRACTION_PROMPT,
          // v1 wants the parts inside a user_input step; bare parts are what
          // broke every image request after the move from v1beta.
          input: [{
            type: "user_input",
            content: [
              {type: "text", text: `OCR transcript of the same image (may contain errors):\n${ocrText.slice(0, 20000)}`},
              {type: "image", data: image[2].replace(/\s+/g, ""), mime_type: image[1]},
            ],
          }],
          response_format: {type: "text", mime_type: "application/json", schema: GRID_SCHEMA},
        }),
        signal: controller.signal,
      });
      const payload = await response.json() as InteractionResponse;
      if (!response.ok) {
        const retryable = response.status === 404 || response.status === 429 || response.status >= 500;
        if (retryable && index < MODELS.length - 1) continue;
        console.warn("[Schedule grid] Gemini refused the extraction.", {message: payload.error?.message, model, status: response.status});
        return null;
      }
      const text = payload.steps
        ?.filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .filter((content) => content.type === "text")
        .map((content) => content.text ?? "")
        .join("")
        .trim() ?? "";
      const parsed = JSON.parse(text) as {courses?: unknown};
      const courses = Array.isArray(parsed.courses) ? parsed.courses as GeminiGridCourse[] : [];
      return {courses, model};
    } catch (error) {
      // A timeout is the model being slow, not wrong: a real scan waited out
      // 30 s on one model while the next would have answered.
      const timedOut = error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
      console.warn("[Schedule grid] Gemini extraction failed.", {error: error instanceof Error ? error.message : String(error), model});
      if (timedOut && index < MODELS.length - 1) continue;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

type Field = "courseCode" | "day" | "endTime" | "room" | "section" | "startTime";
export type GridField = Field;
export const GRID_FIELD_LABELS: Record<Field, string> = {
  courseCode: "รหัสวิชา",
  day: "วัน",
  endTime: "เวลาสิ้นสุด",
  room: "ห้อง",
  section: "Section",
  startTime: "เวลาเริ่ม",
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const squash = (value: unknown) => text(value).toUpperCase().replace(/[^A-Z0-9ก-๙]/g, "");
/**
 * The value without the label printed beside it. The model tends to return
 * "ห้อง 410" or "Sec 01" where the grid reads "410" and "01"; left on, every
 * room on a real scan was reported as a disagreement.
 */
const unlabelled = (field: string, value: string) => field === "room" ?
  value.replace(/^(?:ห้อง(?:เรียน)?|room|rm\.?|อาคาร|bldg\.?)\s*[:.#]?\s*/i, "").trim() :
  field === "section" ?
    value.replace(/^(?:sec(?:tion)?|กลุ่ม(?:เรียน)?|ตอน(?:เรียน)?|หมู่(?:เรียน)?)\s*[:.#]?\s*/i, "").trim() :
    value;

export function normalizeGridDay(value: unknown) {
  const label = text(value).replace(/[.\s]/g, "").replace(/^วัน/, "").toLowerCase();
  const index = DAY_ALIASES.findIndex((aliases) => aliases.includes(label));
  return index >= 0 ? THAI_DAYS[index] : null;
}

function normalizeTime(value: unknown) {
  const match = text(value).match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

/** What the OCR text actually contains, for checking the model's values against. */
export function ocrEvidence(ocrText: string, gridDays: string[] = []) {
  const upper = ocrText.toUpperCase();
  const tokens = new Set(upper.split(/[^A-Z0-9ก-๙]+/).filter(Boolean));
  const times = new Set([...ocrText.matchAll(/([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)/g)]
    .map((match) => `${match[1].padStart(2, "0")}:${match[2]}`));
  const days = gridDays.length ?
    new Set(gridDays) :
    new Set([...tokens].map(normalizeGridDay).filter((day): day is string => Boolean(day)));
  return {days, squashed: upper.replace(/[^A-Z0-9ก-๙]/g, ""), times, tokens};
}
type Evidence = ReturnType<typeof ocrEvidence>;

/**
 * Whether a value is borne out by the OCR text. Short values -- a section
 * "01", a room "410" -- must be a whole token, or "1" would match anything.
 */
/** For free text such as a course name or an exam date: it must appear, squashed, in the OCR text. */
export function textInOcr(value: string, evidence: Evidence) {
  const squashed = squash(value);
  return squashed.length >= 3 && evidence.squashed.includes(squashed);
}

export function inOcr(field: Field, value: string, evidence: Evidence) {
  if (field === "day") return evidence.days.has(normalizeGridDay(value) ?? value);
  if (field === "startTime" || field === "endTime") return evidence.times.has(value);
  const squashed = squash(value);
  if (!squashed) return false;
  if (field === "courseCode") return squashed.length >= 4 && evidence.squashed.includes(squashed);
  if (squashed.length <= 3) {
    return evidence.tokens.has(squashed) || evidence.tokens.has(squashed.padStart(2, "0")) ||
      evidence.tokens.has(squashed.replace(/^0+(?=\d)/, ""));
  }
  return evidence.squashed.includes(squashed);
}

function same(field: Field, a: string, b: string) {
  if (field === "section") return squash(a).replace(/^0+(?=\d)/, "") === squash(b).replace(/^0+(?=\d)/, "");
  if (field === "day" || field === "startTime" || field === "endTime") return a === b;
  return squash(a) === squash(b);
}

function modelValue(field: Field, course: GeminiGridCourse) {
  if (field === "day") return normalizeGridDay(course.day);
  if (field === "startTime") return normalizeTime(course.start_time);
  if (field === "endTime") return normalizeTime(course.end_time);
  if (field === "room") return unlabelled("room", text(course.room)) || null;
  if (field === "section") return unlabelled("section", text(course.section)) || null;
  return text(course.course_code).toUpperCase() || null;
}

function flag(entry: StandardScheduleEntry, field: Field, note: string) {
  entry.reviewFields = [...new Set([...(entry.reviewFields ?? []), field])];
  entry.reviewNotes = [...(entry.reviewNotes ?? []), note];
}

export function crossCheckScheduleEntries(
  base: StandardScheduleEntry[],
  courses: GeminiGridCourse[],
  ocrText: string,
  gridDays: string[] = [],
): {entries: StandardScheduleEntry[]; stats: CrossCheckStats} {
  const evidence = ocrEvidence(ocrText, gridDays);
  const stats: CrossCheckStats = {added: 0, agreed: 0, conflicts: 0, dropped: 0, filled: 0, flagged: 0, geminiCourses: courses.length, rejected: 0};
  const entries: StandardScheduleEntry[] = base.map((entry) => ({...entry, reviewFields: [...(entry.reviewFields ?? [])], reviewNotes: [...(entry.reviewNotes ?? [])]}));
  const used = new Set<number>();

  const merge = (entry: StandardScheduleEntry, course: GeminiGridCourse) => {
    for (const field of ["section", "room", "day", "startTime", "endTime"] as Field[]) {
      const offered = modelValue(field, course);
      if (!offered) continue;
      const current = text(entry[field]);
      const verified = inOcr(field, offered, evidence);
      if (current) {
        if (same(field, current, offered)) stats.agreed += 1;
        else if (verified) {
          // Both readings are real words on the page -- a genuine ambiguity.
          flag(entry, field, `${GRID_FIELD_LABELS[field]}: ระบบอ่านได้ "${current}" แต่ AI อ่านเป็น "${offered}"`);
          stats.conflicts += 1;
        } else stats.rejected += 1;
        continue;
      }
      if (verified) {
        entry[field] = offered;
        if (field === "room") entry.buildingName = offered;
        stats.filled += 1;
        if (!String(entry.parserSource ?? "").includes("gemini-verified")) {
          entry.parserSource = `${entry.parserSource ?? "schedule"}+gemini-verified`;
        }
      } else {
        // Not filled in. A value the page does not bear out stays a
        // suggestion in the note: pre-filled, it would be one tap from saved
        // -- and on a real scan the model's "17:00" for a class ending at
        // 16:00 was exactly this case.
        flag(entry, field, `${GRID_FIELD_LABELS[field]}: AI อ่านได้ "${offered}" แต่ไม่พบในข้อความที่สแกน จึงยังไม่กรอกให้`);
        stats.flagged += 1;
      }
    }
    if (entry.startTime && entry.endTime) {
      if (entry.startTime >= entry.endTime) flag(entry, "endTime", "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม");
      else entry.classTime = `${entry.startTime}-${entry.endTime}`;
    }
  };

  for (const course of courses) {
    const code = modelValue("courseCode", course);
    if (!code) continue;
    const key = squash(code);
    const day = normalizeGridDay(course.day);
    let index = entries.findIndex((entry, at) => !used.has(at) && squash(entry.courseCode) === key && (!day || !entry.day || entry.day === day));
    if (index < 0) index = entries.findIndex((entry, at) => !used.has(at) && squash(entry.courseCode) === key);
    if (index >= 0) {
      used.add(index);
      merge(entries[index], course);
      continue;
    }
    if (!inOcr("courseCode", code, evidence)) {
      stats.dropped += 1;
      continue;
    }
    const entry: StandardScheduleEntry = {
      courseCode: code,
      courseName: null,
      day: null,
      endTime: null,
      parserSource: "gemini-grid-only",
      reviewFields: ["courseCode"],
      reviewNotes: ["พบวิชานี้จาก AI เท่านั้น ระบบอ่านตารางไม่พบ กรุณาตรวจสอบ"],
      room: null,
      section: null,
      startTime: null,
    };
    merge(entry, course);
    entries.push(entry);
    used.add(entries.length - 1);
    stats.added += 1;
  }
  return {entries, stats};
}
