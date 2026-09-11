// Schemas here carry no minimum/maximum/maxItems/minItems: /v1/interactions
// rejects them alongside nullable types ("Request contains an invalid
// argument"), and the values are range-checked after parsing anyway.
import type {StandardScheduleEntry} from "./types";

export const COURSE_EXAM_REVIEW_SYSTEM_PROMPT = `You verify Thai class-schedule course identities and exam dates from a document image.

Use the image as authority and OCR only as a hint. Candidate entry_index values are anchors.

STRICT RULES
1. Treat the lower course table as row-based data: course code -> course name -> group -> midterm -> final. Verify a course code and name only when both are visibly associated in that same row, block, or legend entry. Never use outside knowledge or invent a subject name from a code.
2. Preserve visible language and spelling. A suffix after a course code can be a class group/section; use the image and row headers to keep the course identity separate from its group.
3. For each candidate, read the midterm and final columns independently from the same course row. Return the exact visible date/time text. Do not calculate or guess a date, and never copy an exam from the row above or below.
4. A literal "-" in an exam column means that exam is missing: return exam_present false and exam null for that column. Return true only when a date/time is visibly printed for that course. Return null only when the cell cannot be read or the document has no applicable exam table.
5. Ignore general semester exam ranges unless they are explicitly tied to the candidate course.
6. Every accepted fact needs a short exact evidence excerpt and confidence from 0 to 1.
7. Return only JSON matching the response schema.`;

const nullableString = {type: ["string", "null"]} as const;
const nullableBoolean = {type: ["boolean", "null"]} as const;
const COURSE_EXAM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          entry_index: {type: "integer"},
          course_code: nullableString,
          course_name: nullableString,
          course_pair_valid: nullableBoolean,
          course_confidence: {type: "number"},
          course_evidence: nullableString,
          midterm_present: nullableBoolean,
          midterm_exam: nullableString,
          midterm_confidence: {type: "number"},
          midterm_evidence: nullableString,
          final_present: nullableBoolean,
          final_exam: nullableString,
          final_confidence: {type: "number"},
          final_evidence: nullableString,
        },
        required: [
          "entry_index",
          "course_code",
          "course_name",
          "course_pair_valid",
          "course_confidence",
          "course_evidence",
          "midterm_present",
          "midterm_exam",
          "midterm_confidence",
          "midterm_evidence",
          "final_present",
          "final_exam",
          "final_confidence",
          "final_evidence",
        ],
      },
    },
  },
  required: ["entries"],
} as const;

type ReviewEntry = Record<string, unknown>;
type InteractionResponse = {
  error?: {message?: string};
  steps?: {content?: {text?: string; type?: string}[]; type?: string}[];
};

export type CourseExamReviewResult = {
  appliedCourseCount: number;
  appliedExamCount: number;
  entries: StandardScheduleEntry[];
};

function clean(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null;
  const result = value.replace(/\s+/g, " ").trim();
  return result && result !== "-" ? result.slice(0, maximum) : null;
}

function evidence(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null;
  const result = value.replace(/\s+/g, " ").trim();
  return result ? result.slice(0, maximum) : null;
}

function examValue(value: unknown) {
  const result = clean(value, 180);
  return result && /\b(?:19|20|24|25|26)\d{2}\b/.test(result)
    ? result
    : null;
}

function normalizedCode(value: unknown) {
  const result = clean(value, 40);
  return result && /[A-Z0-9]/i.test(result)
    ? result.replace(/\s+/g, "").toUpperCase()
    : null;
}

