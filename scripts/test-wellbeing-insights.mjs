import assert from 'node:assert/strict';

import {activityForFreeSlot, WELLBEING_AI_DISCLAIMER} from '../src/config/trusted-coaching-knowledge.ts';
import {calculateBurnoutDynamicInsight, calculateFinanceBudgetInsight, SLEEP_REFERENCE, SLEEP_SCORE_WEIGHTS, sleepBandScore, sleepDurationBand} from '../src/services/dynamic-insights.ts';
import {baselineNightHours, parseClockMinutes, formatClockMinutes, suggestedWakeTime} from '../src/services/sleep-window.ts';
import {BURNOUT_RISK_BANDS, burnoutRiskBand, riskMeterFillPercent} from '../src/constants/burnout-risk.ts';

const ts = (value) => ({toDate: () => new Date(value), toMillis: () => new Date(value).getTime()});
const base = new Date('2026-08-19T12:00:00+07:00');
const activity = (title, start, end, extra = {}) => ({
  color: '#fff', createdAt: ts(start), endAt: ts(end), id: `${title}-${start}`,
  location: '', ownerId: 'u1', source: 'manual', startAt: ts(start), status: 'planned',
  title, type: 'activity', updatedAt: ts(start), ...extra,
});
const schedule = (title, start, end) => ({
  color: '#fff', courseCode: '', createdAt: ts(start), endAt: ts(end), id: `${title}-${start}`,
  location: '', ownerId: 'u1', source: 'manual', startAt: ts(start), title, updatedAt: ts(start),
});

const weekSchedules = [
  schedule('เรียนวันจันทร์', '2026-08-17T08:00:00+07:00', '2026-08-17T15:00:00+07:00'),
  schedule('เรียนวันอังคาร', '2026-08-18T08:00:00+07:00', '2026-08-18T15:00:00+07:00'),
  schedule('เรียนวันพุธ', '2026-08-19T08:00:00+07:00', '2026-08-19T15:00:00+07:00'),
];
const sleep = [
  activity('นอน', '2026-08-18T01:30:00+07:00', '2026-08-18T06:30:00+07:00'),
  activity('นอน', '2026-08-19T02:00:00+07:00', '2026-08-19T07:00:00+07:00'),
];
const tasks = Array.from({length: 4}, (_, index) => activity(
  `งาน ${index + 1}`,
  `2026-08-${20 + index}T09:00:00+07:00`,
  `2026-08-${20 + index}T10:00:00+07:00`,
  {deadline: ts(`2026-08-${20 + index}T09:00:00+07:00`), type: 'task'},
));
const burnout = calculateBurnoutDynamicInsight({
  activities: [], now: base, pendingTasks: tasks, schedules: [weekSchedules[2]],
  weekActivities: sleep, weekSchedules,
});
assert.equal(burnout.sleepDataDays, 2);
assert.equal(burnout.averageSleepHours, 5);
assert.equal(burnout.lateSleepStreak, 2);
assert.equal(burnout.highLoadDays, 3);
assert.ok(burnout.reasons.every((reason) => !reason.includes('เดา')));
assert.notEqual(burnout.riskLevel, 'low');

const noSleep = calculateBurnoutDynamicInsight({activities: [], now: base, schedules: [], weekActivities: [], weekSchedules: []});
assert.equal(noSleep.sleepDataDays, 0);
assert.equal(noSleep.averageSleepHours, null);
assert.equal(noSleep.evidenceCoverage, 'limited');

assert.match(activityForFreeSlot(25), /พัก/);
assert.match(activityForFreeSlot(30), /งานเล็ก/);
assert.match(activityForFreeSlot(180), /โปรเจกต์ใหญ่/);
assert.match(WELLBEING_AI_DISCLAIMER, /ผู้เชี่ยวชาญ/);

const finance = calculateFinanceBudgetInsight({
  monthlyBudget: 3100,
  now: base,
  transactions: [{amount: 560, occurredAt: ts('2026-08-18T12:00:00+07:00'), type: 'expense'}],
});
assert.ok(finance);
assert.equal(finance.weeklyBudget, 700);
assert.equal(finance.weeklyUsagePercent, 80);
assert.equal(finance.weeklyStatus, 'warning');
assert.equal(finance.weeklyRemainingBudget, 140);

