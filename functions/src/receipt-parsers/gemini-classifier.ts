import type {ScanClassification} from "./deterministic-receipt";

/**
 * Asks Gemini what kind of document a scan actually is.
 *
 * The keyword scorer it backs up can only recognise phrasings someone thought
 * to enumerate. That cut both ways: before the `document` category existed
 * every unrecognised page became a receipt, and afterwards a real Kasikorn
 * transfer slip -- "โอนเงินสำเร็จ", a masked account number, a receiving bank
 * -- scored 6 and fell to `document`, because none of that vocabulary was on
 * the list. Hand-enumerating every bank, wallet and slip layout in Thailand is
 * not a strategy, so the ambiguous cases get a model that reads the text.
 *
 * OCR is untouched: this only sees text Vision and iApp already extracted.
 */

const CLASSIFY_SYSTEM_PROMPT = `You classify a scanned document for a Thai student app.

Choose exactly ONE type:
- "receipt": the record of ONE financial transaction -- one payment or
  transfer, one amount. This includes shop receipts and tax invoices, but
  equally bank transfer slips and confirmations (Kasikorn/K PLUS, SCB,
  Krungthai, Bangkok Bank, TrueMoney, PromptPay), wallet payment
  confirmations, and "transfer successful" screens. Evidence includes an
  amount of money together with a payer, payee, account number, reference
  number or transaction timestamp.
- "schedule": a WEEKLY class or exam timetable -- courses or subjects placed
  in recurring weekday and time slots, typically a grid with day rows and
  time columns or a list pairing each course with a day and a time. Day
  names are often abbreviated (MON, TUE / จ. อ. พ. พฤ. ศ.) and course codes
  look like ACC315-68 or 2110101.
- "document": readable text that is neither of the above. Announcements,
  notices, letters, forms, lecture notes, articles. Also, specifically:
  * bank passbooks (สมุดบัญชี), account statements and any list of SEVERAL
    dated transactions with a running balance -- many transactions, so not
    a receipt;
  * academic calendars (ปฏิทินการศึกษา) listing term dates, fee or
    registration notices, and opening hours -- they mention days, dates,
    times or "ปีการศึกษา" but place no courses in weekly slots, so they are
    not schedules;
  * an exam announcement listing exam sessions is a document, not a
    schedule.

Reply with STRICT JSON only, no prose:
{"type":"receipt"|"schedule"|"document","confidence":0.0-1.0,"reason":"under 12 words"}`;

/**
 * Newest first. The interactions endpoint answers 404 for a model this key
 * cannot reach, and the project has already been bitten by a model being
 * retired underneath it, so every call site walks a fallback list.
 */
const CLASSIFIER_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
];

type InteractionResponse = {
  error?: {message?: string};
  steps?: {content?: {text?: string; type?: string}[]; type?: string}[];
};

function interactionOutputText(response: InteractionResponse) {
  return response.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("")
    .trim() ?? "";
}

export type GeminiClassification = {
  confidence: number;
  model: string;
  reason: string;
  type: ScanClassification["type"];
};

/**
 * Returns Gemini's verdict, or null when it cannot answer. A null is not an
 * error the user should see: the caller keeps the deterministic result, so a
 * Gemini outage degrades the scan to its previous behaviour rather than
 * failing it.
 */
export async function classifyScanWithGemini(
  rawText: string,
  apiKey: string,
  timeoutMs = 12000,
): Promise<GeminiClassification | null> {
  const text = rawText.trim();
  if (!apiKey || text.length < 8) return null;

  for (const [index, model] of CLASSIFIER_MODELS.entries()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model,
          store: false,
          system_instruction: CLASSIFY_SYSTEM_PROMPT,
          // Only the OCR text is sent. The image is not needed to tell a
          // transfer slip from a timetable, and leaving it out keeps this
          // call far cheaper than the extraction calls around it.
          input: text.slice(0, 12000),
          response_format: {mime_type: "application/json", type: "text"},
        }),
        signal: controller.signal,
      });
      const payload = await response.json() as InteractionResponse;
      if (!response.ok) {
        // 404: this key cannot reach the model. 429 and 5xx: it is
        // overloaded -- a real scan got "gemini-3.8-flash is currently
        // experiencing high demand" and the keyword guess then stood alone,
        // which is exactly the inconsistency being fixed. Either way the next,
        // older model is a better answer than none.
        const retryable = response.status === 404 || response.status === 429 || response.status >= 500;
        if (retryable && index < CLASSIFIER_MODELS.length - 1) continue;
        console.warn("[Scan classify] Gemini refused the request.", {
          message: payload.error?.message,
          model,
          status: response.status,
        });
        return null;
      }
      const parsed = JSON.parse(interactionOutputText(payload)) as unknown;
      const record = parsed as {confidence?: unknown; reason?: unknown; type?: unknown};
      if (record.type !== "receipt" && record.type !== "schedule" && record.type !== "document") {
        console.warn("[Scan classify] Gemini returned an unknown type.", {type: record.type});
        return null;
      }
      const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence) ?
        Math.min(1, Math.max(0, record.confidence)) :
        0.8;
      return {
        confidence: Number(confidence.toFixed(2)),
        model,
        reason: typeof record.reason === "string" ? record.reason.slice(0, 120) : "",
        type: record.type,
      };
    } catch (error) {
      // A timeout, a network failure or unparseable JSON all mean the same
      // thing here: fall back to the deterministic verdict.
      console.warn("[Scan classify] Gemini classification failed.", {
        error: error instanceof Error ? error.message : String(error),
        model,
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
