/**
 * The one rule about a scanned timetable cell's two clock readings, shared by
 * the review screen and the save path so the two cannot disagree.
 *
 * OCR hands back an end at or before its start often enough that the save used
 * to quietly rewrite the pair to "start plus one hour". That wrote a duration
 * nobody chose into every week of the term, with nothing on screen to say it
 * had happened. Both callers ask here now, and both say the same sentence.
 */

/** `HH:MM` or `HH.MM` as minutes past midnight, or null when it is not a clock reading. */
export function clockMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2})\s*[:.]\s*(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Why these two readings cannot be one class, or null when they can.
 *
 * A class does not run past midnight, so an end that is not after its start is
 * always a misreading rather than an overnight session. A reading that is
 * missing or garbled is somebody else's complaint -- the caller already asks
 * for those fields -- so it is passed over here rather than reported twice.
 */
export function timetableHoursProblem(startTime: string, endTime: string): string | null {
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime);
  if (start === null || end === null) return null;
  if (end <= start) return `เวลาสิ้นสุดต้องอยู่หลัง ${startTime.trim()}`;
  return null;
}