// --- Sleep evidence: logged vs baseline vs nothing ---------------------------

// The NSF bands the score is built on, asserted as the published figures.
assert.equal(SLEEP_REFERENCE.insufficientHours, 6);
assert.equal(SLEEP_REFERENCE.recommendedMinHours, 7);
assert.equal(SLEEP_REFERENCE.recommendedMaxHours, 9);
assert.equal(SLEEP_REFERENCE.excessiveHours, 11);
assert.equal(sleepDurationBand(5.5), 'insufficient');
assert.equal(sleepDurationBand(6.5), 'borderline');
assert.equal(sleepDurationBand(8), 'recommended');
assert.equal(sleepDurationBand(11.5), 'excessive');
assert.equal(sleepDurationBand(null), 'unknown');

// Logged sleep is the strong source and reports itself as such.
assert.equal(burnout.sleepEvidenceSource, 'logged');
assert.equal(burnout.sleepBand, 'insufficient');
assert.equal(burnout.baselineSleepHours, null);

// Nothing at all stays honest: no number, no source, no debt.
assert.equal(noSleep.sleepEvidenceSource, 'none');
assert.equal(noSleep.sleepBand, 'unknown');
assert.equal(noSleep.sleepDebtHours, null);
assert.equal(noSleep.sleepDebtNights, 0);

// A baseline alone fills the number but must not pretend to be a measurement.
const baselineOnly = calculateBurnoutDynamicInsight({
  activities: [], now: base, schedules: [], sleepBaselineHours: 5,
  weekActivities: [], weekSchedules: [],
});
assert.equal(baselineOnly.sleepEvidenceSource, 'baseline');
assert.equal(baselineOnly.averageSleepHours, 5);
assert.equal(baselineOnly.baselineSleepHours, 5);
assert.equal(baselineOnly.sleepDataDays, 0, 'a baseline is not a logged night');
assert.equal(baselineOnly.sleepDebtHours, null, 'a baseline cannot create a debt');
assert.equal(baselineOnly.studyWorkToSleepRatio, null, 'the ratio needs measured sleep');
assert.ok(baselineOnly.reasons.some((reason) => reason.includes('ช่วงนอนปกติที่ตั้งไว้')));
assert.equal(baselineOnly.evidenceCoverage, 'limited', 'a baseline alone must not lift coverage');

// A baseline scores at roughly half a logged night's weight, never more.
const loggedShort = calculateBurnoutDynamicInsight({
  activities: [], now: base, schedules: [],
  weekActivities: [
    activity('นอน', '2026-08-18T23:00:00+07:00', '2026-08-19T04:00:00+07:00'),
    activity('นอน', '2026-08-17T23:00:00+07:00', '2026-08-18T04:00:00+07:00'),
  ],
  weekSchedules: [],
});
assert.equal(loggedShort.sleepEvidenceSource, 'logged');
assert.ok(loggedShort.score > baselineOnly.score, 'logged short sleep must outweigh the same figure as a baseline');

// A logged night always wins over a baseline that is set at the same time.
const bothSources = calculateBurnoutDynamicInsight({
  activities: [], now: base, schedules: [], sleepBaselineHours: 9,
  weekActivities: sleep, weekSchedules: [],
});
assert.equal(bothSources.sleepEvidenceSource, 'logged');
assert.equal(bothSources.averageSleepHours, 5);
assert.equal(bothSources.baselineSleepHours, 9, 'the baseline is still reported, just not used');

// --- Coverage upgrades as real nights accumulate -----------------------------

const night = (day, hours) => activity(
  'นอน',
  `2026-08-${String(day).padStart(2, '0')}T23:00:00+07:00`,
  `2026-08-${String(day + 1).padStart(2, '0')}T${String(23 + hours - 24).padStart(2, '0')}:00:00+07:00`,
);
const coverageFor = (nights) => calculateBurnoutDynamicInsight({
  activities: [], now: base, pendingTasks: tasks, schedules: [weekSchedules[2]],
  weekActivities: nights, weekSchedules,
}).evidenceCoverage;
assert.equal(coverageFor([]), 'partial', 'workload alone is partial, never strong');
assert.equal(coverageFor([night(16, 6), night(17, 6)]), 'partial');
assert.equal(coverageFor([night(16, 6), night(17, 6), night(18, 6)]), 'strong', 'three logged nights reach strong');

