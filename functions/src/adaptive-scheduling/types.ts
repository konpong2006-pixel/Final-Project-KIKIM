export const ADAPTIVE_ACTIVITY_CATEGORIES = [
  "administration",
  "assignment",
  "exercise",
  "gaming",
  "other",
  "personal_project",
  "programming",
  "reading",
  "rest",
  "shopping",
  "study",
] as const;

export type AdaptiveActivityCategory = typeof ADAPTIVE_ACTIVITY_CATEGORIES[number];

export const ADAPTIVE_BEHAVIOR_EVENT_TYPES = [
  "automatic_change_undone",
  "completed_earlier_than_expected",
  "duration_exceeded",
  "reminder_ignored",
  "suggestion_accepted",
  "suggestion_modified",
  "suggestion_rejected",
  "task_cancelled",
  "task_completed",
  "task_created",
  "task_postponed",
  "task_rescheduled",
  "task_skipped",
  "task_started",
] as const;

export type AdaptiveBehaviorEventType = typeof ADAPTIVE_BEHAVIOR_EVENT_TYPES[number];
export type AdaptivePriority = "high" | "low" | "medium" | "urgent";
export type AdaptiveTimePeriod = "afternoon" | "early_morning" | "evening" | "late_morning" | "morning" | "night";
export type AdaptiveConfidenceLevel = "high" | "insufficient" | "low" | "medium";

export type UnavailablePeriod = {
  category?: AdaptiveActivityCategory;
  days: number[];
  endTime: string;
  startTime: string;
};

export type PreferredPeriod = {
  endTime: string;
  startTime: string;
};

export type AdaptiveScoreWeights = {
  burnoutPenalty: number;
  categoryPreference: number;
  completionProbability: number;
  deadlineUrgency: number;
  postponementPenalty: number;
  priority: number;
  userPreference: number;
  workloadPenalty: number;
};

export type AdaptiveThresholds = {
  highObservationCount: number;
  lowObservationCount: number;
  mediumObservationCount: number;
};

export type AdaptiveSchedulingPreferences = {
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
  preferredTimeByCategory: Partial<Record<AdaptiveActivityCategory, PreferredPeriod>>;
  sleepTime: string | null;
  scoreWeights: AdaptiveScoreWeights;
  thresholds: AdaptiveThresholds;
  timeZone: string;
  transitionMinutes: number;
  unavailablePeriods: UnavailablePeriod[];
  wakeTime: string | null;
};

export type AdaptiveSchedulingPattern = {
  activityCategory: AdaptiveActivityCategory;
  averageDurationMinutes: number;
  averageStartDelayMinutes: number;
  completionRate: number;
  confidenceLevel: AdaptiveConfidenceLevel;
  confidenceScore: number;
  dayOfWeek: number | null;
  observationCount: number;
  postponementRate: number;
  preferredEndHour: number;
  preferredStartHour: number;
  suggestionAcceptanceRate: number;
};

export type EngineScheduleItem = {
  category: AdaptiveActivityCategory;
  endMs: number;
  id: string;
  isDifficult: boolean;
  isFixed: boolean;
  kind?: "activity" | "schedule" | "suggestion";
  startMs: number;
  title?: string;
};

export type AdaptiveSlotRequest = {
  /** User explicitly asked for this clock window, so soft wake/sleep limits may be crossed. */
  allowOutsideAvailability?: boolean;
  category: AdaptiveActivityCategory;
  deadlineMs: number | null;
  durationMinutes: number;
  earliestStartMs: number;
  latestEndMs: number;
  patterns: AdaptiveSchedulingPattern[];
  preferences: AdaptiveSchedulingPreferences;
  priority: AdaptivePriority;
  requiredLocalDate?: string;
  requiredLocalTimeWindow?: PreferredPeriod;
  scheduleItems: EngineScheduleItem[];
  slotStepMinutes?: number;
};

export type AdaptiveSlotScoreBreakdown = {
  burnoutPenalty: number;
  categoryPreference: number;
  completionProbability: number;
  deadlineUrgency: number;
  postponementPenalty: number;
  priority: number;
  userPreference: number;
  workloadPenalty: number;
};

export type AdaptiveScoredSlot = {
  breakdown: AdaptiveSlotScoreBreakdown;
  endMs: number;
  expectedBenefit: string;
  startMs: number;
  totalScore: number;
};

export type PatternBehaviorObservation = {
  actualDurationMinutes: number | null;
  actualStartMs: number | null;
  category: AdaptiveActivityCategory;
  eventType: AdaptiveBehaviorEventType;
  originalStartMs: number | null;
  updatedStartMs: number | null;
};

export type AdaptiveScheduleValidationResult = {
  code?: "conflict" | "deadline" | "fixed" | "invalid_duration" | "locked" | "outside_availability" | "outside_requested_date" | "outside_requested_period" | "overload";
  message?: string;
  ok: boolean;
};
