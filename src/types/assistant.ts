export type AssistantEntity = 'checklist' | 'finance' | 'memory' | 'note' | 'schedule';
export type AssistantMutation = 'create' | 'delete' | 'update';
export type ProposedActionStatus = 'confirmed' | 'pending' | 'rejected';
export type AssistantReplySource = 'deterministic' | 'fallback' | 'gemini';
export type AssistantErrorKind =
  | 'app_check'
  | 'authentication'
  | 'config'
  | 'firebase'
  | 'gemini'
  | 'invalid_data'
  | 'missing_input'
  | 'network'
  | 'permission'
  | 'quota'
  | 'server'
  | 'unsupported'
  | 'unknown';
export type AssistantFeedbackRating = 'helpful' | 'not_helpful';
export type AssistantPendingTaskShortcut = {
  dueAt?: string;
  id: string;
  status: 'completed' | 'pending';
  title: string;
};
export type AssistantResponseMode =
  | 'brainstorm'
  | 'coach'
  | 'compare'
  | 'direct'
  | 'explain'
  | 'plan'
  | 'summarize';

export type AssistantFinancialScenario = {
  dailyBudget?: number;
  days?: number;
  foodBudget?: number;
  mealCount?: number;
  months?: number;
  savingsAmount?: number;
  startingAmount?: number;
  targetAmount?: number;
  type: 'budget' | 'savings_goal';
};

export type AssistantSelectedTask = {
  dueAt?: string;
  id?: string;
  title: string;
};

export type AssistantConversationState = {
  conversationId: string;
  dateReference?: 'month' | 'today' | 'tomorrow' | 'week';
  financialScenario?: AssistantFinancialScenario;
  lastIntent?: 'finance' | 'schedule' | 'task_note' | 'unknown';
  selectedTask?: AssistantSelectedTask;
  updatedAt: string;
  version: 1;
};

export type AssistantConversationStatePatch = Partial<Pick<
  AssistantConversationState,
  'dateReference' | 'financialScenario' | 'lastIntent' | 'selectedTask'
>>;

export type SchedulePayload = {
  aiReason?: string;
  aiScheduled?: boolean;
  allowOverlap?: boolean;
  allowAiReschedule?: boolean;
  category?: string;
  dateLocked?: boolean;
  deadline?: string | null;
  endAt?: string;
  estimatedDurationMinutes?: number;
  generatedForTimeZone?: string;
  isFlexible?: boolean;
  location?: string;
  reminderMinutesBefore?: number;
  startAt: string;
  title: string;
  type: 'appointment' | 'class' | 'task';
  userSelectedTime?: boolean;
};

export type FinancePayload = {
  amount: number;
  category: string;
  date: string;
  note?: string;
  type: 'expense' | 'income';
};

export type NotePayload = {
  body: string;
  linkedScheduleId?: string;
  tag: 'all' | 'class' | 'idea' | 'task';
  title: string;
};

export type ChecklistPayload = {
  items: string[];
  startAt: string;
  title: string;
};

export type AssistantMemoryPayload = {
  key: 'dailyBudget' | 'studyMinutes';
  value: number;
};

export type AssistantProposedAction =
  | {
      entity: 'checklist';
      id: string;
      payload: ChecklistPayload;
      status: ProposedActionStatus;
      summary: string;
      type: 'create';
    }
  | {
      entity: 'memory';
      id: string;
      payload: AssistantMemoryPayload;
      status: ProposedActionStatus;
      summary: string;
      type: 'create';
    }
  | {
      entity: 'schedule';
      id: string;
      payload: SchedulePayload;
      status: ProposedActionStatus;
      summary: string;
      type: 'create';
    }
  | {
      entity: 'finance';
      id: string;
      payload: FinancePayload;
      status: ProposedActionStatus;
      summary: string;
      type: 'create';
    }
  | {
      entity: 'note';
      id: string;
      payload: NotePayload;
      status: ProposedActionStatus;
      summary: string;
      type: 'create';
    };

export type AssistantChatMessage = {
  content: string;
  errorKind?: AssistantErrorKind;
  feedback?: AssistantFeedbackRating;
  id: string;
  intent?: 'finance' | 'schedule' | 'task_note' | 'unknown';
  latencyMs?: number;
  pendingTaskShortcuts?: AssistantPendingTaskShortcut[];
  proposedAction?: AssistantProposedAction;
  role: 'assistant' | 'system' | 'user';
  source?: AssistantReplySource;
  suggestions?: string[];
  timestamp: string;
};

export type AssistantToolName =
  | 'add_event'
  | 'add_note'
  | 'add_transaction'
  | 'delete_schedule_item'
  | 'get_financial_summary'
  | 'get_pending_tasks'
  | 'get_user_notes'
  | 'get_user_schedule'
  | 'get_wellbeing_summary'
  | 'save_preference'
  | 'update_note'
  | 'update_schedule_item';

export type AssistantToolSchema = {
  description: string;
  mutates: boolean;
  name: AssistantToolName;
  parameters: Record<string, unknown>;
};
