// Schemas here carry no minimum/maximum/maxItems/minItems: /v1/interactions
// rejects them alongside nullable types ("Request contains an invalid
// argument"), and the values are range-checked after parsing anyway.
export type GeminiDocumentTimestamp = {
  calendarEra: "AD" | "BE" | "UNKNOWN";
  confidence: number;
  date: string | null;
  evidence: string | null;
  printedYear: number | null;
  time: string | null;
};

type GeminiInteractionResponse = {
  error?: {message?: string};
  steps?: {
    content?: {text?: string; type?: string}[];
    type?: string;
  }[];
};

const DOCUMENT_TIMESTAMP_PROMPT = `You are a document timestamp verifier for Thai receipts, payment slips, and e-wallet payment screenshots.

Your only task is to read the transaction date and transaction time printed inside the financial document.

STRICT RULES
1. Return only a date and time that are visibly tied to the receipt, transfer, payment, transaction, or reference details.
2. Ignore the phone status bar, screenshot clock, browser chrome, upload time, app UI, current system date, and OCR-processing time.
3. Do not extract merchant names, amounts, products, categories, account numbers, or reference numbers.
4. Never guess. If the document does not visibly show a reliable date or time, return null for that field.
5. Read the printed year digit by digit. A year from 2400 through 2999 is Buddhist Era (BE) unless the document explicitly labels it otherwise. A year from 1900 through 2399 is Gregorian/AD unless explicitly labelled otherwise.
6. Return printed_year exactly as shown and calendar_era as BE, AD, or UNKNOWN. For example, printed year 2569 is BE and corresponds to Gregorian year 2026; it must never become 2021.
7. Normalize transaction_date to Gregorian ISO YYYY-MM-DD. For BE, subtract exactly 543 from the printed year. For AD, keep the printed year.
8. Normalize a visible time to 24-hour HH:mm.
9. The deterministic OCR candidate is authoritative when its exact printed date/time is clearly visible in the image. Confirm it rather than replacing it. Report a different value only when the image clearly contradicts the OCR candidate.
10. evidence must be a short exact excerpt from the document that supports the returned date/time, or null.
11. confidence is 0 to 1 and must reflect only timestamp certainty.
12. Return only the JSON required by the response schema.`;

const DOCUMENT_TIMESTAMP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    transaction_date: {type: ["string", "null"]},
    transaction_time: {type: ["string", "null"]},
    printed_year: {type: ["integer", "null"]},
    calendar_era: {type: "string", enum: ["BE", "AD", "UNKNOWN"]},
    confidence: {type: "number"},
    evidence: {type: ["string", "null"]},
  },
  required: [
    "transaction_date",
    "transaction_time",
    "printed_year",
    "calendar_era",
    "confidence",
    "evidence",
  ],
} as const;

function parseImageDataUrl(imageDataUrl: string) {
  const match = imageDataUrl.match(
    /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i,
  );
  if (!match) {
    throw new Error("Gemini requires a valid base64 image data URL.");
  }
  return {
    data: match[2].replace(/\s+/g, ""),
    mimeType: match[1],
  };
}

function interactionOutputText(response: GeminiInteractionResponse) {
  return response.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("")
    .trim() ?? "";
}

function validIsoDate(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const test = new Date(Date.UTC(year, month - 1, day));
  return test.getUTCFullYear() === year &&
    test.getUTCMonth() === month - 1 &&
    test.getUTCDate() === day
    ? normalized
    : null;
}

function validTime(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? normalized
    : null;
}

function normalizeResult(value: unknown): GeminiDocumentTimestamp {
  if (!value || typeof value !== "object") {
    throw new Error("Gemini returned an invalid document timestamp payload.");
  }
  const payload = value as Record<string, unknown>;
  const rawConfidence = Number(payload.confidence);
  const rawPrintedYear = Number(payload.printed_year);
  const printedYear = Number.isInteger(rawPrintedYear) &&
    rawPrintedYear >= 1000 && rawPrintedYear <= 2999 ? rawPrintedYear : null;
  const calendarEra = payload.calendar_era === "BE" || payload.calendar_era === "AD" ?
    payload.calendar_era : "UNKNOWN";
  const evidence = typeof payload.evidence === "string" &&
    payload.evidence.trim()
    ? payload.evidence.replace(/\s+/g, " ").trim().slice(0, 240)
    : null;
  let date = validIsoDate(payload.transaction_date);
  if (date && printedYear !== null && calendarEra !== "UNKNOWN") {
    const expectedYear = calendarEra === "BE" ? printedYear - 543 : printedYear;
    const [, month, day] = date.split("-");
    date = validIsoDate(`${String(expectedYear).padStart(4, "0")}-${month}-${day}`);
  }
  return {
    calendarEra,
    confidence: Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0,
    date,
    evidence,
    printedYear,
    time: validTime(payload.transaction_time),
  };
}

export async function extractDocumentTimestampWithGemini({
  apiKey,
  imageDataUrl,
  ocrCandidate,
  rawText,
}: {
  apiKey: string;
  imageDataUrl: string;
  ocrCandidate?: {
    calendarEra?: string;
    date?: string | null;
    evidence?: string | null;
    printedYear?: number | null;
    time?: string | null;
  };
  rawText: string;
}) {
  const image = parseImageDataUrl(imageDataUrl);
  const models = [...new Set([
    process.env.GEMINI_RECEIPT_MODEL,
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
  ].filter((value): value is string => Boolean(value)))];
  let response: Response | null = null;
  let payload: GeminiInteractionResponse = {};
  for (const [index, model] of models.entries()) {
    response = await fetch(
      "https://generativelanguage.googleapis.com/v1/interactions",
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        store: false,
        system_instruction: DOCUMENT_TIMESTAMP_PROMPT,
        // /v1/interactions takes content parts only inside a user_input step. These
        // were sent bare, which v1beta accepted and v1 rejects ("The value 'image'
        // is not supported for 'type'"), so after the 2026-08-07 move to v1 every
        // one of these reviews failed and the scan kept its unreviewed values.
        input: [{type: "user_input", content: [
          {
            type: "text",
            text: `Deterministic OCR candidate (keep it when the image visibly agrees):\n${JSON.stringify(ocrCandidate ?? null)}\n\nFull OCR evidence may contain recognition errors. Use the image to verify only the document's transaction date/time:\n${rawText.slice(0, 30000)}`,
          },
          {
            type: "image",
            data: image.data,
            mime_type: image.mimeType,
          },
        ]}],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: DOCUMENT_TIMESTAMP_SCHEMA,
        },
      }),
      },
    );
    payload = await response.json() as GeminiInteractionResponse;
    if (response.ok || response.status !== 404 || index === models.length - 1) break;
  }
  if (!response) throw new Error("Gemini timestamp request could not start.");
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `Gemini request failed with ${response.status}.`,
    );
  }
  const outputText = interactionOutputText(payload);
  if (!outputText) {
    throw new Error("Gemini returned no document timestamp output.");
  }
  return normalizeResult(JSON.parse(outputText) as unknown);
}
