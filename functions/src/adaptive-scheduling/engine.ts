import {
  AdaptiveActivityCategory,
  AdaptiveScoredSlot,
  AdaptiveSchedulingPattern,
  AdaptiveSchedulingPreferences,
  AdaptiveSlotRequest,
  AdaptiveSlotScoreBreakdown,
  AdaptiveTimePeriod,
  EngineScheduleItem,
  PatternBehaviorObservation,
} from "./types";

const MINUTE_MS = 60_000;

export const DEFAULT_ADAPTIVE_PREFERENCES: AdaptiveSchedulingPreferences = {
  allowAiSuggestions: true,
  allowAutomaticRescheduling: false,
  allowBehavioralPersonalization: true,
  allowGeminiInsights: true,
  availableDays: [0, 1, 2, 3, 4, 5, 6],
  earliestSchedulingTime: "05:00",
  latestSchedulingTime: "23:59",
  maximumDailyWorkMinutes: 480,
  maximumFocusSessionMinutes: 120,
  minimumAutomaticConfidence: 0.8,
  minimumBreakMinutes: 15,
  notificationsEnabled: true,
  preferredTimeByCategory: {},
  sleepTime: "23:00",
  scoreWeights: {
    burnoutPenalty: 18,
    categoryPreference: 24,
    completionProbability: 32,
    deadlineUrgency: 20,
    postponementPenalty: 22,
    priority: 16,
    userPreference: 28,
    workloadPenalty: 20,
  },
  thresholds: {
    highObservationCount: 11,
    lowObservationCount: 3,
    mediumObservationCount: 6,
  },
  timeZone: "Asia/Bangkok",
  transitionMinutes: 10,
  unavailablePeriods: [],
  wakeTime: "06:00",
};

export function parseClockMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function validateMovableScheduleItem(item: {
  allowAiReschedule: boolean;
  googleEventId?: string;
  isFlexible: boolean;
  isLocked: boolean;
  source?: string;
}) {
  if (!item.isFlexible) return {code: "fixed" as const, ok: false};
  if (item.isLocked) return {code: "locked" as const, ok: false};
  if (!item.allowAiReschedule) return {code: "disabled" as const, ok: false};
  if (item.googleEventId || item.source === "google-calendar") return {code: "external" as const, ok: false};
  return {ok: true as const};
}

export function adaptiveTimePeriod(hour: number): AdaptiveTimePeriod {
  if (hour >= 5 && hour < 8) return "early_morning";
  if (hour >= 8 && hour < 11) return "morning";
  if (hour >= 11 && hour < 13) return "late_morning";
  if (hour >= 13 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

function zonedParts(timestampMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    weekday: "short",
    year: "numeric",
  }).formatToParts(new Date(timestampMs));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  const hour = Number(value("hour")) % 24;
  return {
    day: Number(value("day")),
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    dayOfWeek: weekday,
    hour,
    minute: Number(value("minute")),
    minuteOfDay: hour * 60 + Number(value("minute")),
    month: Number(value("month")),
    year: Number(value("year")),
  };
}

/** Returns midnight for a calendar day in the supplied IANA time zone. */
export function zonedDayStart(referenceMs: number, timeZone: string, dayOffset = 0) {
  const source = zonedParts(referenceMs, timeZone);
  const shifted = new Date(Date.UTC(source.year, source.month - 1, source.day + dayOffset));
  const target = {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    year: shifted.getUTCFullYear(),
  };
  const desiredWallClock = Date.UTC(target.year, target.month - 1, target.day, 0, 0);
  let candidate = desiredWallClock;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(candidate, timeZone);
    const actualWallClock = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const correction = desiredWallClock - actualWallClock;
    candidate += correction;
    if (correction === 0) break;
  }
  const verified = zonedParts(candidate, timeZone);
  if (verified.year !== target.year || verified.month !== target.month || verified.day !== target.day) {
    throw new Error(`Unable to resolve ${target.year}-${target.month}-${target.day} in ${timeZone}`);
  }
  return candidate;
}

