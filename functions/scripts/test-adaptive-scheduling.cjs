const assert = require('node:assert/strict');

const {
  DEFAULT_ADAPTIVE_PREFERENCES,
  calculateSchedulingPatterns,
  findAdaptiveTimeSlots,
  overlappingScheduleItems,
  validateCandidateSlot,
  validateMovableScheduleItem,
  zonedDayStart,
} = require('../lib/adaptive-scheduling/engine.js');
const {validateGeminiNaturalLanguageIntent} = require('../lib/adaptive-scheduling/validation.js');
const {applyDeterministicTemporalSemantics, fallbackAdaptiveNaturalLanguageIntent, nearestAvailableSlot, unresolvedTemporalMention} = require('../lib/adaptive-scheduling/functions.js');

const minute = 60_000;
const day = 24 * 60 * minute;
const ms = (value) => new Date(value).getTime();
const preferences = (patch = {}) => ({
  ...DEFAULT_ADAPTIVE_PREFERENCES,
  ...patch,
  preferredTimeByCategory: patch.preferredTimeByCategory ?? {},
  scoreWeights: {...DEFAULT_ADAPTIVE_PREFERENCES.scoreWeights, ...(patch.scoreWeights ?? {})},
  thresholds: {...DEFAULT_ADAPTIVE_PREFERENCES.thresholds, ...(patch.thresholds ?? {})},
  unavailablePeriods: patch.unavailablePeriods ?? [],
});
const request = (patch = {}) => ({
  category: 'study',
  deadlineMs: null,
  durationMinutes: 60,
  earliestStartMs: ms('2026-08-05T06:00:00+07:00'),
  latestEndMs: ms('2026-08-05T23:00:00+07:00'),
  patterns: [],
  preferences: preferences(),
  priority: 'medium',
  scheduleItems: [],
  slotStepMinutes: 30,
  ...patch,
});

assert.equal(DEFAULT_ADAPTIVE_PREFERENCES.allowAutomaticRescheduling, false, 'automatic scheduling must default to off');
assert.equal(validateMovableScheduleItem({allowAiReschedule: true, isFlexible: false, isLocked: false}).code, 'fixed');
assert.equal(validateMovableScheduleItem({allowAiReschedule: true, isFlexible: true, isLocked: true}).code, 'locked');
assert.equal(validateMovableScheduleItem({allowAiReschedule: true, googleEventId: 'external', isFlexible: true, isLocked: false}).code, 'external');

const newYorkDstStart = zonedDayStart(ms('2026-03-08T12:00:00-04:00'), 'America/New_York');
const newYorkNextDay = zonedDayStart(newYorkDstStart, 'America/New_York', 1);
assert.equal(new Date(newYorkDstStart).toISOString(), '2026-03-08T05:00:00.000Z', 'day boundaries must use the saved IANA time zone');
assert.equal(newYorkNextDay - newYorkDstStart, 23 * 60 * minute, 'day ranges must remain correct through daylight-saving changes');

const conflictStart = ms('2026-08-05T13:00:00+07:00');
const conflictRequest = request({scheduleItems: [{category: 'study', endMs: conflictStart + 60 * minute, id: 'fixed-class', isDifficult: true, isFixed: true, startMs: conflictStart}]});
assert.equal(validateCandidateSlot(conflictRequest, conflictStart, conflictStart + 60 * minute).code, 'conflict', 'fixed events must block overlapping slots');
assert.equal(overlappingScheduleItems(conflictStart, conflictStart + 60 * minute, conflictRequest.scheduleItems).length, 1, 'the warning UI must receive the exact overlapping item');
assert.equal(validateCandidateSlot(conflictRequest, conflictStart, conflictStart + 60 * minute, {allowConflicts: true}).ok, true, 'an explicitly confirmed concurrent activity must be saveable');
assert.equal(overlappingScheduleItems(conflictStart + 60 * minute, conflictStart + 120 * minute, conflictRequest.scheduleItems).length, 0, 'adjacent events are not overlapping events');

const deadlineRequest = request({deadlineMs: ms('2026-08-05T15:00:00+07:00')});
assert.equal(validateCandidateSlot(deadlineRequest, ms('2026-08-05T14:30:00+07:00'), ms('2026-08-05T15:30:00+07:00')).code, 'deadline');

const sleepRequest = request();
assert.equal(validateCandidateSlot(sleepRequest, ms('2026-08-05T23:10:00+07:00'), ms('2026-08-05T23:40:00+07:00')).code, 'outside_availability');

