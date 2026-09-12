export const THAILAND_TIME_ZONE = 'Asia/Bangkok';

const THAILAND_OFFSET_MS = 7 * 60 * 60 * 1000;

export function formatThaiDate(value: Date | number | string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'long',
    timeZone: THAILAND_TIME_ZONE,
    year: 'numeric',
    ...options,
  }).format(new Date(value));
}

export function formatThaiTime(value: Date | number | string) {
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: THAILAND_TIME_ZONE,
  }).format(new Date(value));
}

export function formatThaiDateTime(value: Date | number | string) {
  return `${formatThaiDate(value)} ${formatThaiTime(value)} น.`;
}

function thailandParts(value: Date) {
  const shifted = new Date(value.getTime() + THAILAND_OFFSET_MS);
  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth(),
    weekday: shifted.getUTCDay(),
    year: shifted.getUTCFullYear(),
  };
}

function thailandMidnightUtc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day) - THAILAND_OFFSET_MS);
}

export function thailandRange(period: 'day' | 'month' | 'week', value = new Date()) {
  const parts = thailandParts(value);
  if (period === 'month') {
    return {
      from: thailandMidnightUtc(parts.year, parts.month, 1),
      to: new Date(thailandMidnightUtc(parts.year, parts.month + 1, 1).getTime() - 1),
    };
  }
  const mondayOffset = (parts.weekday + 6) % 7;
  const startDay = period === 'week' ? parts.day - mondayOffset : parts.day;
  const durationDays = period === 'week' ? 7 : 1;
  const from = thailandMidnightUtc(parts.year, parts.month, startDay);
  return {from, to: new Date(from.getTime() + durationDays * 24 * 60 * 60 * 1000 - 1)};
}

/** Calendar fields of `value` as they read on a clock in Bangkok. */
export function thailandCalendarParts(value: Date | number | string = new Date()) {
  const shifted = new Date(new Date(value).getTime() + THAILAND_OFFSET_MS);
  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth(),
    year: shifted.getUTCFullYear(),
  };
}

/** `YYYY-MM` for the Bangkok month containing `value`. */
export function thailandMonthKey(value: Date | number | string = new Date()) {
  const {month, year} = thailandCalendarParts(value);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` for the Bangkok day containing `value`. */
export function thailandDateKey(value: Date | number | string = new Date()) {
  const {day, month, year} = thailandCalendarParts(value);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** `HH:mm` for the Bangkok wall clock at `value`. */
export function thailandTimeKey(value: Date | number | string = new Date()) {
  const shifted = new Date(new Date(value).getTime() + THAILAND_OFFSET_MS);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Turns a `YYYY-MM-DD` + `HH:mm` pair that the user read off a clock in
 * Bangkok into the instant it names.
 *
 * Every screen in this app renders times with `timeZone: 'Asia/Bangkok'`, so
 * the strings held by the forms are Bangkok wall clock by definition. Building
 * the instant with `new Date(`${date}T${time}:00`)` instead reads them in
 * whatever zone the device happens to be set to, and the two only agree when
 * that zone is UTC+7. On any other device the saved activity came back
 * displaced by the offset -- and near midnight by a whole day, because a 23:45
 * pick on a UTC device stored 23:45Z and the calendar drew it as 06:45 the
 * next morning. Thailand has never observed DST, so the offset is a constant.
 */
export function thailandWallClockToDate(dateText: string, timeText: string) {
  const [year, month, day] = String(dateText).split('-').map(Number);
  const [hour, minute] = String(timeText).split(':').map(Number);
  if (![year, month, day].every(Number.isFinite) || ![hour, minute].every(Number.isFinite)) return new Date(NaN);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - THAILAND_OFFSET_MS);
}

/** Steps a `YYYY-MM` key by whole months. Accepts and returns Bangkok month keys. */
export function shiftMonthKey(monthKey: string, months: number) {
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Steps a `YYYY-MM-DD` Bangkok day key by whole days. */
export function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return dateKey;
  // Arithmetic in UTC so the result never depends on the device's own clock.
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

/** Day of week (0 = Sunday) of the Bangkok day containing `value`. */
export function thailandWeekday(value: Date | number | string = new Date()) {
  const shifted = new Date(new Date(value).getTime() + THAILAND_OFFSET_MS);
  return shifted.getUTCDay();
}

/**
 * Midnight in Bangkok on the Bangkok day containing `value`, optionally moved
 * by whole days.
 *
 * `date.setHours(0, 0, 0, 0)` is the device-local version of this and is the
 * shape the bug keeps taking: it lands on the device's midnight, which is not
 * Bangkok's unless the device is UTC+7, and stepping days with `setDate` has
 * the same problem.
 */
export function thailandDayStart(value: Date | number | string = new Date(), offsetDays = 0) {
  return thailandWallClockToDate(shiftDateKey(thailandDateKey(value), offsetDays), '00:00');
}

/**
 * The instant at a given Bangkok wall-clock hour on the Bangkok day containing
 * `value`, optionally moved by whole days. The counterpart of
 * `date.setHours(hour, minute, 0, 0)` for a codebase that renders every time in
 * `Asia/Bangkok`.
 */
export function thailandAtHour(value: Date | number | string, hour: number, minute = 0, offsetDays = 0) {
  const dateKey = shiftDateKey(thailandDateKey(value), offsetDays);
  return thailandWallClockToDate(dateKey, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
}

/** Number of days in the Bangkok month containing `value`. */
export function thailandDaysInMonth(value: Date | number | string = new Date()) {
  const {month, year} = thailandCalendarParts(value);
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
