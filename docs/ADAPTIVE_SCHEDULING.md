# AI Adaptive Scheduling

SmartLife Adaptive Scheduling learns category-specific time preferences from a user's own activity history and proposes conflict-free times for flexible tasks. It reuses the existing Firebase project, authentication, Firestore database, Cloud Functions region, Gemini secret, Google Calendar integration, notification collection, and `activities`/`schedules` collections.

## Safety model

- `schedules` are fixed constraints for AI-generated suggestions. This includes classes, OCR/university imports, and Google Calendar imports.
- An `activity` can move only when `isFlexible == true`, `isLocked == false`, and `allowAiReschedule == true`.
- Appointments, participant activities, and records with a Google event ID are never moved by Adaptive Scheduling.
- Suggestion Mode is the default. `allowAutomaticRescheduling` defaults to `false`.
- Automatic mode still requires every task to be flexible, unlocked, allowed, conflict-free, before its deadline, below the workload limit, and above `minimumAutomaticConfidence`.
- Gemini never writes schedules. It only produces strict structured intent or wording based on verified facts. The deterministic engine makes and revalidates every time decision.
- If Gemini is unavailable or returns invalid JSON, deterministic parsing/explanations continue to work.
- A new event that overlaps a saved activity or schedule is not silently rejected. The app lists every conflicting item and returns to the time editor, or lets the user explicitly confirm a concurrent activity before the final write.
- `allowOverlap` is a one-request confirmation signal, not a saved preference. AI suggestions remain conflict-free by default.
- Explicit calendar dates are hard date constraints and may be months or years ahead. The search jumps directly to the requested local day instead of applying the former 60-day horizon.

## Existing services reused

| Concern | Existing integration reused |
| --- | --- |
| Firebase client | `src/lib/firebase.ts` (`firebaseApp`, `auth`, `db`, `storage`) |
| Firebase Admin | `functions/src/index.ts` |
| Authentication | Existing Firebase Auth token; callable handlers derive the UID from `request.auth.uid` |
| Tasks | `users/{uid}/activities` |
| Fixed calendar | `users/{uid}/schedules` |
| Google Calendar | Existing OAuth/client sync; imported events remain fixed |
| Notifications | Existing `users/{uid}/notifications` plus native FCM token registration |
| Gemini | Existing `GEMINI_API_KEY` Secret Manager secret; default model `gemini-3.6-flash` |
| Attachments | Existing Firebase Storage paths; no additional storage system |

## Firestore schema

All documents are below the authenticated user's document.

### Extended activity fields

`users/{uid}/activities/{activityId}` keeps all existing fields and may also contain:

```text
isFlexible, isLocked, allowAiReschedule, fixedLocalDate, userSelectedTime
priority, category, estimatedDurationMinutes, actualDurationMinutes
deadline, originalScheduledStart, actualStart, actualEnd
aiScheduled, aiReason, aiConfidence, scheduleVersion
googleCalendarId, googleEventId, googleSyncStatus
```

Manual create/update rules validate the full post-write document. AI-calculated fields and optimistic `scheduleVersion` cannot be forged by the client.

### Adaptive documents

```text
users/{uid}/settings/adaptiveScheduling
users/{uid}/schedulingBehaviorEvents/{eventId}
users/{uid}/schedulingPatterns/{category-day}
users/{uid}/schedulingSuggestions/{suggestionId}
users/{uid}/scheduleChangeHistory/{historyId}
users/{uid}/productivityInsights/{insightId}
users/{uid}/pushTokens/{tokenHash}
```

- Preferences contain availability, sleep/wake times, explicit category periods, category-specific unavailable periods, scoring weights, confidence thresholds, workload/break limits, privacy switches, and notification/automatic-mode switches.
- Behavior events record creates, starts, completions, postponements, cancellations, rejections, acceptances, reschedules, and undo actions.
- Patterns are calculated separately by category and day of week. Fewer than 3 observations is insufficient; 3–5 is low, 6–10 medium, and 11+ high confidence by default.
- Suggestions store the old/new times, score breakdown, observation count, explanation, expected benefit, original schedule version, expiry, and response status.
- History stores a reversible before/after snapshot and version information.
- Raw push tokens are callable/Admin-only and cannot be read or written from the Firestore client.

## Deterministic engine

`functions/src/adaptive-scheduling/engine.ts` performs:

1. Time-zone-aware availability and day-of-week calculation.
2. Wake/sleep, configured unavailable-period, deadline, duration, and available-day checks.
3. Conflict checks against all classes, Google imports, fixed items, locked items, and other activities, including transition time. Suggested slots remain conflict-free; a create request may bypass only the conflict check after an explicit overlap confirmation.
4. Daily workload and consecutive-difficult-task burnout penalties.
5. Category/day pattern scoring, explicit category preference scoring, priority, deadline urgency, completion probability, postponement penalty, and workload penalty.
6. Final validation again inside the acceptance transaction.

