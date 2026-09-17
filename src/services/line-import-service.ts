import {doc, getDoc} from 'firebase/firestore';
import {getFunctions, httpsCallable} from 'firebase/functions';
import {Platform} from 'react-native';

// Avoid evaluating Expo's native push-token auto-registration side effect on web.
const Notifications: typeof import('expo-notifications') = Platform.OS === 'web' ? {} as typeof import('expo-notifications') : require('expo-notifications');


import {db, firebaseApp} from '@/lib/firebase';
import {pendingReviews} from '@/services/firestore';
import {
  isPotentialFinancialLineMessage,
  parseLineImportMessage,
  type ParsedLineImportDraft,
} from '@/services/line-transaction-parser';
import type {
  ConsentTier,
  LineConsentProfile,
  LineListenerStatus,
  PendingLineReview,
  TransactionSource,
  WithId,
} from '@/types/smartlife';

type NativeLineNotification = {
  capturedAt: number;
  id: string;
  sourcePackage?: string;
  text: string;
  title: string;
};

export type NativeLineListenerState = {
  enabled: boolean;
  lastConnectedAt: number;
  lastNotificationAt: number;
  permissionGranted: boolean;
  queueCount: number;
};

type NativeLineListenerModule = {
  acknowledgeNotificationsAsync(ids: string[]): Promise<void>;
  addListener(
    eventName: 'onLineNotification',
    listener: (event: {capturedAt: number; queueCount: number; text: string; title: string}) => void,
  ): {remove(): void};
  clearCapturedNotificationsAsync(): Promise<void>;
  consumeSharedTextAsync(): Promise<string | null>;
  getQueuedNotificationsAsync(userId: string): Promise<NativeLineNotification[]>;
  getStateAsync(): Promise<NativeLineListenerState>;
  openNotificationAccessSettingsAsync(): Promise<void>;
  requestRebindAsync(): Promise<void>;
  setListenerEnabledAsync(enabled: boolean, userId: string): Promise<void>;
};

const BANK_PACKAGE_HINTS: Record<string, string> = {
  'com.kasikorn.retail.mbanking.wap': 'K PLUS',
  'com.kasikornbank.kplus': 'K PLUS',
  'com.scb.phone': 'SCB',
  'ktbcs.netbank': 'Krungthai',
  'com.ktb.customer.qr': 'Krungthai',
  'com.bbl.mobilebanking': 'Bangkok Bank',
  'com.krungsri.kma': 'Krungsri',
  'com.ttbbank.ttbtouch': 'ttb',
  'com.tmbbank.tmbtouch': 'ttb',
};

function addBankHintFromSourcePackage(rawText: string, sourcePackage?: string) {
  const hint = sourcePackage ? BANK_PACKAGE_HINTS[sourcePackage] : '';
  if (!hint) return rawText;
  if (/\b(?:KBank|K\s*PLUS|SCB|Krungthai|Bangkok\s*Bank|Krungsri|ttb|BBL|KTB)\b|กสิกร|กรุงไทย|กรุงศรี|กรุงเทพ|ไทยพาณิชย์/i.test(rawText)) {
    return rawText;
  }
  return `${hint}\n${rawText}`;
}

type ConfirmInput = {
  accountLast4: string | null;
  amount: number;
  balanceAfterReported: number | null;
  bank: string;
  category: string;
  confidence: number;
  draftId?: string;
  duplicateAction?: 'skip' | 'update_note';
  fingerprint: string;
  merchant: string;
  needsReview: boolean;
  note: string;
  occurredAt: string;
  source: TransactionSource;
  type: 'expense' | 'income';
};

export type ConfirmLineTransactionResult = {
  duplicate?: boolean;
  existingNote?: string;
  existingTransactionId?: string;
  saved?: boolean;
  skipped?: boolean;
  transactionId?: string;
  updatedNote?: boolean;
};