// --- Rolling sleep debt ------------------------------------------------------

const debtNights = [14, 15, 16, 17, 18].map((day) => night(day, 5));
const debtInsight = calculateBurnoutDynamicInsight({
  activities: [], now: base, schedules: [], weekActivities: debtNights, weekSchedules: [],
});
assert.equal(debtInsight.sleepDebtNights, 5);
// Five nights at 5h against a 7h target: 5 x 2 = 10 hours of accumulated debt.
assert.equal(debtInsight.sleepDebtHours, 10);
assert.ok(debtInsight.reasons.some((reason) => reason.includes('นอนขาด')));

// Recovery sleep pays the debt back, and a surplus floors at zero rather than
// banking credit.
const restedInsight = calculateBurnoutDynamicInsight({
  activities: [], now: base, schedules: [],
  weekActivities: [16, 17, 18].map((day) => night(day, 9)),
  weekSchedules: [],
});
assert.equal(restedInsight.sleepDebtHours, 0);
assert.ok(restedInsight.protectiveFactors.some((factor) => factor.includes('ไม่มีการนอนขาดสะสม')));

// A night still in progress is a placeholder, not evidence.
const openNight = calculateBurnoutDynamicInsight({
  activities: [], now: base, schedules: [],
  weekActivities: [activity('นอน', '2026-08-19T23:00:00+07:00', '2026-08-20T07:00:00+07:00', {status: 'in-progress'})],
  weekSchedules: [],
});
assert.equal(openNight.sleepDataDays, 0, 'an unfinished night must not count');
assert.equal(openNight.sleepEvidenceSource, 'none');
// Nor may the provisional span leak into the workload side and read as eight
// hours of activity -- it is excluded as sleep regardless of its status.
assert.equal(openNight.busyHoursThisWeek, 0, 'a placeholder night is not workload either');
assert.equal(openNight.highLoadDays, 0);

// --- Baseline window arithmetic ---------------------------------------------

assert.equal(parseClockMinutes('23:00'), 1380);
assert.equal(parseClockMinutes('7:30'), 450);
assert.equal(parseClockMinutes('24:00'), null);
assert.equal(parseClockMinutes('12:60'), null);
assert.equal(parseClockMinutes('abc'), null);
assert.equal(formatClockMinutes(1380), '23:00');
// The usual case wraps past midnight.
assert.equal(baselineNightHours({bedtimeMinutes: 1380, wakeMinutes: 420}), 8);
assert.equal(baselineNightHours({bedtimeMinutes: 60, wakeMinutes: 420}), 6);
// Windows that cannot describe a night are rejected rather than clamped.
assert.equal(baselineNightHours({bedtimeMinutes: 1380, wakeMinutes: 1410}), null);
assert.equal(baselineNightHours({bedtimeMinutes: 0, wakeMinutes: 0}), null);
assert.equal(baselineNightHours(null), null);

// --- Long sleep is weighted below short sleep -------------------------------

// The asymmetry is the point: oversleeping is mostly observational evidence and
// often a symptom rather than a driver, so it must not carry a deprivation-sized
// penalty. These assertions fail if someone later makes the bands symmetric.
assert.ok(
  SLEEP_SCORE_WEIGHTS.excessive < SLEEP_SCORE_WEIGHTS.insufficient,
  'long sleep must weigh less than short sleep',
);
assert.ok(
  SLEEP_SCORE_WEIGHTS.excessive < SLEEP_SCORE_WEIGHTS.borderline,
  'long sleep must weigh less than merely-short sleep too',
);
assert.ok(
  SLEEP_SCORE_WEIGHTS.excessive <= SLEEP_SCORE_WEIGHTS.insufficient / 2,
  'long sleep should sit well below half the short-sleep weight',
);
assert.equal(sleepBandScore('insufficient', 'logged'), SLEEP_SCORE_WEIGHTS.insufficient);
assert.equal(sleepBandScore('excessive', 'logged'), SLEEP_SCORE_WEIGHTS.excessive);
assert.equal(sleepBandScore('recommended', 'logged'), 0);
assert.equal(sleepBandScore('unknown', 'logged'), 0);
// A stated habit is halved again, in every band.
assert.equal(sleepBandScore('insufficient', 'baseline'), Math.round(SLEEP_SCORE_WEIGHTS.insufficient / 2));
assert.equal(sleepBandScore('excessive', 'baseline'), Math.round(SLEEP_SCORE_WEIGHTS.excessive / 2));
assert.equal(sleepBandScore('insufficient', 'none'), SLEEP_SCORE_WEIGHTS.insufficient);

