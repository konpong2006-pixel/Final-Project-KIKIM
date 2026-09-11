"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_TEMPORAL_REVIEW_SYSTEM_PROMPT = void 0;
exports.reviewScheduleTemporalFieldsWithGemini = reviewScheduleTemporalFieldsWithGemini;
exports.SCHEDULE_TEMPORAL_REVIEW_SYSTEM_PROMPT = `You are a high-precision temporal verifier for Thai class schedules.

Your only task is to verify temporal facts that are visibly printed in the supplied schedule image: day of week, class start time, class end time, semester start/end dates, and academic year.

STRICT RULES
1. Candidate entries and entry_index values are supplied only as anchors. Never change, infer, or return course codes, course names, sections, rooms, buildings, teachers, exams, or any other non-temporal field.
2. Use the document image as authority. OCR text is only a hint and can be wrong.
3. Ignore phone status bars, screenshot clocks, upload times, app UI, and the current system date.
4. Never guess or use a default time. Return null when a temporal value is not clearly visible.
5. Normalize days to MON, TUE, WED, THU, FRI, SAT, or SUN.
6. Normalize class times to 24-hour HH:mm.
7. Normalize visible semester dates to Gregorian ISO YYYY-MM-DD. Convert a Thai Buddhist year by subtracting 543.
8. academic_year must preserve the exact visible four-digit year, whether Buddhist Era or Gregorian.
9. Every correction must include a short exact evidence excerpt visibly supporting it and a confidence from 0 to 1.
10. Return only the JSON required by the response schema.`;
const nullableString = { type: ["string", "null"] };
const SCHEDULE_TEMPORAL_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        academic_year: nullableString,
        semester_start: nullableString,
        semester_end: nullableString,
        calendar_confidence: { type: "number" },
        calendar_evidence: nullableString,
        entries: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    entry_index: { type: "integer" },
                    day: nullableString,
                    start_time: nullableString,
                    end_time: nullableString,
                    confidence: { type: "number" },
                    evidence: nullableString,
                },
                required: [
                    "entry_index",
                    "day",
                    "start_time",
                    "end_time",
                    "confidence",
                    "evidence",
                ],
            },
        },
    },
    required: [
        "academic_year",
        "semester_start",
        "semester_end",
        "calendar_confidence",
        "calendar_evidence",
        "entries",
    ],
};
const DAY_MAP = {
    MON: "MON",
    MONDAY: "MON",
    "จันทร์": "MON",
    TUE: "TUE",
    TUESDAY: "TUE",
    "อังคาร": "TUE",
    WED: "WED",
    WEDNESDAY: "WED",
    "พุธ": "WED",
    THU: "THU",
    THURSDAY: "THU",
    "พฤหัส": "THU",
    "พฤหัสบดี": "THU",
    FRI: "FRI",
    FRIDAY: "FRI",
    "ศุกร์": "FRI",
    SAT: "SAT",
    SATURDAY: "SAT",
    "เสาร์": "SAT",
    SUN: "SUN",
    SUNDAY: "SUN",
    "อาทิตย์": "SUN",
};
function cleanNullable(value) {
    if (typeof value !== "string")
        return null;
    const cleaned = value.replace(/\s+/g, " ").trim();
    return cleaned && cleaned !== "-" ? cleaned : null;
}
function normalizeDay(value) {
    const cleaned = cleanNullable(value);
    return cleaned ? DAY_MAP[cleaned.toUpperCase()] ?? DAY_MAP[cleaned] ?? null : null;
}
function normalizeTime(value) {
    const match = cleanNullable(value)?.match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
    return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}