const functions = getFunctions(firebaseApp, 'asia-southeast1');
const updateConsentCall = httpsCallable<
  {method: 'onboarding' | 'settings'; tier: ConsentTier},
  {lineListenerStatus: LineListenerStatus; tier: ConsentTier}
>(functions, 'updateLineConsent');
const reportListenerStatusCall = httpsCallable<
  {status: LineListenerStatus},
  {status: LineListenerStatus}
>(functions, 'reportLineListenerStatus');
const enqueuePendingReviewCall = httpsCallable<
  {
    capturedAt: string;
    fingerprint: string;
    parsedDraft: Omit<ParsedLineImportDraft, 'fingerprint' | 'rawText'>;
    rawText: string;
    source?: 'bank_auto_listener' | 'line_auto_listener';
  },
  {autoSaved?: boolean; created: boolean; draftId: string; transactionId?: string}
>(functions, 'enqueueLinePendingReview');
const confirmLineTransactionCall = httpsCallable<
  ConfirmInput,
  ConfirmLineTransactionResult
>(functions, 'confirmLineTransaction');
const rejectPendingReviewCall = httpsCallable<
  {draftId: string},
  {deleted: boolean}
>(functions, 'rejectLinePendingReview');

export type LineConsentUpdateResult = {
  backendMissing?: boolean;
  lineListenerStatus: LineListenerStatus;
  tier: ConsentTier;
};

let nativeModulePromise: Promise<NativeLineListenerModule | null> | null = null;
let currentSync: Promise<number> | null = null;

function firebaseErrorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}

function firebaseErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '';
}

function isFirebaseError(error: unknown, codePart: string) {
  return firebaseErrorCode(error).includes(codePart) || firebaseErrorMessage(error).includes(codePart);
}

async function nativeLineModule() {
  if (Platform.OS !== 'android') return null;
  if (!nativeModulePromise) {
    nativeModulePromise = import('../../modules/smartlife-line-listener')
      .then((module) => module.default as NativeLineListenerModule)
      .catch(() => null);
  }
  return nativeModulePromise;
}

export async function getLineConsent(uid: string) {
  const snapshot = await getDoc(doc(db, 'users', uid));
  const data = snapshot.exists() ? snapshot.data() as LineConsentProfile : {};
  return {
    consentHistory: data.consentHistory ?? [],
    consentTier: data.consentTier ?? 'manual_only' as ConsentTier,
    lineConsentUpdatedAt: data.lineConsentUpdatedAt ?? null,
    lineConsentVersion: data.lineConsentVersion ?? 1,
    lineListenerStatus: data.lineListenerStatus ?? 'not_applicable' as LineListenerStatus,
  };
}

export async function setLineConsentTier(uid: string, tier: ConsentTier): Promise<LineConsentUpdateResult> {
  const native = await nativeLineModule();
  if (native) {
    await native.setListenerEnabledAsync(tier === 'line_auto_sync', uid);
  }
  try {
    const result = await updateConsentCall({method: 'settings', tier});
    return result.data as LineConsentUpdateResult;
  } catch (error) {
    if (isFirebaseError(error, 'not-found')) {
      const state = await getNativeLineListenerState();
      return {
        backendMissing: true,
        lineListenerStatus: tier === 'line_auto_sync' && state.permissionGranted ? 'active' : 'not_applicable',
        tier,
      };
    }
    throw error;
  }
}

export async function getNativeLineListenerState(): Promise<NativeLineListenerState> {
  const native = await nativeLineModule();
  if (!native) {
    return {
      enabled: false,
      lastConnectedAt: 0,
      lastNotificationAt: 0,
      permissionGranted: false,
      queueCount: 0,
    };
  }
  return native.getStateAsync();
}

export async function openLineNotificationAccessSettings() {
  const native = await nativeLineModule();
  if (!native) throw new Error('ระบบอ่านแจ้งเตือน LINE ใช้ได้เฉพาะ Android');
  await native.openNotificationAccessSettingsAsync();
}