function overlaps(startMs: number, endMs: number, item: EngineScheduleItem, bufferMinutes: number) {
  const buffer = bufferMinutes * MINUTE_MS;
  return startMs < item.endMs + buffer && endMs > item.startMs - buffer;
}

export function overlappingScheduleItems(startMs: number, endMs: number, items: EngineScheduleItem[], bufferMinutes = 0) {
  return items.filter((item) => overlaps(startMs, endMs, item, bufferMinutes));
}

function withinClockWindow(startMinute: number, endMinute: number, windowStart: number, windowEnd: number) {
  if (windowEnd >= windowStart) return startMinute >= windowStart && endMinute <= windowEnd;
  return startMinute >= windowStart || endMinute <= windowEnd;
}

function unavailable(
  startMs: number,
  endMs: number,
  preferences: AdaptiveSchedulingPreferences,
  category: AdaptiveActivityCategory,
  options: {explicitDate?: boolean} = {},
) {
  const start = zonedParts(startMs, preferences.timeZone);
  const end = zonedParts(endMs - 1, preferences.timeZone);
  if (start.dateKey !== end.dateKey || (!options.explicitDate && !preferences.availableDays.includes(start.dayOfWeek))) return true;

  const earliest = parseClockMinutes(preferences.earliestSchedulingTime) ?? 300;
  const latest = parseClockMinutes(preferences.latestSchedulingTime) ?? 1439;
  if (!withinClockWindow(start.minuteOfDay, end.minuteOfDay + 1, earliest, latest)) return true;

  const wake = preferences.wakeTime ? parseClockMinutes(preferences.wakeTime) : null;
  const sleep = preferences.sleepTime ? parseClockMinutes(preferences.sleepTime) : null;
  if (wake !== null && sleep !== null && !withinClockWindow(start.minuteOfDay, end.minuteOfDay + 1, wake, sleep)) return true;

  return preferences.unavailablePeriods.some((period) => {
    if (period.category && period.category !== category) return false;
    if (!period.days.includes(start.dayOfWeek)) return false;
    const periodStart = parseClockMinutes(period.startTime);
    const periodEnd = parseClockMinutes(period.endTime);
    if (periodStart === null || periodEnd === null) return true;
    return start.minuteOfDay < periodEnd && end.minuteOfDay + 1 > periodStart;
  });
}

function dayWorkloadMinutes(startMs: number, items: EngineScheduleItem[], timeZone: string) {
  const dateKey = zonedParts(startMs, timeZone).dateKey;
  return items.reduce((total, item) => {
    if (zonedParts(item.startMs, timeZone).dateKey !== dateKey) return total;
    return total + Math.max(0, (item.endMs - item.startMs) / MINUTE_MS);
  }, 0);
}

function matchingPattern(patterns: AdaptiveSchedulingPattern[], category: AdaptiveActivityCategory, startMs: number, timeZone: string) {
  const parts = zonedParts(startMs, timeZone);
  return patterns
    .filter((pattern) => pattern.activityCategory === category && (pattern.dayOfWeek === null || pattern.dayOfWeek === parts.dayOfWeek))
    .sort((left, right) => {
      const leftDay = left.dayOfWeek === parts.dayOfWeek ? 1 : 0;
      const rightDay = right.dayOfWeek === parts.dayOfWeek ? 1 : 0;
      return rightDay - leftDay || right.confidenceScore - left.confidenceScore;
    })[0];
}