function validIsoDate(value) {
    const normalized = cleanNullable(value);
    const match = normalized?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || !normalized)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day ? normalized : null;
}
function academicYear(value) {
    const normalized = cleanNullable(value);
    return normalized && /^\d{4}$/.test(normalized) ? normalized : null;
}
function confidence(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
}
function parseImageDataUrl(imageDataUrl) {
    const match = imageDataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
    if (!match)
        throw new Error("Gemini requires a valid base64 image data URL.");
    return { data: match[2].replace(/\s+/g, ""), mimeType: match[1] };
}
function interactionOutputText(response) {
    return response.steps
        ?.filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .filter((content) => content.type === "text")
        .map((content) => content.text ?? "")
        .join("")
        .trim() ?? "";
}
function temporalCandidates(entries) {
    return entries.map((entry, entryIndex) => ({
        entryIndex,
        courseCode: entry.courseCode,
        courseName: entry.courseName,
        day: entry.day,
        endTime: entry.endTime,
        section: entry.section,
        startTime: entry.startTime,
    }));
}
function normalizePayload(value, baseEntries) {
    if (!value || typeof value !== "object") {
        throw new Error("Gemini returned an invalid schedule temporal payload.");
    }
    const payload = value;
    const reviews = Array.isArray(payload.entries) ?
        payload.entries : [];
    const entries = baseEntries.map((entry) => ({ ...entry }));
    let appliedEntryCount = 0;
    for (const review of reviews) {
        const index = Number(review.entry_index);
        const evidence = cleanNullable(review.evidence);
        if (!Number.isInteger(index) ||
            index < 0 ||
            index >= entries.length ||
            confidence(review.confidence) < 0.8 ||
            !evidence)
            continue;
        const day = normalizeDay(review.day);
        const startTime = normalizeTime(review.start_time);
        const endTime = normalizeTime(review.end_time);
        const validRange = startTime && endTime && startTime < endTime;
        if (!day && !validRange)
            continue;
        const current = entries[index];
        entries[index] = {
            ...current,
            ...(day ? { day } : {}),
            ...(validRange ? {
                classTime: `${startTime}-${endTime}`,
                endTime,
                startTime,
            } : {}),
            parserSource: `${current.parserSource ?? "schedule"}+gemini-temporal-review`,
        };
        appliedEntryCount += 1;
    }
    const calendarEvidence = cleanNullable(payload.calendar_evidence);
    const trustCalendar = confidence(payload.calendar_confidence) >= 0.8 &&
        Boolean(calendarEvidence);
    return {
        academicYear: trustCalendar ? academicYear(payload.academic_year) : null,
        appliedEntryCount,
        entries,
        semesterEnd: trustCalendar ? validIsoDate(payload.semester_end) : null,
        semesterStart: trustCalendar ? validIsoDate(payload.semester_start) : null,
    };
}
async function reviewScheduleTemporalFieldsWithGemini({ apiKey, entries, imageDataUrl, rawText, }) {
    if (!entries.length) {
        return {
            academicYear: null,
            appliedEntryCount: 0,
            entries,
            semesterEnd: null,
            semesterStart: null,
        };
    }
    const image = parseImageDataUrl(imageDataUrl);
    const response = await fetch("https://generativelanguage.googleapis.com/v1/interactions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
            model: process.env.GEMINI_SCHEDULE_MODEL ?? "gemini-3.5-flash",
            store: false,
            system_instruction: exports.SCHEDULE_TEMPORAL_REVIEW_SYSTEM_PROMPT,
            // /v1/interactions takes content parts only inside a user_input step. These
            // were sent bare, which v1beta accepted and v1 rejects ("The value 'image'
            // is not supported for 'type'"), so after the 2026-08-07 move to v1 every
            // one of these reviews failed and the scan kept its unreviewed values.
            input: [{ type: "user_input", content: [
                        {
                            type: "text",
                            text: `Verify only temporal fields for these indexed candidates:\n${JSON.stringify(temporalCandidates(entries))}\n\nOCR hints:\n${rawText.slice(0, 30000)}`,
                        },
                        {
                            type: "image",
                            data: image.data,
                            mime_type: image.mimeType,
                        },
                    ] }],
            response_format: {
                type: "text",
                mime_type: "application/json",
                schema: SCHEDULE_TEMPORAL_SCHEMA,
            },
        }),
    });
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error?.message ?? `Gemini request failed with ${response.status}.`);
    }
    const outputText = interactionOutputText(payload);
    if (!outputText)
        throw new Error("Gemini returned no schedule temporal output.");
    return normalizePayload(JSON.parse(outputText), entries);
}
//# sourceMappingURL=gemini-fallback.js.map