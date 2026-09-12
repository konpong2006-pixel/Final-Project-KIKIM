import {getFunctions, httpsCallable} from 'firebase/functions';

import {firebaseApp} from '@/lib/firebase';
import {ensureAppCheckReady} from '@/lib/app-check';

export type AdaptiveCategory = 'administration' | 'assignment' | 'exercise' | 'gaming' | 'other' | 'personal_project' | 'programming' | 'reading' | 'rest' | 'shopping' | 'study';
export type AdaptiveConfidence = 'high' | 'insufficient' | 'low' | 'medium';

export type AdaptivePreferences = {
  allowAiSuggestions: boolean;
  allowAutomaticRescheduling: boolean;
  allowBehavioralPersonalization: boolean;
  allowGeminiInsights: boolean;
  availableDays: number[];
  earliestSchedulingTime: string;
  latestSchedulingTime: string;
  maximumDailyWorkMinutes: number;
  maximumFocusSessionMinutes: number;
  minimumAutomaticConfidence: number;
  minimumBreakMinutes: number;
  notificationsEnabled: boolean;
  preferredTimeByCategory: Partial<Record<AdaptiveCategory, {endTime: string; startTime: string}>>;
  sleepTime: string | null;
  timeZone: string;
  transitionMinutes: number;
  unavailablePeriods?: {category?: AdaptiveCategory; days: number[]; endTime: string; startTime: string}[];
  wakeTime: string | null;
};

export type AdaptiveSuggestion = {
  activityCategory: AdaptiveCategory;
  alternativeOptions?: {
    endAt: string;
    expectedBenefit: string;
    label: string;
    startAt: string;
    tradeoff: string;
  }[];
  basedOnScheduleVersion?: number;
  confidence: number;
  createdAt: string;
  expectedBenefit: string;
  explanation: string;
  expiresAt: string;
  generatedForLocalDate?: string;
  generatedForTimeZone?: string;
  id: string;
  mode: 'automatic' | 'suggestion';
  observationCount: number;
  originalEndAt: string;
  originalStartAt: string;
  scheduleItemId: string;
  status: 'accepted' | 'expired' | 'pending' | 'rejected';
  suggestedEndAt: string;
  suggestedStartAt: string;
  taskTitle: string;
  validUntil?: string;
};

export type AdaptivePattern = {
  activityCategory: AdaptiveCategory;
  averageDurationMinutes: number;
  averageStartDelayMinutes: number;
  completionRate: number;
  confidenceLevel: AdaptiveConfidence;
  confidenceScore: number;
  dayOfWeek: number | null;
  id: string;
  observationCount: number;
  postponementRate: number;
  preferredEndHour: number;
  preferredStartHour: number;
  suggestionAcceptanceRate: number;
};

export type AdaptiveHistory = {
  actionLabel?: string;
  actor?: 'adaptive_ai' | 'user';
  automatic: boolean;
  canUndoUntil: string;
  createdAt: string;
  id: string;
  newEndAt?: string;
  newStartAt: string;
  previousEndAt?: string;
  previousStartAt: string;
  reason?: string;
  scheduleItemId: string;
  source?: string;
  status: 'applied' | 'undone';
  suggestionId: string;
  syncStatus?: 'failed' | 'not_required' | 'pending' | 'synced';
  taskTitle?: string;
  timeZone?: string;
  updatedAt?: string;
};

export type ProductivityInsight = {
  activityCategory: AdaptiveCategory;
  id: string;
  message: string;
  observationCount: number;
  updatedAt: string;
};

export type AdaptiveDashboard = {
  dailyWorkload: {date: string; highWorkload: boolean; minutes: number}[];
  history: AdaptiveHistory[];
  insights: ProductivityInsight[];
  patterns: AdaptivePattern[];
  preferences: AdaptivePreferences;
  serverNow?: string;
  suggestions: AdaptiveSuggestion[];
  weeklyWorkloadMinutes: number;
};

export type ActivateAdaptiveResult = {
  diagnostics: {eligibleActivities: number; skippedActivities: number};
  enabled: boolean;
  suggestions: AdaptiveSuggestion[];
};

export type AdaptiveProposedActivity = {
  activityCategory: AdaptiveCategory;
  allowOverlap?: boolean;
  dateLocked?: boolean;
  deadline: string | null;
  durationMinutes: number;
  endAt: string;
  explanation: string;
  generatedForTimeZone?: string;
  startAt: string;
  title: string;
  userSelectedTime?: boolean;
  /**
   * Set only when the exact day or time asked for was already taken, naming
   * what was unavailable so the card can offer this slot as an alternative
   * rather than presenting it as the time the user requested.
   */
  unavailableRequest?: string;
};

type CreateActivityRequest = AdaptiveProposedActivity & {clientRequestId?: string};

export type AdaptiveCreateConflict = {
  endAt: string;
  id: string;
  kind: 'activity' | 'schedule';
  startAt: string;
  title: string;
};

export type AdaptiveCreateActivityResult =
  | {adjusted: false; conflicts: AdaptiveCreateConflict[]; endAt: string; id: ''; requiresConflictConfirmation: true; saved: false; startAt: string}
  | {adjusted: false; conflicts: AdaptiveCreateConflict[]; endAt: string; id: string; requiresConflictConfirmation: false; saved: true; startAt: string};