function scoreSlot(request: AdaptiveSlotRequest, startMs: number, endMs: number): AdaptiveScoredSlot {
  const {category, patterns, preferences, priority, scheduleItems} = request;
  const pattern = preferences.allowBehavioralPersonalization ? matchingPattern(patterns, category, startMs, preferences.timeZone) : undefined;
  const parts = zonedParts(startMs, preferences.timeZone);
  const preferred = preferences.preferredTimeByCategory[category];
  const preferredStart = preferred ? parseClockMinutes(preferred.startTime) : null;
  const preferredEnd = preferred ? parseClockMinutes(preferred.endTime) : null;
  const inExplicitPreference = preferredStart !== null && preferredEnd !== null &&
    withinClockWindow(parts.minuteOfDay, zonedParts(endMs - 1, preferences.timeZone).minuteOfDay + 1, preferredStart, preferredEnd);
  const inLearnedPreference = Boolean(pattern && parts.hour >= pattern.preferredStartHour && parts.hour < pattern.preferredEndHour);
  const workload = dayWorkloadMinutes(startMs, scheduleItems, preferences.timeZone) + request.durationMinutes;
  const workloadRatio = Math.min(1.5, workload / preferences.maximumDailyWorkMinutes);
  const difficultBefore = scheduleItems.some((item) => item.isDifficult && item.endMs <= startMs && startMs - item.endMs < 90 * MINUTE_MS);
  const deadlineHours = request.deadlineMs ? Math.max(0, (request.deadlineMs - request.earliestStartMs) / (60 * MINUTE_MS)) : 168;
  const urgency = request.deadlineMs ? Math.max(0, 1 - deadlineHours / 168) : 0;
  const priorityFactor = {low: 0.2, medium: 0.45, high: 0.75, urgent: 1}[priority];
  const weights = preferences.scoreWeights;
  const breakdown: AdaptiveSlotScoreBreakdown = {
    burnoutPenalty: difficultBefore ? weights.burnoutPenalty : 0,
    categoryPreference: inLearnedPreference ? weights.categoryPreference * (pattern?.confidenceScore ?? 0) : 0,
    completionProbability: weights.completionProbability * (pattern?.completionRate ?? 0.5) * (pattern?.confidenceScore || 0.35),
    deadlineUrgency: weights.deadlineUrgency * urgency,
    postponementPenalty: weights.postponementPenalty * (pattern?.postponementRate ?? 0) * (pattern?.confidenceScore ?? 0),
    priority: weights.priority * priorityFactor,
    userPreference: inExplicitPreference ? weights.userPreference : 0,
    workloadPenalty: weights.workloadPenalty * Math.max(0, workloadRatio - 0.55),
  };
  const totalScore = breakdown.completionProbability + breakdown.categoryPreference + breakdown.userPreference +
    breakdown.deadlineUrgency + breakdown.priority - breakdown.workloadPenalty - breakdown.postponementPenalty - breakdown.burnoutPenalty;
  const expectedBenefit = inExplicitPreference ? "ตรงกับช่วงเวลาที่คุณเลือกไว้" :
    inLearnedPreference ? `สอดคล้องกับรูปแบบ ${pattern?.observationCount ?? 0} ครั้งล่าสุด` :
      workloadRatio < 0.7 ? "เป็นช่วงว่างที่ยังไม่เพิ่มภาระประจำวันมากเกินไป" : "เป็นช่วงว่างที่ผ่านข้อจำกัดทั้งหมด";
  return {breakdown, endMs, expectedBenefit, startMs, totalScore: Number(totalScore.toFixed(3))};
}