// End to end through the real scorer: identical workload, opposite sleep
// directions. The short-sleep week must score strictly higher.
const nightsAt = (hours) => [16, 17, 18].map((day) => {
  const endHour = 23 + hours - 24;
  return activity(
    'นอน',
    `2026-08-${day}T23:00:00+07:00`,
    `2026-08-${day + 1}T${String(endHour).padStart(2, '0')}:00:00+07:00`,
  );
});
const shortSleepWeek = calculateBurnoutDynamicInsight({
  activities: [], now: base, schedules: [], weekActivities: nightsAt(5), weekSchedules: [],
});
const longSleepWeek = calculateBurnoutDynamicInsight({
  activities: [], now: base, schedules: [], weekActivities: nightsAt(12), weekSchedules: [],
});
assert.equal(shortSleepWeek.sleepBand, 'insufficient');
assert.equal(longSleepWeek.sleepBand, 'excessive');
assert.ok(
  longSleepWeek.score < shortSleepWeek.score,
  `long sleep (${longSleepWeek.score}) must score below short sleep (${shortSleepWeek.score})`,
);
assert.ok(
  longSleepWeek.reasons.some((reason) => reason.includes('ถ่วงน้ำหนักน้อยกว่า')),
  'the long-sleep reason should say it is weighted lower',
);
console.log(`  sleep asymmetry -> short ${shortSleepWeek.score} vs long ${longSleepWeek.score}`);

// --- Forgotten wake: the suggested time is always a usable night ------------

const bed = new Date('2026-08-18T23:00:00+07:00');
// With a baseline, the suggestion is that person's usual wake time next morning.
const withBaseline = suggestedWakeTime(bed, {bedtimeMinutes: 1380, wakeMinutes: 420});
assert.equal((withBaseline.getTime() - bed.getTime()) / 36e5, 8);
// Without one, it falls back to a default night rather than guessing wildly.
const withoutBaseline = suggestedWakeTime(bed, null);
assert.equal((withoutBaseline.getTime() - bed.getTime()) / 36e5, 8);
// A baseline whose wake time would imply an impossible night falls back to the
// baseline's own length instead of proposing a 20-hour sleep.
const oddBed = new Date('2026-08-18T09:00:00+07:00');
const odd = suggestedWakeTime(oddBed, {bedtimeMinutes: 1380, wakeMinutes: 420});
const oddSpan = (odd.getTime() - oddBed.getTime()) / 36e5;
assert.ok(oddSpan >= 2 && oddSpan <= 14, `suggested night must be usable, got ${oddSpan}h`);
// Whatever it proposes must be something the model would actually accept.
for (const window of [null, {bedtimeMinutes: 1380, wakeMinutes: 420}, {bedtimeMinutes: 60, wakeMinutes: 420}]) {
  for (const hour of [21, 23, 1, 3, 9]) {
    const start = new Date(`2026-08-18T${String(hour).padStart(2, '0')}:00:00+07:00`);
    const span = (suggestedWakeTime(start, window).getTime() - start.getTime()) / 36e5;
    assert.ok(span >= 2 && span <= 14, `bed ${hour}:00 window ${JSON.stringify(window)} gave ${span}h`);
  }
}
console.log('  forgotten wake  -> every suggested wake time lands inside 2-14h');

// --- Risk meter: fill and colour, tied to the label -------------------------

