import type { Timestamp } from 'firebase/firestore';

export type ActivityStatus = 'planned' | 'in-progress' | 'completed' | 'cancelled';
export type ActivityType = 'activity' | 'task' | 'appointment';
export type NoteCategory = 'study' | 'work' | 'idea' | 'personal';
export type ScanKind = 'schedule' | 'receipt';
export type ScanStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type TransactionType = 'income' | 'expense';
export type TransactionSource = 'bank_auto_listener' | 'line_auto_listener' | 'line_paste' | 'line_share' | 'manual_entry' | 'receipt_scan';
export type ConsentTier = 'line_auto_sync' | 'manual_only';
export type LineListenerStatus = 'active' | 'not_applicable' | 'permission_revoked';

export type OwnedDocument = {
  createdAt: Timestamp;
  ownerId: string;
  updatedAt: Timestamp;
};

export type Schedule = OwnedDocument & {
  color: string;
  courseCode: string;
  courseName?: string;
  endAt: Timestamp;
  googleCalendarId?: string;
  googleEventId?: string;
  location: string;
  seriesId?: string;
  source: 'manual' | 'ocr' | 'google-calendar' | 'university';
  startAt: Timestamp;
  title: string;
};

export type Activity = OwnedDocument & {
  actualDurationMinutes?: number | null;
  actualEnd?: Timestamp | null;
  actualStart?: Timestamp | null;
  aiConfidence?: number | null;
  aiReason?: string | null;
  aiScheduled?: boolean;
  allowAiReschedule?: boolean;
  attendees?: string;
  category?: string;
  color: string;
  deadline?: Timestamp | null;
  endAt: Timestamp;
  estimatedDurationMinutes?: number;
  fixedLocalDate?: string;
  googleCalendarId?: string;
  googleEventId?: string;
  googleSyncStatus?: 'failed' | 'not_required' | 'pending' | 'synced';
  isFlexible?: boolean;
  isLocked?: boolean;
  location: string;
  note?: string;
  originalScheduledStart?: Timestamp | null;
  priority?: string;
  reminder?: string;
  scheduleVersion?: number;
  source: 'manual' | 'ai';
  startAt: Timestamp;
  status: ActivityStatus;
  title: string;
  type: ActivityType;
  userSelectedTime?: boolean;
};

export type Note = OwnedDocument & {
  /** How `content` is encoded. Absent means the original plain text. */
  bodyFormat?: 'plain' | 'html';
  category: NoteCategory;
  color: string;
  completedAt?: Timestamp | null;
  content: string;
  /** Storage paths of drawings attached to this note, never image bytes. */
  drawingPaths?: string[];
  /** Owning folder, or '' for none. Folders live in `noteFolders`. */
  folderId?: string;
  linkedNoteIds?: string[];
  /** Marks the note as PIN-protected. The PIN lives in settings/noteLock. */
  locked?: boolean;
  pinned?: boolean;
  priority?: 'normal' | 'important' | 'urgent';
  relatedScheduleId: string;
  /** Set when the note was created from an OCR scan. */
  scanLogId?: string;
  status?: 'pending' | 'completed';
  tags?: string[];
  title: string;
};

export type NoteFolder = OwnedDocument & {
  color?: string;
  icon?: string;
  name: string;
  sortOrder?: number;
};

/** The per-user note PIN. Only ever a salted digest, never the PIN itself. */
export type NoteLock = OwnedDocument & {
  biometricEnabled?: boolean;
  hash: string;
  hint?: string;
  salt: string;
};

export type Transaction = OwnedDocument & {
  accountLast4?: string | null;
  amount: number;
  balanceAfterReported?: number | null;
  bank?: string;
  category: string;
  confirmationMethod?: 'auto_verified_line_notification' | 'explicit_user_confirm';
  confidence?: number;
  dedupeKeys?: string[];
  fingerprint?: string;
  items?: {
    discountAmount: number;
    finalPrice: number;
    name: string;
    quantity: number;
    unitPrice: number | null;
  }[];
  merchant: string;
  note: string;
  occurredAt: Timestamp;
  rawTextRetained?: boolean;
  receiptPath: string;
  reviewedByUser?: boolean;
  reviewedAt?: Timestamp;
  scanId?: string;
  source?: TransactionSource;
  status?: 'verified' | 'needs_review';
  type: TransactionType;
};