const explicitLateNightRequest = request({
  allowOutsideAvailability: true,
  earliestStartMs: ms('2026-08-06T00:00:00+07:00'),
  latestEndMs: ms('2026-08-06T05:00:00+07:00'),
  requiredLocalDate: '2026-08-06',
  requiredLocalTimeWindow: {endTime: '05:00', startTime: '00:00'},
});
const lateNightSlots = findAdaptiveTimeSlots(explicitLateNightRequest, 8);
assert.ok(lateNightSlots.length > 0, 'an explicit late-night request must be usable between midnight and 05:00');
assert.ok(lateNightSlots.every((slot) => {
  const hour = Number(new Intl.DateTimeFormat('en-US', {hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'}).format(new Date(slot.startMs))) % 24;
  return hour >= 0 && hour < 5;
}), 'late-night results must stay inside the requested 00:00-05:00 window');

const automaticLateNightRequest = request({
  earliestStartMs: ms('2026-08-06T00:00:00+07:00'),
  latestEndMs: ms('2026-08-06T05:00:00+07:00'),
});
assert.equal(findAdaptiveTimeSlots(automaticLateNightRequest, 8).length, 0, 'automatic scheduling must still protect the default sleep window');

const boundedRequest = request({earliestStartMs: ms('2026-08-05T10:00:00+07:00'), latestEndMs: ms('2026-08-05T18:00:00+07:00')});
assert.equal(validateCandidateSlot(boundedRequest, ms('2026-08-05T09:00:00+07:00'), ms('2026-08-05T10:00:00+07:00')).code, 'outside_availability', 'server validation must reject a slot before the verified search window');

const breakRequest = request({
  preferences: preferences({minimumBreakMinutes: 15, transitionMinutes: 5}),
  scheduleItems: [{category: 'study', endMs: ms('2026-08-05T13:00:00+07:00'), id: 'focus-before', isDifficult: true, isFixed: true, startMs: ms('2026-08-05T12:00:00+07:00')}],
});
assert.equal(validateCandidateSlot(breakRequest, ms('2026-08-05T13:05:00+07:00'), ms('2026-08-05T14:05:00+07:00')).code, 'conflict', 'minimum break must be enforced around adjacent schedule items');

const unavailableRequest = request({preferences: preferences({unavailablePeriods: [{days: [3], endTime: '16:00', startTime: '14:00'}]})});
assert.equal(validateCandidateSlot(unavailableRequest, ms('2026-08-05T14:30:00+07:00'), ms('2026-08-05T15:30:00+07:00')).code, 'outside_availability');
assert.equal(validateCandidateSlot(unavailableRequest, ms('2026-08-05T14:30:00+07:00'), ms('2026-08-05T15:30:00+07:00'), {userSelectedTime: true}).ok, true, 'a time explicitly selected by the user must override soft availability preferences');

const overloadRequest = request({durationMinutes: 90, preferences: preferences({maximumDailyWorkMinutes: 120}), scheduleItems: [{category: 'assignment', endMs: ms('2026-08-05T10:00:00+07:00'), id: 'work', isDifficult: true, isFixed: true, startMs: ms('2026-08-05T09:00:00+07:00')}]});
assert.equal(validateCandidateSlot(overloadRequest, ms('2026-08-05T15:00:00+07:00'), ms('2026-08-05T16:30:00+07:00')).code, 'overload');
assert.equal(validateCandidateSlot(overloadRequest, ms('2026-08-05T15:00:00+07:00'), ms('2026-08-05T16:30:00+07:00'), {userSelectedTime: true}).ok, true, 'a user-selected time must override the AI workload recommendation');

const tentativeSuggestionRequest = request({scheduleItems: [{category: 'reading', endMs: conflictStart + 60 * minute, id: 'suggestion-pending', isDifficult: false, isFixed: true, startMs: conflictStart}]});
assert.equal(validateCandidateSlot(tentativeSuggestionRequest, conflictStart, conflictStart + 60 * minute, {userSelectedTime: true}).ok, true, 'a pending AI suggestion must not block an explicit user choice');
assert.equal(validateCandidateSlot(conflictRequest, conflictStart, conflictStart + 60 * minute, {userSelectedTime: true}).code, 'conflict', 'an explicit user choice must still reject a real calendar conflict');

const explicitPreferenceRequest = request({
  patterns: [{activityCategory: 'study', averageDurationMinutes: 60, averageStartDelayMinutes: 0, completionRate: 1, confidenceLevel: 'high', confidenceScore: .95, dayOfWeek: 3, observationCount: 20, postponementRate: 0, preferredEndHour: 10, preferredStartHour: 8, suggestionAcceptanceRate: .8}],
  preferences: preferences({preferredTimeByCategory: {study: {endTime: '17:00', startTime: '13:00'}}}),
});
const preferredSlots = findAdaptiveTimeSlots(explicitPreferenceRequest, 3);
assert.ok(preferredSlots.length > 0);
assert.ok(preferredSlots.every((slot) => new Date(slot.startMs).toLocaleString('en-US', {hour: 'numeric', hour12: false, timeZone: 'Asia/Bangkok'}).match(/13|14|15|16/)), 'explicit preference must outrank learned morning pattern');

const requiredEveningRequest = request({
  patterns: [{activityCategory: 'gaming', averageDurationMinutes: 60, averageStartDelayMinutes: 0, completionRate: 1, confidenceLevel: 'high', confidenceScore: .99, dayOfWeek: 3, observationCount: 30, postponementRate: 0, preferredEndHour: 8, preferredStartHour: 6, suggestionAcceptanceRate: 1}],
  category: 'gaming',
  requiredLocalTimeWindow: {endTime: '21:00', startTime: '17:00'},
});
const requiredEveningSlots = findAdaptiveTimeSlots(requiredEveningRequest, 8);
assert.ok(requiredEveningSlots.length > 0, 'an evening gaming request must produce an evening option when one is free');
assert.ok(requiredEveningSlots.every((slot) => {
  const hour = Number(new Intl.DateTimeFormat('en-US', {hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'}).format(new Date(slot.startMs)));
  return hour >= 17 && hour < 21;
}), 'an explicit evening request must never be moved to the morning by learned behavior');

const observations = [
  ...Array.from({length: 6}, (_, index) => ({actualDurationMinutes: 55, actualStartMs: ms('2026-08-03T14:00:00+07:00') + index * 7 * day, category: 'study', eventType: 'task_completed', originalStartMs: null, updatedStartMs: null})),
  ...Array.from({length: 3}, (_, index) => ({actualDurationMinutes: 40, actualStartMs: ms('2026-08-04T19:00:00+07:00') + index * 7 * day, category: 'exercise', eventType: 'task_completed', originalStartMs: null, updatedStartMs: null})),
];
const patterns = calculateSchedulingPatterns(observations, DEFAULT_ADAPTIVE_PREFERENCES.thresholds, 'Asia/Bangkok');
assert.equal(patterns.find((item) => item.activityCategory === 'study').preferredStartHour, 14, 'patterns must use the configured time zone');
assert.equal(patterns.find((item) => item.activityCategory === 'study').confidenceLevel, 'medium');
assert.equal(patterns.find((item) => item.activityCategory === 'exercise').confidenceLevel, 'low');

const naturalIntent = (patch = {}) => ({
  activityCategory: null,
  deadline: null,
  durationMinutes: null,
  earliestLocalStartExclusive: false,
  earliestLocalStartTime: null,
  intent: 'unknown',
  latestLocalStartTime: null,
  preferredPeriod: null,
  preferenceMode: null,
  requestedLocalDate: null,
  requiresConfirmation: true,
  taskTitle: null,
  ...patch,
});

assert.equal(validateGeminiNaturalLanguageIntent({intent: 'find_time'}), null, 'partial Gemini output must be rejected');
assert.equal(validateGeminiNaturalLanguageIntent(naturalIntent({activityCategory: 'study', durationMinutes: 60, intent: 'find_time', preferredPeriod: 'afternoon', requiresConfirmation: false, taskTitle: 'อ่านหนังสือ'})), null, 'Gemini cannot bypass confirmation');
assert.equal(validateGeminiNaturalLanguageIntent(naturalIntent({activityCategory: 'invented', durationMinutes: 60, intent: 'find_time', taskTitle: 'อ่านหนังสือ'})), null, 'unknown categories must be rejected');
assert.deepEqual(validateGeminiNaturalLanguageIntent(naturalIntent({activityCategory: 'reading', intent: 'create_activity', taskTitle: ' อ่านหนังสือทบทวนบทเรียน '})), naturalIntent({activityCategory: 'reading', intent: 'create_activity', taskTitle: 'อ่านหนังสือทบทวนบทเรียน'}), 'a standalone activity may be proposed without command keywords or invented time data');
assert.deepEqual(validateGeminiNaturalLanguageIntent(naturalIntent({activityCategory: 'study', deadline: '2026-08-07T23:59:00+07:00', durationMinutes: 90, earliestLocalStartTime: '18:00', intent: 'find_time', preferredPeriod: 'evening', requestedLocalDate: '2026-08-07', taskTitle: ' อ่านหนังสือ '})), naturalIntent({activityCategory: 'study', deadline: '2026-08-07T23:59:00+07:00', durationMinutes: 90, earliestLocalStartTime: '18:00', intent: 'find_time', preferredPeriod: 'evening', requestedLocalDate: '2026-08-07', taskTitle: 'อ่านหนังสือ'}));

const keywordFreeActivity = fallbackAdaptiveNaturalLanguageIntent('อ่านหนังสือทบทวนบทเรียน');
assert.equal(keywordFreeActivity.intent, 'create_activity', 'standalone activities must not require an add or schedule keyword');
assert.equal(keywordFreeActivity.taskTitle, 'อ่านหนังสือทบทวนบทเรียน');
assert.equal(keywordFreeActivity.durationMinutes, null, 'missing duration must remain absent until the app applies a visible default');
assert.equal(fallbackAdaptiveNaturalLanguageIntent('มีงานค้างอะไรบ้าง').intent, 'unknown', 'task lookups must not become create operations');
assert.equal(fallbackAdaptiveNaturalLanguageIntent('ควรอ่านวิชาไหนก่อน').intent, 'unknown', 'advice questions must stay read-only');
assert.equal(fallbackAdaptiveNaturalLanguageIntent('หาเวลาอ่านหนังสือ 90 นาที').intent, 'find_time');
assert.equal(fallbackAdaptiveNaturalLanguageIntent('ช่วยจัดทั้งสัปดาห์').intent, 'rebalance_week', 'weekly auto-scheduling must understand natural Thai without a rebalance keyword');
assert.equal(fallbackAdaptiveNaturalLanguageIntent('ช่วยปรับตารางวันนี้ให้สมดุล').intent, 'rebalance_day', 'the daily Adaptive mode must work without technical keywords');
const eveningGaming = fallbackAdaptiveNaturalLanguageIntent('เล่นเกมช่วงเย็น 60 นาที');
assert.equal(eveningGaming.activityCategory, 'gaming', 'gaming must use its own Adaptive mode instead of other');
assert.equal(eveningGaming.preferredPeriod, 'evening', 'evening must remain a hard scheduling request');
const afterSixBedtime = fallbackAdaptiveNaturalLanguageIntent('นอนหลัง 6 โมงเย็น 60 นาที');
assert.equal(afterSixBedtime.earliestLocalStartTime, '18:00', 'an explicit time after 6 PM must not collapse to the 17:00 evening boundary');
assert.equal(afterSixBedtime.earliestLocalStartExclusive, true, 'หลัง/after must exclude the stated clock itself');
assert.equal(afterSixBedtime.latestLocalStartTime, null);
assert.equal(afterSixBedtime.taskTitle, 'นอน', 'timing words must not leak into the activity title');
assert.equal(fallbackAdaptiveNaturalLanguageIntent('นอนหลังหกโมงเย็น').earliestLocalStartTime, '18:00', 'spoken Thai clock words must be understood without spaces');
const exactSixBedtime = fallbackAdaptiveNaturalLanguageIntent('นอนตอน 6 โมงเย็น ๖๐ นาที');
assert.equal(exactSixBedtime.earliestLocalStartTime, '18:00');
assert.equal(exactSixBedtime.latestLocalStartTime, '18:00', 'an exact clock must constrain both sides of the start-time window');
assert.equal(exactSixBedtime.earliestLocalStartExclusive, false);
assert.equal(exactSixBedtime.durationMinutes, 60, 'Thai digits must be accepted for durations');
assert.equal(fallbackAdaptiveNaturalLanguageIntent('การนอน').intent, 'unknown', 'a broad topic must fall through to the flexible general assistant');
assert.equal(fallbackAdaptiveNaturalLanguageIntent('อ่านหนังสือตั้งแต่ 1 ทุ่ม').earliestLocalStartExclusive, false, 'ตั้งแต่/from must include the stated clock');
const fridayNoon = fallbackAdaptiveNaturalLanguageIntent('วันศุกร์อยากทำงาน 1 ชั่วโมงครึ่ง ช่วงเที่ยง', {localDate: '2026-08-05'});
assert.equal(fridayNoon.requestedLocalDate, '2026-08-07', 'a Thai weekday must resolve from verified local date');
assert.equal(fridayNoon.preferredPeriod, 'noon');
assert.equal(fridayNoon.earliestLocalStartTime, '12:00', 'noon must default to 12:00 PM');
assert.equal(fridayNoon.latestLocalStartTime, '12:00', 'plain noon must be an exact 12:00 PM request');
assert.equal(fridayNoon.durationMinutes, 90);
assert.equal(fridayNoon.taskTitle, 'ทำงาน');
const midnightIntent = fallbackAdaptiveNaturalLanguageIntent('วันศุกร์ทำงานตอนเที่ยงคืน 60 นาที', {localDate: '2026-08-05'});
assert.equal(midnightIntent.requestedLocalDate, '2026-08-07');
assert.equal(midnightIntent.preferredPeriod, 'night');
assert.equal(midnightIntent.earliestLocalStartTime, '00:00', 'Thai midnight must mean 00:00');
assert.equal(midnightIntent.latestLocalStartTime, '00:00', 'plain midnight must be exact rather than a broad night period');
const correctedGeminiFridayNoon = applyDeterministicTemporalSemantics(
  naturalIntent({intent: 'create_activity', preferredPeriod: 'morning', requestedLocalDate: '2026-08-06', taskTitle: 'ทำงาน'}),
  'Friday work at noon',
  {localDate: '2026-08-05'},
);
assert.equal(correctedGeminiFridayNoon.requestedLocalDate, '2026-08-07', 'server semantics must correct a wrong weekday date returned by Gemini');
assert.equal(correctedGeminiFridayNoon.earliestLocalStartTime, '12:00');
assert.equal(correctedGeminiFridayNoon.latestLocalStartTime, '12:00');
assert.equal(correctedGeminiFridayNoon.preferredPeriod, 'noon');

const afterSixRequest = request({
  category: 'gaming',
  patterns: requiredEveningRequest.patterns,
  requiredLocalTimeWindow: {endTime: '21:00', startTime: '18:00'},
});
const afterSixSlots = findAdaptiveTimeSlots(afterSixRequest, 5);
assert.ok(afterSixSlots.length > 0);
assert.ok(afterSixSlots.every((slot) => Number(new Intl.DateTimeFormat('en-GB', {hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'}).format(new Date(slot.startMs))) >= 18), 'explicit 18:00 lower bound must beat learned morning behavior');

const strictAfterSevenRequest = request({
  earliestStartMs: ms('2026-08-05T06:00:00+07:00'),
  latestEndMs: ms('2026-08-06T00:00:00+07:00'),
  requiredLocalTimeWindow: {endTime: '23:00', startTime: '19:01'},
});
const strictAfterSevenSlots = findAdaptiveTimeSlots(strictAfterSevenRequest, 8);
assert.ok(strictAfterSevenSlots.length > 0);
assert.ok(strictAfterSevenSlots.every((slot) => slot.startMs > ms('2026-08-05T19:00:00+07:00')), 'after 19:00 must never return exactly 19:00');

const fridayNoonRequest = request({
  durationMinutes: 90,
  earliestStartMs: ms('2026-08-05T06:00:00+07:00'),
  latestEndMs: ms('2026-08-10T23:00:00+07:00'),
  requiredLocalDate: '2026-08-07',
  requiredLocalTimeWindow: {endTime: '13:30', startTime: '12:00'},
});
const fridayNoonSlots = findAdaptiveTimeSlots(fridayNoonRequest, 8);
assert.ok(fridayNoonSlots.length > 0);
assert.ok(fridayNoonSlots.every((slot) => new Intl.DateTimeFormat('en-CA', {day: '2-digit', month: '2-digit', timeZone: 'Asia/Bangkok', year: 'numeric'}).format(new Date(slot.startMs)) === '2026-08-07'), 'Friday requests must remain on Friday');
assert.ok(fridayNoonSlots.every((slot) => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'}).format(new Date(slot.startMs)));
  return hour === 12;
}), 'noon requests must default to 12:00 PM and never fall back to 06:00');

// --- The proposal document's own example, run through both halves of the loop.
//
// "If the user often postpones their morning reading, the system shifts
// tomorrow's schedule to the afternoon." Until the behaviour hooks existed this
// could never happen, because nothing wrote the postponements that
// calculateSchedulingPatterns turns into a preferred hour. These assertions
// pin the whole chain: observations in -> pattern -> a different slot out.
const bangkokHour = (value) => Number(new Intl.DateTimeFormat('en-GB', {hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'}).format(new Date(value)));
// Same weekday as the day being scheduled, which is how patterns are keyed.
const sameWeekdayBefore = (weeks) => ms('2026-08-05T00:00:00+07:00') - weeks * 7 * day;
const readingObservation = (weeksAgo, eventType, startHour, movedToHour) => ({
  actualDurationMinutes: 60,
  actualStartMs: null,
  category: 'reading',
  eventType,
  originalStartMs: sameWeekdayBefore(weeksAgo) + startHour * 60 * minute,
  updatedStartMs: sameWeekdayBefore(weeksAgo) + (movedToHour ?? startHour) * 60 * minute,
});

const readingRequest = request({
  category: 'reading',
  earliestStartMs: ms('2026-08-05T06:00:00+07:00'),
  latestEndMs: ms('2026-08-05T22:00:00+07:00'),
});

// Before: no behaviour has ever been recorded, which is the state every real
// user was permanently stuck in. Nothing distinguishes one free hour from
// another, so the engine just takes the earliest one.
const coldSlots = findAdaptiveTimeSlots({...readingRequest, patterns: []}, 8);
assert.ok(coldSlots.length > 0, 'the cold-start request must still find slots');
assert.ok(bangkokHour(coldSlots[0].startMs) < 12, 'with no learned pattern the engine should still pick the earliest free hour');

// After: three mornings pushed to the afternoon, plus two afternoons actually
// finished. Five outcome events clears lowObservationCount, so the pattern
// carries real confidence rather than being discarded as insufficient.
const readingPatterns = calculateSchedulingPatterns([
  readingObservation(4, 'task_postponed', 8, 14),
  readingObservation(3, 'task_postponed', 8, 14),
  readingObservation(2, 'task_postponed', 8, 15),
  readingObservation(2, 'task_completed', 14),
  readingObservation(1, 'task_completed', 15),
], DEFAULT_ADAPTIVE_PREFERENCES.thresholds, 'Asia/Bangkok');
const readingPattern = readingPatterns.find((item) => item.activityCategory === 'reading');
assert.ok(readingPattern, 'postponed reading must produce a reading pattern');
assert.equal(readingPattern.observationCount, 5, 'every completion and postponement is an outcome');
assert.equal(readingPattern.completionRate, 0.4, 'two of five reading outcomes were completions');
assert.equal(readingPattern.postponementRate, 0.6, 'three of five reading outcomes were postponements');
assert.notEqual(readingPattern.confidenceLevel, 'insufficient', 'five outcomes must clear the low-confidence threshold');
assert.ok(readingPattern.preferredStartHour >= 13, 'the learned hour must follow where the reading actually happened');

const learnedSlots = findAdaptiveTimeSlots({...readingRequest, patterns: readingPatterns}, 8);
assert.ok(learnedSlots.length > 0, 'the learned request must still find slots');
assert.ok(bangkokHour(learnedSlots[0].startMs) >= 13, 'after repeated morning postponements the top slot must move into the afternoon');
assert.notEqual(learnedSlots[0].startMs, coldSlots[0].startMs, 'the learned suggestion must differ from the cold-start one');

// The two events nobody presses a button for have to count as postponements as
// well, otherwise the sweep would write rows the rates ignore.
const sweptPattern = calculateSchedulingPatterns([
  readingObservation(3, 'task_skipped', 8),
  readingObservation(2, 'reminder_ignored', 8),
  readingObservation(1, 'task_completed', 8),
], DEFAULT_ADAPTIVE_PREFERENCES.thresholds, 'Asia/Bangkok').find((item) => item.activityCategory === 'reading');
assert.equal(sweptPattern.observationCount, 3, 'skips and ignored reminders are outcomes, not noise');
assert.equal(sweptPattern.postponementRate, Number((2 / 3).toFixed(3)), 'task_skipped and reminder_ignored must raise the postponement rate');

// Relative day words used to be dropped entirely: only weekday names produced a
// requestedLocalDate, so "อ่านหนังสือวันนี้" left the engine free to range over
// the whole 14-day window and answer with a slot days away.
const relativeDay = (message, localDate = '2026-08-25') =>
  applyDeterministicTemporalSemantics(fallbackAdaptiveNaturalLanguageIntent(message, {localDate}), message, {localDate});

assert.equal(relativeDay('อ่านหนังสือวันนี้').requestedLocalDate, '2026-08-25', '"วันนี้" must resolve to the local date the server verified');
assert.equal(relativeDay('อ่านหนังสือบ่ายนี้').requestedLocalDate, '2026-08-25', '"บ่ายนี้" names an afternoon of today, not of some later day');
assert.equal(relativeDay('อ่านหนังสือบ่ายนี้').preferredPeriod, 'afternoon', 'the day part must still narrow the window');
assert.equal(relativeDay('อ่านหนังสือเย็นนี้').requestedLocalDate, '2026-08-25');
assert.equal(relativeDay('อ่านหนังสือพรุ่งนี้').requestedLocalDate, '2026-08-26');
assert.equal(relativeDay('อ่านหนังสือมะรืนนี้').requestedLocalDate, '2026-08-27', 'มะรืนนี้ ends in นี้ but is two days out, not today');
assert.equal(relativeDay('read a book today').requestedLocalDate, '2026-08-25');
assert.equal(relativeDay('read a book tomorrow').requestedLocalDate, '2026-08-26');
assert.equal(relativeDay('read a book this afternoon').requestedLocalDate, '2026-08-25');
// "afternoon" contains "noon", which used to match the named-noon rule and pin
// the request to 12:00 sharp instead of the afternoon window.
assert.equal(relativeDay('read a book this afternoon').preferredPeriod, 'afternoon', 'the noon rule must not fire inside the word afternoon');
assert.equal(relativeDay('read a book this afternoon').earliestLocalStartTime, null, 'a broad afternoon must not be reduced to an exact clock');
assert.equal(relativeDay('work at noon on Friday').preferredPeriod, 'noon', 'a real noon request must still be exact');
assert.equal(relativeDay('work at noon on Friday').earliestLocalStartTime, '12:00');
assert.equal(relativeDay('อ่านหนังสือวันศุกร์').requestedLocalDate, '2026-08-28', 'a named weekday still wins over relative wording');

// Resolving only the date of a "this <part of day>" phrase left "คืนนี้"
// scheduled at six in the morning: the right day, but nothing claimed the
// evening and the model does not fill the period reliably either.
assert.equal(relativeDay('อ่านหนังสือคืนนี้').preferredPeriod, 'night', '"คืนนี้" means tonight, not any hour of today');
assert.equal(relativeDay('อ่านหนังสือค่ำนี้').preferredPeriod, 'night');
assert.equal(relativeDay('อ่านหนังสือเย็นนี้').preferredPeriod, 'evening');
assert.equal(relativeDay('อ่านหนังสือเช้านี้').preferredPeriod, 'morning');
assert.equal(relativeDay('อ่านหนังสือสายนี้').preferredPeriod, 'late_morning');
assert.equal(relativeDay('อ่านหนังสือวันนี้').preferredPeriod, null, 'a bare day word names no hour');
assert.equal(relativeDay('อ่านหนังสือพรุ่งนี้').preferredPeriod, null);

// The server must supply the period itself rather than depending on whatever
// the model happened to return, which is what production actually exposed.
const modelLeftPeriodEmpty = (message) => applyDeterministicTemporalSemantics(
  naturalIntent({intent: 'create_activity', preferredPeriod: null, taskTitle: 'อ่านหนังสือ'}),
  message,
  {localDate: '2026-08-25'},
);
assert.equal(modelLeftPeriodEmpty('อ่านหนังสือคืนนี้').preferredPeriod, 'night');
assert.equal(modelLeftPeriodEmpty('อ่านหนังสือคืนนี้').requestedLocalDate, '2026-08-25');
assert.equal(modelLeftPeriodEmpty('read a book tonight').preferredPeriod, 'night');

// An explicit clock the user gave outranks the broad part of day.
const clockWithDayPart = applyDeterministicTemporalSemantics(
  naturalIntent({earliestLocalStartTime: '21:00', intent: 'create_activity', latestLocalStartTime: '21:00', preferredPeriod: null, taskTitle: 'อ่านหนังสือ'}),
  'อ่านหนังสือคืนนี้ตอน 3 ทุ่ม',
  {localDate: '2026-08-25'},
);
assert.equal(clockWithDayPart.earliestLocalStartTime, '21:00', 'a stated clock must survive the day-part rule');
assert.equal(clockWithDayPart.latestLocalStartTime, '21:00');
assert.equal(relativeDay('อ่านหนังสือเที่ยงคืนนี้').earliestLocalStartTime, '00:00', 'midnight stays exact rather than becoming a broad night');
assert.equal(relativeDay('อ่านหนังสือ').requestedLocalDate, null, 'a request with no day word must stay unconstrained');
assert.equal(relativeDay('อ่านหนังสือวันนี้').taskTitle, 'อ่านหนังสือ', 'the day word must not survive into the saved activity title');
assert.equal(relativeDay('อ่านหนังสือบ่ายนี้').taskTitle, 'อ่านหนังสือ');
assert.equal(relativeDay('ทำงานตอนบ่ายนี้').taskTitle, 'ทำงาน', 'the connector in front of the day part must go with it');
assert.equal(relativeDay('อ่านหนังสือช่วงเย็นนี้').taskTitle, 'อ่านหนังสือ');
assert.equal(relativeDay('ออกกำลังกายพรุ่งนี้เช้า').taskTitle, 'ออกกำลังกาย', 'a day part trailing the day word must go too');
assert.equal(relativeDay('read a book this afternoon').taskTitle, 'read a book');

// The point of the date: two phrasings of "today" must not collapse onto one
// slot on an unrelated day.
const todayRequest = (intent) => request({
  category: 'reading',
  durationMinutes: 60,
  earliestStartMs: ms('2026-08-25T02:00:00Z'), // 09:00 Bangkok
  latestEndMs: ms('2026-08-25T02:00:00Z') + 14 * day,
  patterns: [],
  requiredLocalDate: intent.requestedLocalDate ?? undefined,
  requiredLocalTimeWindow: intent.preferredPeriod === 'afternoon' ? {endTime: '17:00', startTime: '13:00'} : undefined,
  scheduleItems: [],
});
const todayTop = findAdaptiveTimeSlots(todayRequest(relativeDay('อ่านหนังสือวันนี้')), 1)[0];
const afternoonTop = findAdaptiveTimeSlots(todayRequest(relativeDay('อ่านหนังสือบ่ายนี้')), 1)[0];
assert.ok(todayTop && afternoonTop, 'both phrasings must still find a slot on a free day');
const bangkokDate = (value) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Bangkok'}).format(new Date(value));
assert.equal(bangkokDate(todayTop.startMs), '2026-08-25', '"วันนี้" must be scheduled today');
assert.equal(bangkokDate(afternoonTop.startMs), '2026-08-25', '"บ่ายนี้" must be scheduled today');
assert.ok(bangkokHour(afternoonTop.startMs) >= 13, '"บ่ายนี้" must land in the afternoon window');
assert.notEqual(todayTop.startMs, afternoonTop.startMs, 'two different phrasings must not collapse onto one identical slot');

// Asking for an exact hour that a class already occupies used to be a dead end
// telling the user to go and pick another time themselves. It now falls back
// through the same search, offering the nearest slot it can actually take.
const classStart = ms('2026-08-05T15:00:00+07:00');
const busyAfternoon = [{category: 'study', endMs: ms('2026-08-05T17:00:00+07:00'), id: 'IST201506', isDifficult: true, isFixed: true, startMs: classStart}];
const exactThreeRequest = request({
  category: 'reading',
  requiredLocalDate: '2026-08-05',
  requiredLocalTimeWindow: {endTime: '16:00', startTime: '15:00'},
  scheduleItems: busyAfternoon,
});
const noIntent = {preferredPeriod: null};

assert.equal(findAdaptiveTimeSlots(exactThreeRequest, 1).length, 0, 'the hour the class occupies must stay unavailable');
const offered = nearestAvailableSlot(exactThreeRequest, noIntent);
assert.ok(offered.slot, 'a taken hour must come back with an alternative, not nothing');
assert.ok(offered.unavailableRequest.includes('15:00'), 'the card has to say which time was unavailable');
assert.equal(bangkokDate(offered.slot.startMs), '2026-08-05', 'the alternative should stay on the day that was asked for');
assert.ok(bangkokHour(offered.slot.startMs) >= 13 && bangkokHour(offered.slot.startMs) < 15,
  'the first relaxation is the surrounding part of day, so 3pm falls back inside the afternoon');
assert.ok(offered.slot.startMs + 60 * minute <= classStart, 'the alternative must not overlap the class');

const saturdayBirthday = request({
  category: 'other',
  earliestStartMs: ms('2026-08-08T06:00:00+07:00'),
  latestEndMs: ms('2026-08-09T23:00:00+07:00'),
  preferences: preferences({availableDays: [1, 2, 3, 4, 5]}),
  requiredLocalDate: '2026-08-08',
  scheduleItems: [{category: 'study', endMs: ms('2026-08-08T12:00:00+07:00'), id: 'morning-class', isDifficult: true, isFixed: true, startMs: ms('2026-08-08T09:00:00+07:00')}],
});
const birthdaySlot = nearestAvailableSlot(saturdayBirthday, noIntent);
assert.ok(birthdaySlot.slot, 'a birthday on a normally unavailable weekday must still find a free hour on its explicit date');
assert.equal(bangkokDate(birthdaySlot.slot.startMs), '2026-08-08', 'a birthday must stay on the date the user supplied');
assert.ok(birthdaySlot.slot.endMs <= ms('2026-08-09T00:00:00+07:00'), 'the birthday activity must not spill into another date');

const farFutureMilestone = nearestAvailableSlot(request({
  category: 'other',
  earliestStartMs: ms('2031-10-10T00:00:00+07:00'),
  latestEndMs: ms('2031-10-11T00:00:00+07:00'),
  requiredLocalDate: '2031-10-10',
}), noIntent);
assert.ok(farFutureMilestone.slot, 'an explicitly dated milestone years away must still be schedulable');
assert.equal(bangkokDate(farFutureMilestone.slot.startMs), '2031-10-10');

const fullyBookedBirthday = nearestAvailableSlot(request({
  category: 'other',
  earliestStartMs: ms('2026-08-08T06:00:00+07:00'),
  latestEndMs: ms('2026-08-10T23:00:00+07:00'),
  requiredLocalDate: '2026-08-08',
  scheduleItems: [{category: 'other', endMs: ms('2026-08-08T23:00:00+07:00'), id: 'booked-day', isDifficult: false, isFixed: true, startMs: ms('2026-08-08T06:00:00+07:00')}],
}), noIntent);
assert.equal(fullyBookedBirthday.slot, undefined, 'a fully booked birthday date must ask for another choice instead of moving the event to another day');

// A request that simply succeeds must not be labelled as a fallback.
const freeRequest = request({category: 'reading', requiredLocalDate: '2026-08-05', requiredLocalTimeWindow: {endTime: '14:00', startTime: '13:00'}});
const direct = nearestAvailableSlot(freeRequest, noIntent);
assert.ok(direct.slot, 'a free requested hour must still be offered directly');
assert.equal(direct.unavailableRequest, '', 'no clash means no "was unavailable" notice');
assert.equal(bangkokHour(direct.slot.startMs), 13);

// The fallback must keep obeying what 3a learned rather than grabbing the first
// free half hour. With the whole afternoon blocked the search widens to the
// rest of the day, and there a learned evening has to beat the earliest slot.
const blockedAfternoon = [{category: 'study', endMs: ms('2026-08-05T17:00:00+07:00'), id: 'IST201506', isDifficult: false, isFixed: true, startMs: ms('2026-08-05T13:00:00+07:00')}];
const wholeAfternoonGone = {
  category: 'reading',
  requiredLocalDate: '2026-08-05',
  requiredLocalTimeWindow: {endTime: '16:00', startTime: '15:00'},
  scheduleItems: blockedAfternoon,
};
const coldWideFallback = nearestAvailableSlot(request(wholeAfternoonGone), noIntent);
assert.ok(coldWideFallback.slot, 'a blocked afternoon must widen to the rest of the day');
assert.equal(bangkokHour(coldWideFallback.slot.startMs), 6, 'with nothing learned the widened search takes the earliest free hour');

const learnedEvening = [{
  activityCategory: 'reading', averageDurationMinutes: 60, averageStartDelayMinutes: 0,
  completionRate: 1, confidenceLevel: 'medium', confidenceScore: 0.6, dayOfWeek: 3,
  observationCount: 8, postponementRate: 0, preferredEndHour: 21, preferredStartHour: 19,
  suggestionAcceptanceRate: 1,
}];
const learnedFallback = nearestAvailableSlot(request({...wholeAfternoonGone, patterns: learnedEvening}), noIntent);
assert.ok(learnedFallback.slot, 'the learned fallback must still find something');
assert.equal(bangkokHour(learnedFallback.slot.startMs), 19, 'the alternative must follow the learned window, not just the next free slot');
assert.notEqual(learnedFallback.slot.startMs, coldWideFallback.slot.startMs, 'learned behaviour has to change which alternative is offered');
assert.ok(learnedFallback.unavailableRequest.includes('15:00'), 'the learned fallback is still labelled as a fallback');

// Found while testing on production: after a class the fallback skips the first
// free half hours. That is the burnout penalty doing its job -- a slot starting
// within 90 minutes of a difficult item loses 18 points -- so the alternative
// leaves a recovery gap instead of butting straight up against the class.
const afternoonClass = [{category: 'study', endMs: ms('2026-08-05T17:00:00+07:00'), id: 'IST201506', isDifficult: true, isFixed: true, startMs: ms('2026-08-05T15:00:00+07:00')}];
const eveningRequest = request({
  category: 'reading',
  earliestStartMs: ms('2026-08-05T14:15:00+07:00'),
  requiredLocalDate: '2026-08-05',
  requiredLocalTimeWindow: {endTime: '16:00', startTime: '15:00'},
  scheduleItems: afternoonClass,
});
const afterClass = nearestAvailableSlot(eveningRequest, {preferredPeriod: null});
assert.ok(afterClass.slot, 'a clash late in the afternoon must still yield an alternative');
assert.equal(afterClass.slot.startMs, ms('2026-08-05T18:30:00+07:00'), 'the alternative must clear the 90-minute burnout window after the class');
assert.equal(afterClass.slot.breakdown.burnoutPenalty, 0, 'the offered alternative must not be carrying a burnout penalty');

// The nearer slots are perfectly valid -- they are merely outscored. Asking for
// 17:30 outright carries its own window, and that request is still honoured
// rather than being quietly pushed out to the higher-scoring 18:30.
const sooner = ms('2026-08-05T17:30:00+07:00');
const askedForSooner = request({
  category: 'reading',
  earliestStartMs: ms('2026-08-05T14:15:00+07:00'),
  requiredLocalDate: '2026-08-05',
  requiredLocalTimeWindow: {endTime: '18:30', startTime: '17:30'},
  scheduleItems: afternoonClass,
});
assert.equal(validateCandidateSlot(askedForSooner, sooner, sooner + 60 * minute).ok, true,
  'a slot inside the burnout window is still valid, only lower scoring');
const explicitSooner = nearestAvailableSlot(askedForSooner, {preferredPeriod: null});
assert.equal(explicitSooner.slot.startMs, sooner, 'an explicitly requested time must be offered as asked');
assert.equal(explicitSooner.unavailableRequest, '', 'honouring the exact request is not a fallback');

// Explicit calendar dates. Before this, "ซื้อมังงะวันที่ 1 กันยาให้หน่อย" left
// requestedLocalDate null, the whole fortnight was searched, every cold-start
// slot tied, and the earliest one won: the answer was tomorrow at 07:30 with
// the user's entire sentence as the activity title.
const onDate = (message, localDate = '2026-08-26') =>
  applyDeterministicTemporalSemantics(fallbackAdaptiveNaturalLanguageIntent(message, {localDate}), message, {localDate});

const mangaRepro = onDate('ซื้อมังงะวันที่ 1 กันยาให้หน่อย');
assert.equal(mangaRepro.requestedLocalDate, '2026-09-01', 'an explicit "วันที่ 1 กันยา" must resolve to that calendar day');
assert.equal(mangaRepro.taskTitle, 'ซื้อมังงะ', 'the title must be the activity, not the sentence it arrived in');
assert.equal(mangaRepro.intent, 'create_activity');

assert.equal(onDate('ซื้อมังงะ 1 ก.ย.').requestedLocalDate, '2026-09-01', 'the dotted abbreviation must read the same as the full month');
assert.equal(onDate('ซื้อมังงะ 1 กันยายน').requestedLocalDate, '2026-09-01');
const birthdayRepro = onDate('เพิ่มนัดหมาย วันที่10ตุลาไปวันเกิดเพื่อน', '2026-09-03');
assert.equal(birthdayRepro.requestedLocalDate, '2026-10-10', 'a compact Thai birthday date must stay on the requested calendar day');
assert.equal(birthdayRepro.intent, 'create_activity');
assert.equal(onDate('ซื้อมังงะ 1/9').requestedLocalDate, '2026-09-01', 'Thai day/month order must not be read as month/day');
assert.equal(onDate('ซื้อมังงะ 1/9/2569').requestedLocalDate, '2026-09-01', 'a Buddhist year must be converted, not treated as the far future');
assert.equal(onDate('ซื้อมังงะ 1 ก.ย. ปี 69').requestedLocalDate, '2026-09-01', 'a two-digit Buddhist year behind a ปี marker must resolve');
assert.equal(onDate('ซื้อมังงะ 2026-09-01').requestedLocalDate, '2026-09-01');
assert.equal(onDate('buy manga on Sep 1').requestedLocalDate, '2026-09-01');
assert.equal(onDate('buy manga on 1 September').requestedLocalDate, '2026-09-01');
assert.equal(onDate('ซื้อมังงะวันที่ 1').requestedLocalDate, '2026-09-01', 'a bare day number means the next time that date comes round');
assert.equal(onDate('ซื้อมังงะวันที่ 30').requestedLocalDate, '2026-08-30', 'a day still ahead this month stays in this month');

// A year that has already gone by is only accepted when the user wrote it.
assert.equal(onDate('ซื้อมังงะ 1 ส.ค.').requestedLocalDate, '2027-08-01', 'a month already past rolls to next year rather than scheduling backwards');
assert.equal(onDate('ซื้อมังงะ 31 ก.ย.').requestedLocalDate, null, 'a date that does not exist must not roll into October');

// The clock must not be mistaken for a year: "1 กันยา 10:00" once produced 2010.
const datedClock = onDate('ซื้อมังงะ 1 กันยา 10:00');
assert.equal(datedClock.requestedLocalDate, '2026-09-01', 'a following clock must not be swallowed as the year');
assert.equal(datedClock.earliestLocalStartTime, null, 'no relation word means no earliest bound from the fallback reader');
const datedSpokenClock = onDate('ซื้อมังงะ 1 กันยา ตอน 10 โมง');
assert.equal(datedSpokenClock.requestedLocalDate, '2026-09-01');
assert.equal(datedSpokenClock.earliestLocalStartTime, '10:00', 'the explicit date and the explicit clock must both survive');
assert.equal(datedSpokenClock.taskTitle, 'ซื้อมังงะ', 'neither the date nor the clock belongs in the title');

// An unambiguous calendar date outranks both other kinds of day word.
assert.equal(onDate('ซื้อมังงะวันศุกร์ที่ 1 กันยา').requestedLocalDate, '2026-09-01', 'an explicit date wins over a weekday word');
assert.equal(onDate('ซื้อมังงะพรุ่งนี้ 1 กันยา').requestedLocalDate, '2026-09-01', 'an explicit date wins over a relative day word');
// ...and a message with no explicit date must still work exactly as before.
assert.equal(onDate('อ่านหนังสือวันนี้').requestedLocalDate, '2026-08-26', 'relative day words must keep working unchanged');
assert.equal(onDate('อ่านหนังสือ 2 ชั่วโมง').requestedLocalDate, null, 'a bare duration is not a date');
assert.equal(onDate('อ่านหนังสือ 2 ชั่วโมง').durationMinutes, 120);

// Politeness stacks up in real messages and none of it is part of the activity.
assert.equal(onDate('ซื้อมังงะให้หน่อยนะครับ').taskTitle, 'ซื้อมังงะ');
assert.equal(onDate('จัดให้ทีอ่านหนังสือพรุ่งนี้').taskTitle, 'อ่านหนังสือ');
assert.equal(onDate('ทำรายงานกลุ่มวันที่ 1 ก.ย. ด้วยนะ').taskTitle, 'ทำรายงานกลุ่ม');

// When Gemini answers, the server still owns the date, and the model's title
// goes through the same cleaner rather than being trusted verbatim.
const geminiEchoedTheSentence = applyDeterministicTemporalSemantics(
  {
    activityCategory: 'personal',
    deadline: null,
    durationMinutes: null,
    earliestLocalStartExclusive: false,
    earliestLocalStartTime: null,
    intent: 'create_activity',
    latestLocalStartTime: null,
    preferenceMode: null,
    preferredPeriod: null,
    requestedLocalDate: '2026-08-27',
    requiresConfirmation: true,
    taskTitle: 'ซื้อมังงะวันที่ 1 กันยาให้หน่อย',
  },
  'ซื้อมังงะวันที่ 1 กันยาให้หน่อย',
  {localDate: '2026-08-26'},
);
assert.equal(geminiEchoedTheSentence.requestedLocalDate, '2026-09-01',
  'the server must overrule a model date that contradicts the written one');

// When Gemini cannot be reached, an unread day or clock must become a question
// rather than a confident answer built on a silently widened search.
const stillUnread = (message, localDate = '2026-08-26') => {
  const parsed = onDate(message, localDate);
  return unresolvedTemporalMention(message, parsed);
};

assert.equal(stillUnread('ซื้อมังงะ 1 กันยา'), false, 'a date the fallback can read needs no clarification');
assert.equal(stillUnread('อ่านหนังสือวันนี้'), false);
assert.equal(stillUnread('อ่านหนังสือ'), false, 'an open request is not ambiguous, it is open');
assert.equal(stillUnread('อ่านหนังสือ 2 ชั่วโมง'), false, 'a duration is not an unread date');
assert.equal(stillUnread('ทำงาน 90 นาที'), false);
assert.equal(
  unresolvedTemporalMention('ซื้อมังงะ 1 เมษา', {
    deadline: null,
    earliestLocalStartTime: null,
    latestLocalStartTime: null,
    preferredPeriod: null,
    requestedLocalDate: null,
  }),
  true,
  'a written month that produced no date must be asked about, not guessed at',
);

assert.equal(onDate('อ่านหนังสือ 1/2 ชั่วโมง').requestedLocalDate, null,
  'a fraction of an hour must not be read as the first of February');

console.log('Adaptive Scheduling deterministic tests passed.');