// The fill is the score, clamped. Nothing here may overflow the track.
assert.equal(riskMeterFillPercent(45), 45);
assert.equal(riskMeterFillPercent(0), 0);
assert.equal(riskMeterFillPercent(100), 100);
assert.equal(riskMeterFillPercent(44.6), 45);
assert.equal(riskMeterFillPercent(140), 100, 'an over-range score must not overflow the bar');
assert.equal(riskMeterFillPercent(-20), 0, 'a negative score must not invert the bar');
assert.equal(riskMeterFillPercent(Number.NaN), 0);

// Every band has its own colour, so the three states are distinguishable.
const bandColours = Object.values(BURNOUT_RISK_BANDS).map((band) => band.color);
assert.equal(new Set(bandColours).size, 3, 'each band needs a distinct colour');
assert.equal(BURNOUT_RISK_BANDS.low.label, 'ต่ำ');
assert.equal(BURNOUT_RISK_BANDS.medium.label, 'ปานกลาง');
assert.equal(BURNOUT_RISK_BANDS.high.label, 'สูง');
// Green / amber / red, reused from the monthly-budget meter.
assert.equal(BURNOUT_RISK_BANDS.low.color, '#618661');
assert.equal(BURNOUT_RISK_BANDS.medium.color, '#c98a3f');
assert.equal(BURNOUT_RISK_BANDS.high.color, '#d66963');
// An unexpected level falls back rather than rendering an undefined colour.
assert.equal(burnoutRiskBand(undefined).color, BURNOUT_RISK_BANDS.low.color);

// The meter must actually change state across real model output, not sit on one
// colour. These three inputs are run through the real scorer, and the band is
// looked up from the level the model produced -- the same lookup the bar uses.
const meterCase = (label, insight) => {
  const band = burnoutRiskBand(insight.riskLevel);
  // The thresholds live in dynamic-insights; the test restates them so a silent
  // change to either the bands or the scorer is caught here.
  const expected = insight.score >= 65 ? 'high' : insight.score >= 35 ? 'medium' : 'low';
  assert.equal(insight.riskLevel, expected, `${label}: score ${insight.score} should be ${expected}`);
  assert.equal(band.label, BURNOUT_RISK_BANDS[expected].label, `${label}: label must match the band`);
  assert.equal(band.color, BURNOUT_RISK_BANDS[expected].color, `${label}: colour must match the band`);
  assert.equal(riskMeterFillPercent(insight.score), insight.score, `${label}: fill must equal the score`);
  return {color: band.color, fill: riskMeterFillPercent(insight.score), label: band.label, level: insight.riskLevel, score: insight.score};
};

const idleDay = calculateBurnoutDynamicInsight({activities: [], now: base, schedules: [], weekActivities: [], weekSchedules: []});
// One heavy day plus a task backlog scores 50: mid-band, not on a boundary.
const busyWeek = calculateBurnoutDynamicInsight({
  activities: [], now: base, pendingTasks: tasks, schedules: [weekSchedules[2]],
  weekActivities: [], weekSchedules: [weekSchedules[2]],
});
const overloadedWeek = calculateBurnoutDynamicInsight({
  activities: [], now: base, pendingTasks: tasks, schedules: [weekSchedules[2]],
  weekActivities: sleep, weekSchedules,
});

const lowState = meterCase('idle', idleDay);
const mediumState = meterCase('busy', busyWeek);
const highState = meterCase('overloaded', overloadedWeek);

assert.equal(lowState.level, 'low');
assert.equal(mediumState.level, 'medium');
assert.equal(highState.level, 'high');
// The three states must be visibly different, which is the whole point of the
// bar: different length AND different colour.
assert.ok(lowState.fill < mediumState.fill && mediumState.fill < highState.fill, 'fill must grow with the score');
assert.equal(new Set([lowState.color, mediumState.color, highState.color]).size, 3, 'the three states must differ in colour');
console.log(`  meter states -> low ${lowState.fill}% ${lowState.color} | medium ${mediumState.fill}% ${mediumState.color} | high ${highState.fill}% ${highState.color}`);

console.log('Wellbeing, sleep-evidence, risk-meter, and weekly-budget tests passed.');