function confidence(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

function parseImageDataUrl(imageDataUrl: string) {
  const match = imageDataUrl.match(
    /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i,
  );
  if (!match) throw new Error("Gemini requires a valid base64 image data URL.");
  return {data: match[2].replace(/\s+/g, ""), mimeType: match[1]};
}

function outputText(response: InteractionResponse) {
  return response.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("")
    .trim() ?? "";
}

function candidates(entries: StandardScheduleEntry[]) {
  return entries.map((entry, entryIndex) => ({
    entry_index: entryIndex,
    course_code: entry.courseCode,
    course_name: entry.courseName,
    section: entry.section,
    midterm_exam: entry.midtermExam ?? null,
    final_exam: entry.finalExam ?? null,
  }));
}

function normalizePayload(
  value: unknown,
  baseEntries: StandardScheduleEntry[],
): CourseExamReviewResult {
  if (!value || typeof value !== "object") {
    throw new Error("Gemini returned an invalid course/exam review payload.");
  }
  const payloadEntries = Array.isArray((value as {entries?: unknown}).entries)
    ? (value as {entries: ReviewEntry[]}).entries
    : [];
  const entries = baseEntries.map((entry) => ({...entry}));
  let appliedCourseCount = 0;
  let appliedExamCount = 0;

  for (const review of payloadEntries) {
    const index = Number(review.entry_index);
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) continue;
    const current = entries[index];
    let changed = false;
    const courseEvidence = clean(review.course_evidence);
    const reviewedCode = normalizedCode(review.course_code);
    const reviewedName = clean(review.course_name, 160);
    if (
      review.course_pair_valid === true &&
      confidence(review.course_confidence) >= 0.85 &&
      courseEvidence &&
      reviewedCode &&
      reviewedName
    ) {
      current.courseCode = reviewedCode;
      current.courseName = reviewedName;
      appliedCourseCount += 1;
      changed = true;
    } else if (
      review.course_pair_valid === false &&
      confidence(review.course_confidence) >= 0.9 &&
      courseEvidence
    ) {
      current.courseName = null;
      changed = true;
    }

    const midtermEvidence = evidence(review.midterm_evidence);
    if (confidence(review.midterm_confidence) >= 0.85 && midtermEvidence) {
      const midterm = examValue(review.midterm_exam);
      if (review.midterm_present === true && midterm) {
        current.midtermExam = midterm;
        appliedExamCount += 1;
        changed = true;
      } else if (review.midterm_present === false) {
        current.midtermExam = null;
        changed = true;
      }
    }
    const finalEvidence = evidence(review.final_evidence);
    if (confidence(review.final_confidence) >= 0.85 && finalEvidence) {
      const finalExam = examValue(review.final_exam);
      if (review.final_present === true && finalExam) {
        current.finalExam = finalExam;
        appliedExamCount += 1;
        changed = true;
      } else if (review.final_present === false) {
        current.finalExam = null;
        changed = true;
      }
    }
    if (changed) {
      current.parserSource = `${current.parserSource ?? "schedule"}+gemini-course-exam-review`;
    }
  }

  return {appliedCourseCount, appliedExamCount, entries};
}

export async function reviewScheduleCoursesAndExamsWithGemini({
  apiKey,
  entries,
  imageDataUrl,
  rawText,
}: {
  apiKey: string;
  entries: StandardScheduleEntry[];
  imageDataUrl: string;
  rawText: string;
}) {
  if (!entries.length) {
    return {appliedCourseCount: 0, appliedExamCount: 0, entries};
  }
  const image = parseImageDataUrl(imageDataUrl);
  const models = [...new Set([
    process.env.GEMINI_SCHEDULE_MODEL,
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
  ].filter((value): value is string => Boolean(value)))];
  let response: Response | null = null;
  let payload: InteractionResponse = {};

  for (const [index, model] of models.entries()) {
    response = await fetch("https://generativelanguage.googleapis.com/v1/interactions", {
      method: "POST",
      headers: {"Content-Type": "application/json", "x-goog-api-key": apiKey},
      body: JSON.stringify({
        model,
        store: false,
        system_instruction: COURSE_EXAM_REVIEW_SYSTEM_PROMPT,
        // /v1/interactions takes content parts only inside a user_input step. These
        // were sent bare, which v1beta accepted and v1 rejects ("The value 'image'
        // is not supported for 'type'"), so after the 2026-08-07 move to v1 every
        // one of these reviews failed and the scan kept its unreviewed values.
        input: [{type: "user_input", content: [
          {
            type: "text",
            text: `Verify course-name/code pairs and per-course exam facts for these candidates:\n${JSON.stringify(candidates(entries))}\n\nOCR hints:\n${rawText.slice(0, 30000)}`,
          },
          {type: "image", data: image.data, mime_type: image.mimeType},
        ]}],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: COURSE_EXAM_SCHEMA,
        },
      }),
    });
    payload = await response.json() as InteractionResponse;
    if (response.ok || response.status !== 404 || index === models.length - 1) break;
  }

  if (!response) throw new Error("Gemini course/exam review could not start.");
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Gemini request failed with ${response.status}.`);
  }
  const text = outputText(payload);
  if (!text) throw new Error("Gemini returned no course/exam review output.");
  return normalizePayload(JSON.parse(text) as unknown, entries);
}
