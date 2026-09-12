import {isDemoMode} from '@/lib/demo-mode';
import {adaptiveScheduling} from '@/services/adaptive-scheduling';

/**
 * The screen-side half of adaptive scheduling's learning loop.
 *
 * `recordSchedulingBehavior` has existed on the server since the feature was
 * written, but nothing on any screen ever called it, so `outcomeCount` stayed
 * at zero for every real user and `completionRate` / `postponementRate` were
 * permanently 0. This module is the missing input: the places a user really
 * finishes or moves a piece of work call in here, and the engine finally has
 * something to learn from.
 *
 * Every function is deliberately fire-and-forget. Recording is telemetry for a
 * future suggestion, never a step the user is waiting on -- a learning event
 * that cannot be written must not turn a successful "mark done" into an error
 * the user has to dismiss. Failures are warned about so they stay visible in
 * development instead of disappearing.
 */

type CompletionDetail = {
  /** When the slot was scheduled to end, used to estimate how long it ran. */
  scheduledEndAt?: Date | null;
  /** When the slot was scheduled to start. */
  scheduledStartAt?: Date | null;
};

function minutesBetween(from: Date | null | undefined, to: Date | null | undefined) {
  if (!from || !to) return null;
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  return minutes > 0 && minutes <= 1440 ? minutes : null;
}

type BehaviorRequest = Parameters<typeof adaptiveScheduling.recordBehavior>[0];

async function record(request: BehaviorRequest) {
  // Demo mode has no Firestore behind it, and its activity ids do not resolve
  // server-side, so recording would only produce not-found noise.
  if (isDemoMode || !request.scheduleItemId) return false;
  try {
    await adaptiveScheduling.recordBehavior({source: 'user', ...request});
    return true;
  } catch (error) {
    console.warn('[behavior-tracking] could not record a scheduling behaviour event', {error, eventType: request.eventType, scheduleItemId: request.scheduleItemId});
    return false;
  }
}

/**
 * The user marked a scheduled activity done. This is what moves
 * `completionRate` up for that category and weekday.
 */
export function recordTaskCompleted(scheduleItemId: string, detail: CompletionDetail = {}) {
  return record({
    actualDurationMinutes: minutesBetween(detail.scheduledStartAt, detail.scheduledEndAt),
    eventType: 'task_completed',
    scheduleItemId,
  });
}

/**
 * The user moved a scheduled activity to a later time themselves.
 *
 * `originalScheduledStart` has to be sent explicitly: the activity document is
 * updated before this runs, so the server would otherwise read the new time as
 * both the old and the new one and learn nothing from the move.
 */
export function recordTaskPostponed(scheduleItemId: string, fromStart: Date, toStart: Date) {
  return record({
    eventType: 'task_postponed',
    metadata: {movedByMinutes: Math.round((toStart.getTime() - fromStart.getTime()) / 60_000)},
    originalScheduledStart: fromStart.toISOString(),
    scheduleItemId,
    updatedScheduledStart: toStart.toISOString(),
  });
}
