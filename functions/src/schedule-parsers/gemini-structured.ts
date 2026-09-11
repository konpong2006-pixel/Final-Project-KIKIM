// Schemas passed here must carry no minimum/maximum/maxItems/minItems:
// /v1/interactions rejects them alongside nullable types ("Request contains an
// invalid argument"), so values are range-checked after parsing instead.

/** Newest first; an older model answers when a newer one is missing or busy. */
export const STRUCTURED_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];

type InteractionResponse = {
  error?: {message?: string};
  steps?: {content?: {text?: string; type?: string}[]; type?: string}[];
};

/**
 * One image plus a text prompt to Gemini, answered as JSON matching `schema`,
 * or null when no model could answer. Shared by every schedule reading that
 * asks the model to look at the scan itself.
 */
export async function requestStructuredJson<T>({
  apiKey,
  imageDataUrl,
  label,
  prompt,
  schema,
  text,
  timeoutMs = 18000,
}: {
  apiKey: string;
  imageDataUrl: string;
  /** Log prefix, e.g. "Schedule grid". */
  label: string;
  prompt: string;
  schema: unknown;
  text: string;
  timeoutMs?: number;
}): Promise<{model: string; value: T} | null> {
  const image = imageDataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!apiKey || !image) return null;
  for (const [index, model] of STRUCTURED_MODELS.entries()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1/interactions", {
        method: "POST",
        headers: {"Content-Type": "application/json", "x-goog-api-key": apiKey},
        body: JSON.stringify({
          model,
          store: false,
          system_instruction: prompt,
          // v1 wants the parts inside a user_input step; bare parts are what
          // broke every image request after the move from v1beta.
          input: [{
            type: "user_input",
            content: [
              {type: "text", text},
              {type: "image", data: image[2].replace(/\s+/g, ""), mime_type: image[1]},
            ],
          }],
          response_format: {type: "text", mime_type: "application/json", schema},
        }),
        signal: controller.signal,
      });
      const payload = await response.json() as InteractionResponse;
      if (!response.ok) {
        const retryable = response.status === 404 || response.status === 429 || response.status >= 500;
        if (retryable && index < STRUCTURED_MODELS.length - 1) continue;
        console.warn(`[${label}] Gemini refused the extraction.`, {message: payload.error?.message, model, status: response.status});
        return null;
      }
      const answer = payload.steps
        ?.filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .filter((content) => content.type === "text")
        .map((content) => content.text ?? "")
        .join("")
        .trim() ?? "";
      return {model, value: JSON.parse(answer) as T};
    } catch (error) {
      // A timeout is the model being slow, not wrong: a real scan waited out
      // 30 s on one model while the next would have answered.
      const timedOut = error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
      console.warn(`[${label}] Gemini extraction failed.`, {error: error instanceof Error ? error.message : String(error), model});
      if (timedOut && index < STRUCTURED_MODELS.length - 1) continue;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