Explicit preferences receive the strongest preference weight and category-specific exclusions are hard constraints. All weights and observation thresholds are sanitized server-side.

Automatic suggestions continue to respect the saved wake/sleep and availability window. When the user explicitly asks for a clock time or a named night period, that request may use the overnight `21:00-05:00` window (including `00:00-05:00`) without changing the user's normal sleep settings. Conflict, deadline, duration, and workload validation still applies.

## Cloud Functions

The following exports are registered in `functions/src/index.ts`:

```text
getAdaptiveSchedulingDashboard
updateAdaptiveSchedulingPreferences
recordSchedulingBehavior
calculateSchedulingPatterns
generateAdaptiveSuggestion
acceptSchedulingSuggestion
rejectSchedulingSuggestion
chooseAlternativeSchedulingTime
lockAdaptiveScheduleItem
undoScheduleChange
deleteSchedulingPattern
deleteSchedulingBehaviorHistory
registerAdaptivePushToken
processNaturalLanguageScheduleCommand
createAdaptiveActivity
rebalanceUserDay
rebalanceUserWeek
scheduledAdaptivePatternRecalculation
scheduledAutomaticAdaptiveScheduling
```

All callables require Firebase Authentication and App Check. Accept and automatic changes re-read the suggestion, activity version/time, preferences, schedules, and activities inside a Firestore transaction before updating the task, history, behavior event, suggestion status, and one deduplicated notification.

## Gemini responsibilities

Gemini can classify an activity, parse Thai/English commands, and turn verified statistics into friendly Thai explanations. Structured command output is validated with an exact key set, enum checks, type/range limits, ISO date validation, and `requiresConfirmation == true`. Invalid or unavailable Gemini output falls back to local parsing.

Supported requests include finding study time, moving unfinished tasks, rebalancing a day/week, asking when the user is productive, explaining the latest move, preferring a category period, and avoiding a category period.

## Google Calendar behavior

Google OAuth tokens remain in the existing client session and are not copied to Firestore or Functions. Therefore:

- imported Google events are always fixed constraints;
- a record with `googleEventId` cannot be moved by Adaptive Scheduling;
- no function claims that an external event was synchronized when it was not;
- existing manual Google sync continues to prevent duplicate imported/pushed schedule events.

This conservative behavior avoids unsafe server-side calendar writes without a securely persisted refresh-token design.

## UI and notifications

The Planner has an **Adaptive** tab and a direct route at `/user/smartlife_adaptive_scheduling`. It includes suggestion cards, alternative-time validation, accept/reject/lock/undo, workload summaries, patterns, insights, settings, automatic-mode control, and privacy deletion. Manual activity forms, assistant confirmation cards, and the Adaptive create flow all show the same overlap dialog with the conflicting titles/times, a return-to-edit action, and a separate explicit **save overlapping** action.

Date pickers and ISO date validation intentionally have no near-term maximum. Firestore timestamps store long-range dates directly; Adaptive requests with an explicit date inspect that requested local day even when it is years away.

`expo-notifications` registers a native FCM/APNs device token through an authenticated callable. Functions write one Firestore notification per action and send best-effort FCM without rolling back a successful schedule transaction when push delivery fails.

## Tests

```bash
npm run typecheck
npm run lint
npm run test:adaptive
npm run test:firestore-rules
npm run test:adaptive-transactions
```

- Deterministic tests cover fixed/locked/external events, conflict warnings, explicit conflict overrides, deadlines, sleep, an explicit `00:00-05:00` override with automatic sleep protection, category exclusions, workload, long-range explicit dates, category patterns, confidence thresholds, automatic-mode default, and Gemini schema rejection.
- Firestore Emulator rules tests cover own/cross-user/anonymous access, forged AI fields, invalid flexible appointments/participant events, server-only paths, settings, and token writes.
- Transaction Emulator tests cover accept, reject, Undo, conflict rollback, stale multi-device suggestions, external Google events, history/events, and notification deduplication.

## Deployment

The implementation does not create or reconfigure a Firebase project. From the repository root, an authorized maintainer can deploy to the existing shared project:

```bash
npm run typecheck
npm run test:adaptive
npm run test:firestore-rules
npm run deploy:adaptive-backend
```

The named-function deployment is intentional. The shared project also contains LINE integration functions maintained by another source tree. Do not replace this command with an unscoped `--only functions` deployment unless those functions have first been merged into the same source tree, because Firebase CLI may otherwise ask to delete them.

Rebuild the native Android development app once after adding or changing `expo-notifications`. On Windows, use Android Studio's bundled JDK 21 so Gradle does not accidentally select an incompatible system JDK:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
npx expo prebuild --platform android
npm run android
```

After that native rebuild, JavaScript/TypeScript-only updates can use the existing Development Build. Rebuild again only when a native dependency, config plugin, Android permission, or native app configuration changes.

No new Gemini key is required. `GEMINI_API_KEY` remains in Firebase Secret Manager.