export function validateCandidateSlot(
  request: AdaptiveSlotRequest,
  startMs: number,
  endMs: number,
  options: {allowConflicts?: boolean; allowOutsideAvailability?: boolean; userSelectedTime?: boolean} = {},
) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || request.durationMinutes <= 0) {
    return {code: "invalid_duration" as const, message: "ช่วงเวลาหรือระยะเวลาไม่ถูกต้อง", ok: false};
  }
  if (request.deadlineMs && endMs > request.deadlineMs) {
    return {code: "deadline" as const, message: "ช่วงเวลานี้เลยกำหนดส่ง", ok: false};
  }
  if (startMs < request.earliestStartMs || endMs > request.latestEndMs) {
    return {code: "outside_availability" as const, message: "ช่วงเวลานี้อยู่นอกช่วงที่กำลังตรวจสอบ", ok: false};
  }
  if (request.requiredLocalDate) {
    const localStartDate = zonedParts(startMs, request.preferences.timeZone).dateKey;
    const localEndDate = zonedParts(endMs - 1, request.preferences.timeZone).dateKey;
    if (localStartDate !== request.requiredLocalDate || localEndDate !== request.requiredLocalDate) {
      return {code: "outside_requested_date" as const, message: "ช่วงเวลานี้ไม่ตรงกับวันที่ผู้ใช้ระบุ", ok: false};
    }
  }
  if (!options.userSelectedTime && !options.allowOutsideAvailability && unavailable(startMs, endMs, request.preferences, request.category, {explicitDate: Boolean(request.requiredLocalDate)})) {
    return {code: "outside_availability" as const, message: "ช่วงเวลานี้อยู่นอกเวลาที่พร้อมใช้งานหรือเวลานอน", ok: false};
  }
  if (request.requiredLocalTimeWindow) {
    const windowStart = parseClockMinutes(request.requiredLocalTimeWindow.startTime);
    const windowEnd = parseClockMinutes(request.requiredLocalTimeWindow.endTime);
    const localStart = zonedParts(startMs, request.preferences.timeZone);
    const localEnd = zonedParts(endMs - 1, request.preferences.timeZone);
    const isInsideRequestedPeriod = windowStart !== null && windowEnd !== null &&
      localStart.dateKey === localEnd.dateKey &&
      withinClockWindow(localStart.minuteOfDay, localEnd.minuteOfDay + 1, windowStart, windowEnd);
    if (!isInsideRequestedPeriod) {
      return {code: "outside_requested_period" as const, message: "ช่วงเวลานี้ไม่ตรงกับช่วงเวลาที่ผู้ใช้ระบุ", ok: false};
    }
  }
  const scheduleItems = options.userSelectedTime
    ? request.scheduleItems.filter((item) => !item.id.startsWith("suggestion-"))
    : request.scheduleItems;
  const requiredBreak = Math.max(request.preferences.transitionMinutes, request.preferences.minimumBreakMinutes);
  if (!options.allowConflicts && overlappingScheduleItems(startMs, endMs, scheduleItems, requiredBreak).length) {
    return {code: "conflict" as const, message: "ช่วงเวลานี้ชนกับรายการในตาราง", ok: false};
  }
  const workload = dayWorkloadMinutes(startMs, scheduleItems, request.preferences.timeZone) + request.durationMinutes;
  if (!options.userSelectedTime && workload > request.preferences.maximumDailyWorkMinutes) {
    return {code: "overload" as const, message: "ช่วงเวลานี้ทำให้ภาระงานต่อวันเกินค่าที่ตั้งไว้", ok: false};
  }
  return {ok: true};
}

export function findAdaptiveTimeSlots(request: AdaptiveSlotRequest, maximumResults = 8) {
  if (request.durationMinutes > request.preferences.maximumFocusSessionMinutes && request.category !== "rest") return [];
  const step = Math.max(15, Math.min(60, request.slotStepMinutes ?? 30)) * MINUTE_MS;
  const duration = request.durationMinutes * MINUTE_MS;
  const hardEnd = Math.min(request.latestEndMs, request.deadlineMs ?? request.latestEndMs);
  const results: AdaptiveScoredSlot[] = [];
  const alignedStart = Math.ceil(request.earliestStartMs / step) * step;
  for (let startMs = alignedStart; startMs + duration <= hardEnd; startMs += step) {
    const endMs = startMs + duration;
    if (!validateCandidateSlot(request, startMs, endMs, {allowOutsideAvailability: request.allowOutsideAvailability}).ok) continue;
    results.push(scoreSlot(request, startMs, endMs));
  }
  return results.sort((left, right) => right.totalScore - left.totalScore || left.startMs - right.startMs).slice(0, maximumResults);
}

