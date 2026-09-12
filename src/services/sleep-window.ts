/**
 * Clock-window arithmetic for the declared "usual sleep" baseline, kept apart
 * from `sleep-log` so it carries no Firestore or AsyncStorage import. The
 * burnout model and its tests need these numbers without a device or a network.
 */

/** Shortest and longest spans accepted as describing one night. */
export const MINIMUM_NIGHT_HOURS = 2;
export const MAXIMUM_NIGHT_HOURS = 14;

export type SleepWindow = {
  /** Minutes past midnight the user usually goes to bed. */
  bedtimeMinutes: number;
  /** Minutes past midnight the user usually wakes. */
  wakeMinutes: number;
};

/** `HH:MM` to minutes past midnight, or null when the text is not a clock time. */
export function parseClockMinutes(value: string) {
  const match = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*$/.exec(String(value));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatClockMinutes(minutes: number) {
  const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Hours between the two clock times, wrapping past midnight, which is the
 * normal case for a bedtime. Returns null for a window that cannot describe a
 * night, so an unusable baseline never reaches the model as a number at all
 * rather than arriving clamped to something the user never said.
 */
export function baselineNightHours(window: SleepWindow | null) {
  if (!window) return null;
  const {bedtimeMinutes, wakeMinutes} = window;
  if (![bedtimeMinutes, wakeMinutes].every((value) => Number.isInteger(value) && value >= 0 && value < 1440)) return null;
  const span = ((wakeMinutes - bedtimeMinutes) + 1440) % 1440;
  const hours = Math.round((span / 60) * 10) / 10;
  return hours >= MINIMUM_NIGHT_HOURS && hours <= MAXIMUM_NIGHT_HOURS ? hours : null;
}

export function isValidSleepWindow(window: SleepWindow | null) {
  return baselineNightHours(window) !== null;
}

/** Provisional length used when there is no baseline to go on. */
export const DEFAULT_NIGHT_HOURS = 8;

/**
 * The wake time to offer for a session the user forgot to close: their usual
 * wake time on the morning after they went to bed, falling back to a default
 * night length. Never returns something outside the range a night can be, so
 * confirming the suggestion always produces a record the model will accept.
 */
export function suggestedWakeTime(startedAt: Date, window: SleepWindow | null) {
  const hours = baselineNightHours(window);
  if (hours === null || !window) return new Date(startedAt.getTime() + DEFAULT_NIGHT_HOURS * 36e5);
  const candidate = new Date(startedAt);
  candidate.setHours(Math.floor(window.wakeMinutes / 60), window.wakeMinutes % 60, 0, 0);
  // A wake time at or before bedtime belongs to the next morning.
  if (candidate <= startedAt) candidate.setDate(candidate.getDate() + 1);
  const span = (candidate.getTime() - startedAt.getTime()) / 36e5;
  return span >= MINIMUM_NIGHT_HOURS && span <= MAXIMUM_NIGHT_HOURS
    ? candidate
    : new Date(startedAt.getTime() + hours * 36e5);
}