export async function requestLineListenerReconnect() {
  const native = await nativeLineModule();
  if (!native) return;
  await native.requestRebindAsync();
}

export async function consumeSharedLineText() {
  const native = await nativeLineModule();
  return native?.consumeSharedTextAsync() ?? null;
}

export async function disableNativeLineListener() {
  const native = await nativeLineModule();
  if (!native) return;
  await native.setListenerEnabledAsync(false, '');
}

export async function subscribeToNativeLineNotifications(onNotification: () => void) {
  const native = await nativeLineModule();
  return native?.addListener('onLineNotification', onNotification) ?? null;
}

export const linePendingReviews = {
  list: (uid: string): Promise<WithId<PendingLineReview>[]> => pendingReviews.list(uid),
  watch: pendingReviews.watch,
};

export async function enqueueLinePendingReview(draft: ParsedLineImportDraft, capturedAt: Date) {
  const {fingerprint, rawText, ...parsedDraft} = draft;
  const result = await enqueuePendingReviewCall({
    capturedAt: capturedAt.toISOString(),
    fingerprint,
    parsedDraft,
    rawText: rawText.slice(0, 12_000),
    source: 'line_auto_listener',
  });
  return result.data;
}

export async function enqueueAutoBankReview(
  draft: ParsedLineImportDraft,
  capturedAt: Date,
  source: 'bank_auto_listener' | 'line_auto_listener',
) {
  const {fingerprint, rawText, ...parsedDraft} = draft;
  const result = await enqueuePendingReviewCall({
    capturedAt: capturedAt.toISOString(),
    fingerprint,
    parsedDraft,
    rawText: rawText.slice(0, 12_000),
    source,
  });
  return result.data;
}

export async function confirmLineTransaction(
  draft: ParsedLineImportDraft,
  source: TransactionSource,
  options: {draftId?: string; duplicateAction?: 'skip' | 'update_note'} = {},
) {
  const input: ConfirmInput = {
    accountLast4: draft.accountLast4,
    amount: draft.amount,
    balanceAfterReported: draft.balanceAfterReported,
    bank: draft.bank,
    category: draft.category,
    confidence: draft.confidence,
    fingerprint: draft.fingerprint,
    merchant: draft.merchant,
    needsReview: draft.needsReview,
    note: draft.note,
    occurredAt: draft.occurredAt,
    source,
    type: draft.type,
  };
  if (options.draftId) input.draftId = options.draftId;
  if (options.duplicateAction) input.duplicateAction = options.duplicateAction;
  const result = await confirmLineTransactionCall(input);
  return result.data;
}

export async function rejectLinePendingReview(draftId: string) {
  return (await rejectPendingReviewCall({draftId})).data;
}

async function reportListenerStatus(current: LineListenerStatus, desired: LineListenerStatus) {
  if (current === desired) return;
  try {
    await reportListenerStatusCall({status: desired});
  } catch (error) {
    if (isFirebaseError(error, 'not-found')) return;
    throw error;
  }
}

async function ensureBackendAutoConsent(consent: LineConsentProfile) {
  if (consent.consentTier === 'line_auto_sync') return consent;
  try {
    const result = await updateConsentCall({method: 'settings', tier: 'line_auto_sync'});
    return {
      ...consent,
      consentTier: result.data.tier,
      lineListenerStatus: result.data.lineListenerStatus,
    };
  } catch (error) {
    console.warn('[LineImport] Backend consent sync failed', {
      code: firebaseErrorCode(error),
      message: firebaseErrorMessage(error),
    });
    return consent;
  }
}

async function notifyPendingReviews(count: number) {
  if (Platform.OS === 'web' || count <= 0) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      body: 'แตะเพื่อตรวจสอบและยืนยันก่อนบันทึกลงการเงินจริง',
      data: {url: '/user/smartlife_line_pending'},
      title: `พร้อมตรวจสอบรายการจากแจ้งเตือน ${count} รายการ`,
    },
    trigger: null,
  });
}