function confidenceFor(observationCount: number, completionRate: number, thresholds: AdaptiveSchedulingPreferences["thresholds"]) {
  if (observationCount < thresholds.lowObservationCount) return {level: "insufficient" as const, score: 0};
  if (observationCount < thresholds.mediumObservationCount) return {level: "low" as const, score: 0.3};
  if (observationCount < thresholds.highObservationCount) return {level: "medium" as const, score: 0.6};
  return {level: "high" as const, score: Math.min(0.95, 0.75 + Math.abs(completionRate - 0.5) * 0.4)};
}

export function calculateSchedulingPatterns(
  observations: PatternBehaviorObservation[],
  thresholds: AdaptiveSchedulingPreferences["thresholds"] = DEFAULT_ADAPTIVE_PREFERENCES.thresholds,
  timeZone = DEFAULT_ADAPTIVE_PREFERENCES.timeZone,
) {
  const grouped = new Map<string, PatternBehaviorObservation[]>();
  observations.forEach((observation) => {
    const referenceMs = observation.actualStartMs ?? observation.updatedStartMs ?? observation.originalStartMs;
    if (referenceMs === null) return;
    const day = zonedParts(referenceMs, timeZone).dayOfWeek;
    const key = `${observation.category}:${day}`;
    grouped.set(key, [...(grouped.get(key) ?? []), observation]);
  });

  return [...grouped.entries()].map(([key, items]): AdaptiveSchedulingPattern => {
    const [category, dayText] = key.split(":") as [AdaptiveActivityCategory, string];
    const completed = items.filter((item) => ["task_completed", "completed_earlier_than_expected", "duration_exceeded"].includes(item.eventType)).length;
    const postponed = items.filter((item) => ["task_postponed", "task_rescheduled", "task_skipped", "reminder_ignored"].includes(item.eventType)).length;
    const accepted = items.filter((item) => item.eventType === "suggestion_accepted").length;
    const rejected = items.filter((item) => item.eventType === "suggestion_rejected").length;
    const starts = items.map((item) => item.actualStartMs ?? item.updatedStartMs ?? item.originalStartMs).filter((value): value is number => value !== null);
    const startHours = starts.map((value) => zonedParts(value, timeZone).hour);
    const preferredStartHour = startHours.length ? Math.round(startHours.reduce((sum, value) => sum + value, 0) / startHours.length) : 9;
    const durations = items.map((item) => item.actualDurationMinutes).filter((value): value is number => value !== null && value > 0);
    const delays = items.flatMap((item) => item.actualStartMs !== null && item.originalStartMs !== null ?
      [Math.max(0, (item.actualStartMs - item.originalStartMs) / MINUTE_MS)] : []);
    const outcomeCount = completed + postponed;
    const completionRate = outcomeCount ? completed / outcomeCount : 0;
    const confidence = confidenceFor(outcomeCount, completionRate, thresholds);
    const averageDurationMinutes = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 60;
    return {
      activityCategory: category,
      averageDurationMinutes,
      averageStartDelayMinutes: delays.length ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length) : 0,
      completionRate: Number(completionRate.toFixed(3)),
      confidenceLevel: confidence.level,
      confidenceScore: Number(confidence.score.toFixed(3)),
      dayOfWeek: Number(dayText),
      observationCount: outcomeCount,
      postponementRate: Number((outcomeCount ? postponed / outcomeCount : 0).toFixed(3)),
      preferredEndHour: Math.min(24, preferredStartHour + Math.max(1, Math.ceil(averageDurationMinutes / 60))),
      preferredStartHour,
      suggestionAcceptanceRate: Number((accepted + rejected ? accepted / (accepted + rejected) : 0).toFixed(3)),
    };
  });
}

export function nextBangkokDayStart(nowMs: number) {
  return zonedDayStart(nowMs, "Asia/Bangkok", 1);
}