export type PendingLineReview = OwnedDocument & {
  capturedAt: Timestamp;
  dedupeKeys?: string[];
  expiresAt: Timestamp;
  fingerprint: string;
  parsedDraft: {
    accountLast4: string | null;
    amount: number;
    balanceAfterReported: number | null;
    bank: 'bbl' | 'gsb' | 'kbank' | 'krungsri' | 'ktb' | 'scb' | 'ttb' | 'unknown';
    category: string;
    confidence: number;
    merchant: string;
    needsReview: boolean;
    note: string;
    occurredAt: string;
    parserMode: 'generic' | 'llm' | 'regex';
    type: TransactionType;
    warnings: string[];
  };
  rawText: string;
  source: 'bank_auto_listener' | 'line_auto_listener';
  status: 'pending';
};

export type LineConsentProfile = {
  consentHistory?: {
    changedAt: Timestamp;
    method: 'onboarding' | 'settings';
    tier: ConsentTier;
  }[];
  consentTier?: ConsentTier;
  lineConsentUpdatedAt?: Timestamp | null;
  lineConsentVersion?: number;
  lineListenerStatus?: LineListenerStatus;
};

export type ScanLog = OwnedDocument & {
  characterCount?: number;
  classification?: {
    confidence?: number;
    scores?: {receipt?: number; schedule?: number};
    type?: ScanKind;
  };
  confidence?: number;
  correctedAt?: Timestamp;
  correctedByUser?: boolean;
  correctedParsed?: Record<string, unknown>;
  correctedTransactionId?: string;
  errorMessage: string;
  extractedText: string;
  imagePath: string;
  sourceImageHash?: string;
  kind: ScanKind;
  needsReview?: boolean;
  ocrConfidence?: number;
  parsed?: Record<string, unknown>;
  processed?: Record<string, unknown>;
  provider?: 'iapp' | 'iapp-document' | 'google-vision' | 'google-vision-fallback';
  providerConfidence?: Record<string, unknown>;
  providerError?: string;
  rawAiResult?: Record<string, unknown>;
  rawOcr?: string;
  rawProviderResult?: Record<string, unknown>;
  reviewReasons?: string[];
  status: ScanStatus;
  verificationStatus?: 'verified' | 'needs_review';
};

export type Notification = OwnedDocument & {
  kind: 'urgent' | 'ai' | 'finance' | 'schedule' | 'system';
  message: string;
  read: boolean;
  title: string;
};

export type AiRecommendation = OwnedDocument & {
  action: Record<string, unknown>;
  contextSources: ('schedule' | 'note' | 'finance' | 'behavior')[];
  explanation: string;
  kind: 'priority' | 'schedule' | 'burnout' | 'finance' | 'note';
  status: 'new' | 'accepted' | 'dismissed';
  title: string;
};

export type Feedback = OwnedDocument & {
  message: string;
  status: 'new';
  type: 'ai' | 'schedule-scan' | 'expense-category' | 'other';
};

export type WithId<T> = T & { id: string };

export type Category = {
  active: boolean;
  color: string;
  createdAt: Timestamp;
  domain: 'note' | 'expense' | 'activity';
  icon: string;
  labelEn: string;
  labelTh: string;
  sortOrder: number;
  updatedAt: Timestamp;
};

export type Announcement = {
  active: boolean;
  createdAt: Timestamp;
  createdBy: string;
  endAt: Timestamp;
  kind: 'update' | 'maintenance' | 'feature' | 'urgent';
  message: string;
  startAt: Timestamp;
  title: string;
  updatedAt: Timestamp;
};

export type SystemStatus = {
  checkedAt: Timestamp;
  detail: string;
  latencyMs: number;
  name: string;
  status: 'operational' | 'degraded' | 'outage';
};