async function notifyAutoSavedTransactions(count: number) {
  if (Platform.OS === 'web' || count <= 0) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      body: 'ระบบเพิ่มรายการจากแจ้งเตือนการเงินแล้ว แตะเพื่อดูและเพิ่มโน้ตได้',
      data: {url: '/user/smartlife_finance_day'},
      title: `บันทึกการเงินจากแจ้งเตือนแล้ว ${count} รายการ`,
    },
    trigger: null,
  });
}

async function performLineAutoImportSync(uid: string) {
  const native = await nativeLineModule();
  if (!native) return 0;
  const consent = await getLineConsent(uid);
  const state = await native.getStateAsync();
  const isEnabled = consent.consentTier === 'line_auto_sync' || state.enabled;
  await native.setListenerEnabledAsync(isEnabled, uid);
  if (!isEnabled) {
    await reportListenerStatus(consent.lineListenerStatus, 'not_applicable');
    return 0;
  }

  if (!state.permissionGranted) {
    await reportListenerStatus(consent.lineListenerStatus, 'permission_revoked');
    return 0;
  }
  const activeConsent = state.enabled ? await ensureBackendAutoConsent(consent) : consent;
  await reportListenerStatus(activeConsent.lineListenerStatus ?? consent.lineListenerStatus ?? 'permission_revoked', 'active');

  const queued = await native.getQueuedNotificationsAsync(uid);
  let autoSavedCount = 0;
  let pendingCount = 0;
  // Each notification is an independent write keyed on its own fingerprint,
  // so a burst from a busy few minutes no longer pays one network round-trip
  // per item in sequence -- they all go out together.
  await Promise.all(queued.map(async (item) => {
    const rawText = addBankHintFromSourcePackage(
      [item.title, item.text].filter(Boolean).join('\n').trim(),
      item.sourcePackage,
    );
    if (!rawText || !isPotentialFinancialLineMessage(rawText)) {
      await native.acknowledgeNotificationsAsync([item.id]);
      return;
    }
    try {
      const capturedAt = new Date(item.capturedAt);
      const safeCapturedAt = Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt;
      const draft = await parseLineImportMessage(
        rawText,
        safeCapturedAt,
      );
      if (!draft) {
        await native.acknowledgeNotificationsAsync([item.id]);
        return;
      }
      let result;
      const source = item.sourcePackage && item.sourcePackage !== 'jp.naver.line.android'
        ? 'bank_auto_listener'
        : 'line_auto_listener';
      try {
        result = await enqueueAutoBankReview(draft, safeCapturedAt, source);
      } catch (error) {
        if (!isFirebaseError(error, 'permission-denied')) throw error;
        await ensureBackendAutoConsent(activeConsent);
        result = await enqueueAutoBankReview(draft, safeCapturedAt, source);
      }
      if (result.created && result.autoSaved) autoSavedCount += 1;
      else if (result.created) pendingCount += 1;
      await native.acknowledgeNotificationsAsync([item.id]);
    } catch (error) {
      console.warn('[LineImport] Queue sync item failed', {
        code: firebaseErrorCode(error),
        id: item.id,
        message: firebaseErrorMessage(error),
      });
      // Keep the encrypted native item in the queue so a temporary network
      // failure cannot silently lose a transaction candidate.
    }
  }));
  if (autoSavedCount > 0) {
    await notifyAutoSavedTransactions(autoSavedCount).catch(() => undefined);
  }
  if (pendingCount > 0) {
    await notifyPendingReviews(pendingCount).catch(() => undefined);
  }
  return autoSavedCount + pendingCount;
}

export function syncLineAutoImport(uid: string) {
  if (currentSync) return currentSync;
  currentSync = performLineAutoImportSync(uid).finally(() => {
    currentSync = null;
  });
  return currentSync;
}
