/**
 * The text a scanned general document is saved with as a note.
 *
 * The user's edit wins whenever there is one -- even an empty one: falling
 * back to the scan would save exactly the text they had just removed. Without
 * an edit, the parsed document text, then the raw OCR text.
 */
export function documentNoteText(
  draft: Record<string, unknown>,
  parsedText: unknown,
  rawText: unknown,
): string {
  if (typeof draft.documentText === 'string') return draft.documentText.trim();
  const scanned = (typeof parsedText === 'string' && parsedText.trim()) ||
    (typeof rawText === 'string' ? rawText : '');
  return scanned.trim();
}