export type NaturalLanguageScheduleResult = {
  dashboard?: AdaptiveDashboard;
  intent: {
    activityCategory: AdaptiveCategory | null;
    deadline: string | null;
    durationMinutes: number | null;
    earliestLocalStartExclusive: boolean;
    earliestLocalStartTime: string | null;
    intent: string;
    latestLocalStartTime: string | null;
    preferredPeriod: string | null;
    preferenceMode: 'avoid' | 'prefer' | null;
    requestedLocalDate: string | null;
    requiresConfirmation: true;
    taskTitle: string | null;
  };
  message?: string;
  history?: {reason?: string; previousStartAt?: string; newStartAt?: string} | null;
  preferencePatch?: Partial<AdaptivePreferences>;
  proposedActivity?: AdaptiveProposedActivity;
  suggestion?: AdaptiveSuggestion;
  suggestions?: AdaptiveSuggestion[];
};

const functions = getFunctions(firebaseApp, 'asia-southeast1');
const activateCall = httpsCallable<Record<string, never>, ActivateAdaptiveResult>(functions, 'activateAdaptiveScheduling');
const dashboardCall = httpsCallable<Record<string, never>, AdaptiveDashboard>(functions, 'getAdaptiveSchedulingDashboard');
const updatePreferencesCall = httpsCallable<{preferences: Partial<AdaptivePreferences>}, {preferences: AdaptivePreferences}>(functions, 'updateAdaptiveSchedulingPreferences');
const acceptCall = httpsCallable<{suggestionId: string}, {activityId: string; historyId: string}>(functions, 'acceptSchedulingSuggestion');
const rejectCall = httpsCallable<{suggestionId: string}, {ok: true}>(functions, 'rejectSchedulingSuggestion');
const alternativeCall = httpsCallable<{startAt: string; suggestionId: string}, {endAt: string; startAt: string}>(functions, 'chooseAlternativeSchedulingTime');
const lockCall = httpsCallable<{activityId: string}, {ok: true}>(functions, 'lockAdaptiveScheduleItem');
const undoCall = httpsCallable<{historyId: string}, {activityId: string}>(functions, 'undoScheduleChange');
const deletePatternCall = httpsCallable<{patternId: string}, {ok: true}>(functions, 'deleteSchedulingPattern');
const deleteHistoryCall = httpsCallable<Record<string, never>, {deleted: number}>(functions, 'deleteSchedulingBehaviorHistory');
const calculatePatternsCall = httpsCallable<Record<string, never>, {expired: number; patterns: number; recorded: number}>(functions, 'calculateSchedulingPatterns');
const createActivityCall = httpsCallable<CreateActivityRequest, AdaptiveCreateActivityResult>(functions, 'createAdaptiveActivity');
const naturalLanguageCall = httpsCallable<{message: string}, NaturalLanguageScheduleResult>(functions, 'processNaturalLanguageScheduleCommand');
const rebalanceDayCall = httpsCallable<{date?: string}, {suggestions: AdaptiveSuggestion[]}>(functions, 'rebalanceUserDay');
const rebalanceWeekCall = httpsCallable<{date?: string}, {suggestions: AdaptiveSuggestion[]}>(functions, 'rebalanceUserWeek');
const registerTokenCall = httpsCallable<{platform: 'android' | 'ios'; token: string}, {ok: true}>(functions, 'registerAdaptivePushToken');
type RecordBehaviorRequest = {
  actualDurationMinutes?: number | null;
  actualEnd?: string | null;
  actualStart?: string | null;
  eventType: string;
  metadata?: Record<string, boolean | number | string>;
  /**
   * The slot the activity occupied before the user moved it. Required for a
   * postpone, where the activity document already holds the new time by the
   * time the event is recorded.
   */
  originalScheduledStart?: string | null;
  scheduleItemId: string;
  source?: 'ai_suggestion' | 'automatic_scheduler' | 'user';
  updatedScheduledStart?: string | null;
};

const recordBehaviorCall = httpsCallable<RecordBehaviorRequest, {id: string; patterns: number}>(functions, 'recordSchedulingBehavior');

async function invoke<Request, Response>(call: (data: Request) => Promise<{data: Response}>, data: Request) {
  await ensureAppCheckReady();
  return (await call(data)).data;
}

export const adaptiveScheduling = {
  accept: (suggestionId: string) => invoke(acceptCall, {suggestionId}),
  activate: () => invoke(activateCall, {}),
  calculatePatterns: () => invoke(calculatePatternsCall, {}),
  chooseAlternative: (suggestionId: string, startAt: Date) => invoke(alternativeCall, {suggestionId, startAt: startAt.toISOString()}),
  createActivity: (proposal: AdaptiveProposedActivity, clientRequestId?: string) => invoke(createActivityCall, {...proposal, ...(clientRequestId ? {clientRequestId} : {})}),
  deleteBehaviorHistory: () => invoke(deleteHistoryCall, {}),
  deletePattern: (patternId: string) => invoke(deletePatternCall, {patternId}),
  getDashboard: () => invoke(dashboardCall, {}),
  lock: (activityId: string) => invoke(lockCall, {activityId}),
  processCommand: (message: string) => invoke(naturalLanguageCall, {message}),
  rebalanceDay: (date?: Date) => invoke(rebalanceDayCall, date ? {date: date.toISOString()} : {}),
  rebalanceWeek: (date?: Date) => invoke(rebalanceWeekCall, date ? {date: date.toISOString()} : {}),
  registerPushToken: (token: string, platform: 'android' | 'ios') => invoke(registerTokenCall, {platform, token}),
  recordBehavior: (data: RecordBehaviorRequest) => invoke(recordBehaviorCall, data),
  reject: (suggestionId: string) => invoke(rejectCall, {suggestionId}),
  undo: (historyId: string) => invoke(undoCall, {historyId}),
  updatePreferences: async (preferences: Partial<AdaptivePreferences>) => (await invoke(updatePreferencesCall, {preferences})).preferences,
};
