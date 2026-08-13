/* eslint-disable react-hooks/set-state-in-effect */
import NativeDateTimePicker from '@expo/ui/community/datetime-picker';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  confirmLineTransaction,
  consumeSharedLineText,
  getLineConsent,
  getNativeLineListenerState,
  linePendingReviews,
  openLineNotificationAccessSettings,
  rejectLinePendingReview,
  requestLineListenerReconnect,
  setLineConsentTier,
  syncLineAutoImport,
  type ConfirmLineTransactionResult,
  type NativeLineListenerState,
} from '@/services/line-import-service';
import {
  parseLineImportBatch,
  type ParsedLineImportDraft,
} from '@/services/line-transaction-parser';
import type {
  ConsentTier,
  LineConsentProfile,
  PendingLineReview,
  TransactionSource,
  WithId,
} from '@/types/smartlife';
import {
  Card,
  MaterialIcon,
  UserShell,
  type UserNavigate,
} from './user-ui';

type Page = 'smartlife_line_import' | 'smartlife_line_pending' | 'smartlife_line_settings';
type Props = {onNavigate: UserNavigate; page: Page; uid: string};
type PickerTarget = 'date' | 'time' | null;

const C = {
  danger: '#c76562',
  ink: '#29351f',
  line: '#dfe5da',
  muted: '#7f887c',
  sage: '#62845f',
  sageSoft: '#e6eee2',
  violet: '#6673ad',
  violetSoft: '#edf0fa',
  warning: '#9a7934',
  warningSoft: '#f7f0d9',
};
const F = {
  b: 'Prompt_700Bold',
  m: 'Prompt_500Medium',
  r: 'Prompt_400Regular',
  s: 'Prompt_600SemiBold',
  x: 'Prompt_800ExtraBold',
};

const EMPTY_NATIVE_STATE: NativeLineListenerState = {
  enabled: false,
  lastConnectedAt: 0,
  lastNotificationAt: 0,
  permissionGranted: false,
  queueCount: 0,
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function firebaseLoadErrorText(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as {code?: unknown}).code)
    : '';
  const message = error instanceof Error ? error.message : String(error || '');
  if (code.includes('permission-denied') || /permission|insufficient/i.test(message)) {
    return 'Firebase ปฏิเสธสิทธิ์อ่านรายการ กรุณาตรวจว่าเข้าสู่ระบบบัญชีเดิม และ deploy firestore.rules ล่าสุดแล้ว';
  }
  if (code.includes('failed-precondition') || /index/i.test(message)) {
    return 'Firebase ต้องการ index สำหรับรายการรอตรวจ กรุณา deploy firestore.indexes.json ล่าสุดแล้วลองใหม่';
  }
  if (/timeout/i.test(message)) {
    return 'โหลดรายการจาก Firebase นานเกินไป กรุณาตรวจอินเทอร์เน็ตหรือกดโหลดใหม่';
  }
  return message || 'โหลดรายการจาก Firebase ไม่สำเร็จ กรุณาลองใหม่';
}

function normalizeLineConsent(
  consent: LineConsentProfile,
  nativeState: NativeLineListenerState,
): LineConsentProfile {
  if (Platform.OS === 'android' && nativeState.enabled) {
    return {
      ...consent,
      consentTier: 'line_auto_sync',
      lineListenerStatus: nativeState.permissionGranted ? 'active' : 'permission_revoked',
    };
  }
  return consent;
}

function thaiDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function thaiTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function confidenceCopy(confidence: number) {
  if (confidence >= 0.85) return {label: 'มั่นใจสูง', tone: C.sage};
  if (confidence >= 0.65) return {label: 'ควรตรวจอีกครั้ง', tone: C.warning};
  return {label: 'ต้องตรวจละเอียด', tone: C.danger};
}

function fromPending(item: WithId<PendingLineReview>): ParsedLineImportDraft {
  return {
    ...item.parsedDraft,
    fingerprint: item.fingerprint,
    rawText: item.rawText,
  };
}

function Header({
  onBack,
  subtitle,
  title,
}: {
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return <View style={styles.header}>
    <Pressable accessibilityLabel="ย้อนกลับ" onPress={onBack} style={styles.back}>
      <MaterialIcon name="arrow_back_ios_new" size={18} />
    </Pressable>
    <View style={{flex: 1}}>
      <Text style={styles.eyebrow}>SmartLife Finance</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  </View>;
}

function EditableDraftCard({
  actionLabel,
  draft: initialDraft,
  disabled = false,
  onConfirm,
  onReject,
}: {
  actionLabel: string;
  disabled?: boolean;
  draft: ParsedLineImportDraft;
  onConfirm: (draft: ParsedLineImportDraft) => Promise<void>;
  onReject?: () => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [picker, setPicker] = useState<PickerTarget>(null);
  const confidence = confidenceCopy(draft.confidence);
  const update = <K extends keyof ParsedLineImportDraft>(key: K, value: ParsedLineImportDraft[K]) => {
    setDraft((current) => ({...current, [key]: value}));
  };
  const chooseDateTime = (_event: unknown, selected?: Date) => {
    if (!selected) {
      setPicker(null);
      return;
    }
    const current = new Date(draft.occurredAt);
    const base = Number.isNaN(current.getTime()) ? new Date() : current;
    if (picker === 'date') {
      base.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    } else {
      base.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    }
    update('occurredAt', base.toISOString());
    setPicker(null);
  };

  return <Card style={styles.draftCard}>
    <View style={styles.draftHead}>
      <View style={[styles.iconBox, {backgroundColor: draft.type === 'income' ? C.sageSoft : '#fae8e3'}]}>
        <MaterialIcon color={draft.type === 'income' ? C.sage : C.danger} name={draft.type === 'income' ? 'south_west' : 'north_east'} size={21} />
      </View>
      <View style={{flex: 1}}>
        <Text style={styles.draftTitle}>{draft.merchant || 'ยังไม่พบชื่อรายการ'}</Text>
        <Text style={[styles.confidence, {color: confidence.tone}]}>{confidence.label} · {draft.parserMode === 'llm' ? 'AI ช่วยอ่าน' : 'กฎธนาคาร'}</Text>
      </View>
      <Text style={[styles.amountPreview, {color: draft.type === 'income' ? C.sage : C.danger}]}>
        {draft.type === 'income' ? '+' : '-'}฿{Number(draft.amount || 0).toLocaleString('th-TH')}
      </Text>
    </View>

    <Text style={styles.label}>เงินเข้า หรือ เงินออก</Text>
    <View style={styles.segmented}>
      {(['income', 'expense'] as const).map((type) => <Pressable key={type} onPress={() => update('type', type)} style={[styles.segment, draft.type === type && styles.segmentActive]}>
        <Text style={[styles.segmentText, draft.type === type && styles.segmentTextActive]}>{type === 'income' ? 'เงินเข้า' : 'เงินออก'}</Text>
      </Pressable>)}
    </View>

    <Text style={styles.label}>จำนวนเงิน</Text>
    <TextInput keyboardType="decimal-pad" onChangeText={(value) => update('amount', Number(value.replace(/,/g, '')) || 0)} placeholder="0.00" placeholderTextColor="#9aa39a" style={styles.input} value={draft.amount ? String(draft.amount) : ''} />
    <Text style={styles.label}>{draft.type === 'income' ? 'ผู้โอน / ที่มา' : 'ร้านค้า / ผู้รับ'}</Text>
    <TextInput onChangeText={(value) => update('merchant', value)} placeholder="ระบุชื่อที่ตรวจสอบแล้ว" placeholderTextColor="#9aa39a" style={styles.input} value={draft.merchant} />
    <Text style={styles.label}>หมวดหมู่</Text>
    <TextInput onChangeText={(value) => update('category', value)} placeholder="เช่น อาหาร, เดินทาง, รายได้" placeholderTextColor="#9aa39a" style={styles.input} value={draft.category} />
    <Text style={styles.label}>วันที่และเวลา</Text>
    <View style={styles.dateRow}>
      <Pressable onPress={() => setPicker('date')} style={styles.dateButton}>
        <MaterialIcon color={C.sage} name="calendar_month" size={18} />
        <Text style={styles.dateText}>{thaiDate(draft.occurredAt)}</Text>
      </Pressable>
      <Pressable onPress={() => setPicker('time')} style={styles.dateButton}>
        <MaterialIcon color={C.sage} name="schedule" size={18} />
        <Text style={styles.dateText}>{thaiTime(draft.occurredAt)}</Text>
      </Pressable>
    </View>
    {picker ? <NativeDateTimePicker
      accentColor={C.sage}
      is24Hour
      mode={picker}
      onDismiss={() => setPicker(null)}
      onValueChange={chooseDateTime}
      presentation="dialog"
      value={new Date(draft.occurredAt)}
    /> : null}
    <Text style={styles.label}>โน้ตของผู้ใช้</Text>
    <TextInput multiline onChangeText={(value) => update('note', value)} placeholder="เขียนว่าเงินนี้ได้มาจากอะไร หรือจ่ายค่าอะไร" placeholderTextColor="#9aa39a" style={[styles.input, styles.noteInput]} textAlignVertical="top" value={draft.note} />

    {draft.accountLast4 ? <Text style={styles.meta}>บัญชีลงท้าย ••••{draft.accountLast4} · ธนาคาร {draft.bank.toUpperCase()}</Text> : null}
    {draft.warnings.length ? <View style={styles.warningBox}>
      <MaterialIcon color={C.warning} name="warning" size={18} />
      <View style={{flex: 1}}>{draft.warnings.map((warning) => <Text key={warning} style={styles.warningText}>• {warning}</Text>)}</View>
    </View> : null}
    <View style={styles.actionRow}>
      {onReject ? <Pressable disabled={disabled} onPress={onReject} style={styles.rejectButton}><Text style={styles.rejectText}>ไม่ใช่รายการเงิน</Text></Pressable> : null}
      <Pressable
        disabled={disabled}
        onPress={() => {
          if (!draft.amount || !draft.merchant.trim()) {
            Alert.alert('ตรวจข้อมูลก่อน', 'กรุณาระบุจำนวนเงินและชื่อผู้โอน ร้านค้า หรือที่มาของเงิน');
            return;
          }
          onConfirm({...draft, needsReview: false}).catch(() => undefined);
        }}
        style={[styles.confirmButton, disabled && styles.disabled]}
      >
        {disabled ? <ActivityIndicator color="#fff" /> : <MaterialIcon color="#fff" name="check" size={18} />}
        <Text style={styles.confirmText}>{actionLabel}</Text>
      </Pressable>
    </View>
    <Text style={styles.confirmHint}>ระบบจะบันทึกลงการเงินจริงต่อเมื่อคุณกดปุ่มนี้เท่านั้น</Text>
  </Card>;
}

function duplicateAlert(
  result: ConfirmLineTransactionResult,
  rerun: (action: 'skip' | 'update_note') => Promise<void>,
) {
  if (!result.duplicate || result.skipped || result.updatedNote) return false;
  Alert.alert(
    'พบรายการนี้แล้ว',
    'ลายนิ้วมือข้อความตรงกับรายการเดิม เลือกข้าม หรืออัปเดตโน้ตของรายการเดิม',
    [
      {style: 'cancel', text: 'กลับไปตรวจ'},
      {onPress: () => rerun('skip').catch(() => undefined), text: 'ข้ามรายการ'},
      {onPress: () => rerun('update_note').catch(() => undefined), text: 'อัปเดตโน้ต'},
    ],
  );
  return true;
}

function ManualImport({onNavigate, uid}: {onNavigate: UserNavigate; uid: string}) {
  const [rawText, setRawText] = useState('');
  const [drafts, setDrafts] = useState<ParsedLineImportDraft[]>([]);
  const [source, setSource] = useState<TransactionSource>('line_paste');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [consent, setConsent] = useState<LineConsentProfile>({});
  const [nativeState, setNativeState] = useState(EMPTY_NATIVE_STATE);
  const autoReady = Platform.OS === 'android' && consent.consentTier === 'line_auto_sync' && nativeState.permissionGranted;

  const analyze = useCallback(async (text = rawText, nextSource: TransactionSource = source) => {
    if (!text.trim()) {
      Alert.alert('ยังไม่มีข้อความ', 'ช่องนี้เป็นทางเลือกสำรอง ใช้เมื่ออยากตรวจข้อความเองหรือแชร์จาก LINE เข้ามา');
      return;
    }
    setAnalyzing(true);
    try {
      const results = await parseLineImportBatch(text);
      setSource(nextSource);
      setDrafts(results);
      if (!results.length) {
        Alert.alert('ยังอ่านรายการไม่ได้', 'ไม่พบจำนวนเงินที่มีคำว่า บาท, THB หรือสัญลักษณ์ ฿ กรุณาตรวจข้อความแล้วลองใหม่');
      }
    } catch {
      Alert.alert('วิเคราะห์ไม่สำเร็จ', 'กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่ ระบบจะไม่บันทึกข้อมูลอัตโนมัติ');
    } finally {
      setAnalyzing(false);
    }
  }, [rawText, source]);

  const refreshImportState = useCallback(async () => {
    const [nextConsent, nextNative] = await Promise.all([
      getLineConsent(uid),
      getNativeLineListenerState(),
    ]);
    setConsent(normalizeLineConsent(nextConsent, nextNative));
    setNativeState(nextNative);
  }, [uid]);

  useEffect(() => {
    refreshImportState().catch(() => undefined);
  }, [refreshImportState]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    consumeSharedLineText().then((shared) => {
      if (!shared?.trim()) return;
      setRawText(shared);
      analyze(shared, 'line_share').catch(() => undefined);
    }).catch(() => undefined);
  }, [analyze]);

  const confirm = async (
    draft: ParsedLineImportDraft,
    duplicateAction?: 'skip' | 'update_note',
  ) => {
    setSaving(draft.fingerprint);
    try {
      const result = await confirmLineTransaction(draft, source, {duplicateAction});
      if (duplicateAlert(result, (action) => confirm(draft, action))) return;
      setDrafts((current) => current.filter((item) => item.fingerprint !== draft.fingerprint));
      Alert.alert(result.updatedNote ? 'อัปเดตโน้ตแล้ว' : result.skipped ? 'ข้ามรายการแล้ว' : 'บันทึกแล้ว', 'ข้อความดิบไม่ได้ถูกเก็บไว้ในรายการการเงิน');
    } catch (error) {
      Alert.alert('บันทึกไม่สำเร็จ', error instanceof Error ? error.message : 'กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSaving(null);
    }
  };

  return <UserShell active="smartlife_finance_day" onNavigate={onNavigate}>
    <Header onBack={() => onNavigate('smartlife_finance_day')} subtitle="ให้ระบบรับแจ้งเตือนธนาคารจาก LINE แล้วคุณแค่ตรวจยืนยัน" title="รับเงินจาก LINE" />
    <Card colors={['#f8fbf5', '#edf4e9']} style={styles.privacyCard}>
      <View style={styles.infoRow}><MaterialIcon color={C.sage} name="privacy_tip" size={22} /><View style={{flex: 1}}><Text style={styles.infoTitle}>ผู้ใช้ไม่ต้องสอนระบบเอง</Text><Text style={styles.infoText}>เปิดการเชื่อมต่อครั้งเดียว ระบบจะรับแจ้งเตือน LINE ธนาคารที่มีจำนวนเงิน แล้วสร้างรายการรอให้ตรวจ ไม่บันทึกเงินจริงจนกว่าคุณยืนยัน</Text></View></View>
    </Card>

    <Card colors={autoReady ? ['#edf6e9', '#f7fbf4'] : ['#eef1fa', '#f8f9ff']} style={styles.autoImportCard}>
      <View style={styles.statusHead}>
        <View style={styles.statusIcon}>
          <MaterialIcon color={autoReady ? C.sage : C.violet} name={autoReady ? 'notifications_active' : 'notification_add'} size={25} />
        </View>
        <View style={{flex: 1}}>
          <Text style={styles.infoTitle}>{autoReady ? 'ระบบพร้อมรับจาก LINE แล้ว' : 'เปิดรับจาก LINE แบบอัตโนมัติ'}</Text>
          <Text style={styles.infoText}>{autoReady ? `มีคิวในเครื่อง ${nativeState.queueCount} รายการ รายการที่มั่นใจสูงจะบันทึกเข้าการเงินอัตโนมัติ ส่วนที่ไม่ชัดจะส่งให้ตรวจ` : 'Android ต้องให้สิทธิ์ Notification Access หนึ่งครั้ง หลังจากนั้นผู้ใช้ไม่ต้องคัดลอกข้อความเอง'}</Text>
        </View>
      </View>
      <Pressable onPress={() => onNavigate(autoReady ? 'smartlife_line_pending' : 'smartlife_line_settings')} style={styles.autoButton}>
        <MaterialIcon color="#fff" name={autoReady ? 'fact_check' : 'settings'} size={18} />
        <Text style={styles.analyzeText}>{autoReady ? 'ดูรายการที่ระบบรับมา' : 'ตั้งค่าการรับจาก LINE'}</Text>
      </Pressable>
    </Card>

    <Text style={styles.label}>ทางเลือกสำรอง: วางข้อความเองเมื่อจำเป็น</Text>
    <TextInput
      multiline
      onChangeText={setRawText}
      placeholder={'ใช้กรณีระบบยังไม่ได้รับแจ้งเตือน เช่น แชร์ข้อความจาก LINE เข้ามา หรือวางข้อความธนาคารเพื่อตรวจรายการเฉพาะครั้ง'}
      placeholderTextColor="#9aa39a"
      style={[styles.input, styles.rawInput]}
      textAlignVertical="top"
      value={rawText}
    />
    <Pressable disabled={analyzing} onPress={() => analyze()} style={[styles.analyzeButton, analyzing && styles.disabled]}>
      {analyzing ? <ActivityIndicator color="#fff" /> : <MaterialIcon color="#fff" name="manage_search" size={20} />}
      <Text style={styles.analyzeText}>{analyzing ? 'กำลังแยกรายการ...' : 'วิเคราะห์ข้อความสำรอง'}</Text>
    </Pressable>
    <View style={styles.quickLinks}>
      <Pressable onPress={() => onNavigate('smartlife_line_pending')} style={styles.quickLink}><MaterialIcon color={C.violet} name="fact_check" size={19} /><Text style={styles.quickLinkText}>รายการรอตรวจ</Text></Pressable>
      <Pressable onPress={() => onNavigate('smartlife_line_settings')} style={styles.quickLink}><MaterialIcon color={C.violet} name="settings" size={19} /><Text style={styles.quickLinkText}>ตั้งค่าการเชื่อมต่อ</Text></Pressable>
    </View>
    {drafts.map((draft) => <EditableDraftCard actionLabel="ยืนยันและบันทึก" disabled={saving === draft.fingerprint} draft={draft} key={draft.fingerprint} onConfirm={confirm} />)}
  </UserShell>;
}

function PendingReview({onNavigate, uid}: {onNavigate: UserNavigate; uid: string}) {
  const [items, setItems] = useState<WithId<PendingLineReview>[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const autoSaving = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    let initialLoaded = false;
    setLoading(true);
    setLoadError(null);
    const timeout = setTimeout(() => {
      if (!active || initialLoaded) return;
      initialLoaded = true;
      setLoading(false);
      setLoadError('โหลดรายการจาก Firebase นานเกินไป กรุณาตรวจอินเทอร์เน็ตหรือกดโหลดใหม่');
    }, 8_000);
    syncLineAutoImport(uid).catch((error) => {
      console.warn('[LINE Import] Sync before pending review failed', error);
    });
    withTimeout(linePendingReviews.list(uid), 5_000, 'Firebase list timeout').then((value) => {
      if (!active) return;
      initialLoaded = true;
      clearTimeout(timeout);
      setItems(value);
      setLoadError(null);
      setLoading(false);
    }).catch((error) => {
      if (!active || initialLoaded) return;
      console.warn('[LINE Import] Pending review one-shot load failed', error);
      initialLoaded = true;
      clearTimeout(timeout);
      setLoadError(firebaseLoadErrorText(error));
      setLoading(false);
    });
    const unsubscribe = linePendingReviews.watch(uid, (value) => {
      if (!active) return;
      initialLoaded = true;
      clearTimeout(timeout);
      setItems(value);
      setLoadError(null);
      setLoading(false);
    }, (error) => {
      if (!active) return;
      initialLoaded = true;
      clearTimeout(timeout);
      console.warn('[LINE Import] Pending review watch failed', error);
      setLoadError(firebaseLoadErrorText(error));
      setLoading(false);
    });
    return () => {
      active = false;
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [reloadKey, uid]);

  useEffect(() => {
    for (const item of items) {
      if (autoSaving.current.has(item.id)) continue;
      const draft = fromPending(item);
      const canAutoSave = draft.confidence >= 0.85 &&
        draft.needsReview === false &&
        draft.warnings.length === 0 &&
        draft.amount > 0 &&
        draft.merchant.trim().length > 0;
      if (!canAutoSave) continue;
      autoSaving.current.add(item.id);
      confirmLineTransaction(draft, 'line_auto_listener', {draftId: item.id})
        .catch((error) => {
          autoSaving.current.delete(item.id);
          console.warn('[LINE Import] Auto-confirm pending item failed', error);
        });
    }
  }, [items]);

  const confirm = async (
    item: WithId<PendingLineReview>,
    draft: ParsedLineImportDraft,
    duplicateAction?: 'skip' | 'update_note',
  ) => {
    setSaving(item.id);
    try {
      const result = await confirmLineTransaction(draft, 'line_auto_listener', {
        draftId: item.id,
        duplicateAction,
      });
      if (duplicateAlert(result, (action) => confirm(item, draft, action))) return;
      Alert.alert(result.updatedNote ? 'อัปเดตโน้ตแล้ว' : result.skipped ? 'ข้ามรายการแล้ว' : 'บันทึกแล้ว', 'ข้อความดิบถูกลบทันทีหลังยืนยัน');
    } catch (error) {
      Alert.alert('บันทึกไม่สำเร็จ', error instanceof Error ? error.message : 'กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSaving(null);
    }
  };

  const reject = (item: WithId<PendingLineReview>) => Alert.alert(
    'ลบรายการรอตรวจ?',
    'ข้อความดิบของรายการนี้จะถูกลบและไม่บันทึกเป็นธุรกรรม',
    [
      {style: 'cancel', text: 'ยกเลิก'},
      {onPress: () => rejectLinePendingReview(item.id).catch(() => Alert.alert('ลบไม่สำเร็จ', 'กรุณาลองใหม่')), style: 'destructive', text: 'ลบทิ้ง'},
    ],
  );

  return <UserShell active="smartlife_finance_day" onNavigate={onNavigate}>
    <Header onBack={() => onNavigate('smartlife_line_import')} subtitle="เฉพาะรายการที่ระบบยังไม่มั่นใจเท่านั้น รายการมั่นใจสูงจะลงการเงินจริงอัตโนมัติ" title="รายการที่ต้องตรวจ" />
    <Card colors={['#eef1fa', '#f7f8fd']} style={styles.privacyCard}>
      <View style={styles.infoRow}><MaterialIcon color={C.violet} name="verified_user" size={22} /><View style={{flex: 1}}><Text style={styles.infoTitle}>เก็บชั่วคราวไม่เกิน 7 วัน</Text><Text style={styles.infoText}>ยืนยันแล้วข้อความดิบจะถูกลบทันที หากไม่ทำอะไรระบบจะลบอัตโนมัติเมื่อครบกำหนด</Text></View></View>
    </Card>
    {loading ? <View style={styles.loading}><ActivityIndicator color={C.sage} /><Text style={styles.infoText}>กำลังโหลดรายการจาก Firebase...</Text></View> : null}
    {!loading && loadError ? <Card colors={['#fff5f3', '#fffaf8']} style={styles.emptyCard}>
      <MaterialIcon color={C.danger} name="cloud_off" size={34} />
      <Text style={styles.emptyTitle}>โหลดรายการไม่สำเร็จ</Text>
      <Text style={styles.infoText}>{loadError}</Text>
      <Pressable onPress={() => setReloadKey((value) => value + 1)} style={styles.retryButton}>
        <MaterialIcon color="#fff" name="refresh" size={17} />
        <Text style={styles.retryText}>ลองโหลดใหม่</Text>
      </Pressable>
    </Card> : null}
    {!loading && !loadError && !items.length ? <Card style={styles.emptyCard}><MaterialIcon color={C.sage} name="task_alt" size={34} /><Text style={styles.emptyTitle}>ไม่มีรายการที่ต้องตรวจ</Text><Text style={styles.infoText}>ถ้าระบบมั่นใจสูง รายการจาก LINE จะถูกบันทึกเข้าหน้าการเงินทันที</Text></Card> : null}
    {items.map((item) => <EditableDraftCard
      actionLabel="ยืนยันลงการเงิน"
      disabled={saving === item.id}
      draft={fromPending(item)}
      key={item.id}
      onConfirm={(draft) => confirm(item, draft)}
      onReject={() => reject(item)}
    />)}
  </UserShell>;
}

function ListenerSettings({onNavigate, uid}: {onNavigate: UserNavigate; uid: string}) {
  const [consent, setConsent] = useState<LineConsentProfile>({});
  const [nativeState, setNativeState] = useState(EMPTY_NATIVE_STATE);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const isAuto = consent.consentTier === 'line_auto_sync';
  const isReady = Platform.OS === 'android' && isAuto && nativeState.permissionGranted;

  const refresh = useCallback(async () => {
    const [nextConsent, nextNative] = await Promise.all([
      getLineConsent(uid),
      getNativeLineListenerState(),
    ]);
    setConsent(normalizeLineConsent(nextConsent, nextNative));
    setNativeState(nextNative);
    setLoading(false);
  }, [uid]);
  useEffect(() => { refresh().catch(() => setLoading(false)); }, [refresh]);

  const reconnectAndSync = useCallback(async (showError = false) => {
    try {
      await requestLineListenerReconnect();
      await syncLineAutoImport(uid);
    } catch (error) {
      if (showError) {
        Alert.alert(
          'ยังเชื่อมต่อไม่สำเร็จ',
          error instanceof Error ? error.message : 'กรุณาตรวจสิทธิ์ Android แล้วลองอีกครั้ง',
        );
      }
    } finally {
      await refresh().catch(() => undefined);
    }
  }, [refresh, uid]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !isAuto) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconnectAndSync(false);
    });
    return () => subscription.remove();
  }, [isAuto, reconnectAndSync]);

  const changeTier = async (tier: ConsentTier) => {
    setWorking(true);
    try {
      const result = await setLineConsentTier(uid, tier);
      const nextNative = await getNativeLineListenerState();
      setNativeState(nextNative);
      setConsent((current) => ({...current, consentTier: result.tier, lineListenerStatus: result.lineListenerStatus}));
      if (!result.backendMissing) await refresh();
      else {
        Alert.alert(
          'ตั้งค่าในเครื่องแล้ว',
          'ส่วนเชื่อมต่อระบบออนไลน์ยังไม่พร้อม กรุณาลองอีกครั้งภายหลัง',
        );
      }
    } catch (error) {
      Alert.alert('เปลี่ยนการตั้งค่าไม่สำเร็จ', error instanceof Error ? error.message : 'กรุณาลองใหม่');
    } finally {
      setWorking(false);
    }
  };

  const enableAuto = () => Alert.alert(
    'เปิดรับรายการการเงินอัตโนมัติ?',
    'SmartLife จะอ่านเฉพาะแจ้งเตือนการเงินใหม่จาก LINE และแอปธนาคารที่รองรับ รายการที่ข้อมูลครบจะบันทึกให้อัตโนมัติ ส่วนรายการที่ไม่ชัดเจนจะรอให้คุณตรวจสอบ',
    [
      {style: 'cancel', text: 'ยังไม่เปิด'},
      {
        onPress: () => changeTier('line_auto_sync')
          .then(() => openLineNotificationAccessSettings())
          .catch(() => Alert.alert('เปิดหน้าตั้งค่าไม่สำเร็จ', 'กรุณาลองใหม่อีกครั้ง')),
        text: 'ยินยอมและเปิดสิทธิ์',
      },
    ],
  );

  const disableAuto = () => Alert.alert(
    'ปิดอ่านแจ้งเตือนอัตโนมัติ?',
    'ระบบจะหยุดรับรายการใหม่และล้างคิวที่ยังอยู่ในเครื่อง ส่วนร่างใน Firebase จะยังให้ตรวจได้จนหมดอายุ 7 วัน',
    [
      {style: 'cancel', text: 'ยกเลิก'},
      {onPress: () => changeTier('manual_only'), style: 'destructive', text: 'ปิดการทำงาน'},
    ],
  );

  const status = useMemo(() => {
    if (Platform.OS !== 'android') return {label: 'โหมดอัตโนมัติรองรับ Android เท่านั้น', tone: C.muted};
    if (!isAuto) return {label: 'ยังไม่ได้เปิดการทำงานอัตโนมัติ', tone: C.muted};
    if (!nativeState.permissionGranted) return {label: 'เหลือเปิดสิทธิ์ Android เพียงครั้งเดียว', tone: C.warning};
    return {label: 'พร้อมรับรายการอัตโนมัติ', tone: C.sage};
  }, [isAuto, nativeState.permissionGranted]);

  return <UserShell active="smartlife_profile" onNavigate={onNavigate}>
    <Header onBack={() => onNavigate('smartlife_profile')} subtitle="คุณควบคุมสิทธิ์และการเก็บข้อมูลได้ตลอดเวลา" title="LINE การเงิน" />
    {loading ? <View style={styles.loading}><ActivityIndicator color={C.sage} /></View> : <>
      <Card colors={['#f7fbf4', '#edf4e9']} style={styles.statusCard}>
        <View style={styles.statusHead}><View style={styles.statusIcon}><MaterialIcon color={status.tone} name={isAuto ? 'notifications_active' : 'content_paste'} size={25} /></View><View style={{flex: 1}}><Text style={styles.infoTitle}>สถานะปัจจุบัน</Text><Text style={[styles.statusText, {color: status.tone}]}>{status.label}</Text></View></View>
        {Platform.OS === 'android' && isAuto ? <Text style={styles.infoText}>คิวในเครื่อง {nativeState.queueCount} รายการ · สิทธิ์ระบบ {nativeState.permissionGranted ? 'เปิดแล้ว' : 'ยังไม่เปิด'}</Text> : null}
      </Card>

      {Platform.OS === 'android' && !isReady ? <Card colors={['#f4f7ff', '#eef3fb']} style={styles.permissionCard}>
        <View style={styles.infoRow}>
          <View style={[styles.tierIcon, {backgroundColor: '#fff'}]}><MaterialIcon color={C.violet} name="notification_add" size={22} /></View>
          <View style={{flex: 1}}><Text style={styles.infoTitle}>เปิดครั้งเดียว แล้วใช้งานได้ต่อเนื่อง</Text><Text style={styles.infoText}>กดปุ่มด้านล่าง เปิดสวิตช์ SmartLife ในหน้า Android แล้วกลับเข้าแอป ระบบจะเชื่อมต่อและตรวจรายการให้เอง</Text></View>
        </View>
        <Pressable disabled={working} onPress={enableAuto} style={[styles.secondaryButton, working && styles.disabled]}>
          {working ? <ActivityIndicator color="#fff" /> : <Text style={styles.secondaryText}>{isAuto ? 'ไปเปิดสิทธิ์ Android' : 'เปิดใช้งานอัตโนมัติ'}</Text>}
        </Pressable>
      </Card> : null}

      {isReady ? <Card colors={['#eff8ec', '#e7f2e4']} style={styles.permissionCard}>
        <View style={styles.infoRow}><MaterialIcon color={C.sage} name="verified" size={25} /><View style={{flex: 1}}><Text style={styles.infoTitle}>ตั้งค่าเรียบร้อยแล้ว</Text><Text style={styles.infoText}>จากนี้แค่ให้ LINE หรือแอปธนาคารส่งแจ้งเตือน ระบบจะตรวจและนำเข้ารายการให้อัตโนมัติ</Text></View></View>
      </Card> : null}

      {Platform.OS === 'android' ? <>
        <Pressable onPress={() => setShowTroubleshooting((value) => !value)} style={styles.helpToggle}>
          <MaterialIcon color={C.violet} name="help_outline" size={18} />
          <Text style={styles.helpToggleText}>มีปัญหาในการเชื่อมต่อ?</Text>
          <MaterialIcon color={C.violet} name={showTroubleshooting ? 'expand_less' : 'expand_more'} size={20} />
        </Pressable>
        {showTroubleshooting ? <Card style={styles.permissionCard}>
          <Text style={styles.infoTitle}>ช่วยแก้ปัญหา</Text>
          <Text style={styles.infoText}>ใช้ส่วนนี้เมื่อแจ้งเตือนเข้ามาแล้วแต่รายการไม่ปรากฏใน SmartLife</Text>
          <Pressable disabled={working} onPress={() => openLineNotificationAccessSettings().catch(() => undefined)} style={styles.secondaryButton}><Text style={styles.secondaryText}>ตรวจสิทธิ์ Android</Text></Pressable>
          <Pressable disabled={working} onPress={() => reconnectAndSync(true)} style={styles.smallButton}><Text style={styles.smallButtonText}>ลองเชื่อมต่อและตรวจรายการใหม่</Text></Pressable>
          {isAuto ? <Pressable disabled={working} onPress={disableAuto} style={styles.disableLink}><Text style={styles.disableLinkText}>ปิดการทำงานอัตโนมัติ</Text></Pressable> : null}
        </Card> : null}
      </> : null}

      <Card colors={['#fffaf4', '#f8f2e8']} style={styles.privacyCard}>
        <Text style={styles.infoTitle}>ความเป็นส่วนตัวและข้อจำกัด</Text>
        <Text style={styles.infoText}>• กรอง package ให้เหลือเฉพาะ LINE และแอปธนาคารที่รองรับก่อนอ่านข้อความแจ้งเตือน{'\n'}• ไม่อ่านประวัติแชต รูป หรือข้อมูลในแอปธนาคารโดยตรง{'\n'}• ถ้า LINE ซ่อนข้อความ ตัวระบบจะอ่านจำนวนเงินไม่ได้{'\n'}• รายการข้อมูลครบจะบันทึกอัตโนมัติ รายการไม่ชัดเจนเท่านั้นที่ต้องตรวจ{'\n'}• AI fallback รับเฉพาะข้อความที่ปิดเลขบัญชีแล้ว</Text>
      </Card>
      <Pressable onPress={() => onNavigate('smartlife_line_import')} style={styles.analyzeButton}><MaterialIcon color="#fff" name="add_card" size={20} /><Text style={styles.analyzeText}>ไปหน้านำเข้ารายการ</Text></Pressable>
    </>}
  </UserShell>;
}

export default function LineImportScreen({onNavigate, page, uid}: Props) {
  if (page === 'smartlife_line_pending') return <PendingReview onNavigate={onNavigate} uid={uid} />;
  if (page === 'smartlife_line_settings') return <ListenerSettings onNavigate={onNavigate} uid={uid} />;
  return <ManualImport onNavigate={onNavigate} uid={uid} />;
}

const shadow = {
  shadowColor: C.ink,
  shadowOffset: {height: 8, width: 0},
  shadowOpacity: 0.07,
  shadowRadius: 16,
};
const styles = StyleSheet.create({
  actionRow: {flexDirection: 'row', gap: 8, marginTop: 14},
  amountPreview: {fontFamily: F.x, fontSize: 15},
  analyzeButton: {...shadow, alignItems: 'center', backgroundColor: C.sage, borderRadius: 14, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 12, minHeight: 50},
  analyzeText: {color: '#fff', fontFamily: F.b, fontSize: 13},
  autoButton: {alignItems: 'center', backgroundColor: C.sage, borderRadius: 12, flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: 12, minHeight: 46},
  autoImportCard: {marginTop: 10, padding: 14},
  back: {...shadow, alignItems: 'center', backgroundColor: '#fff', borderRadius: 15, height: 46, justifyContent: 'center', width: 46},
  confidence: {fontFamily: F.s, fontSize: 9, marginTop: 2},
  confirmButton: {alignItems: 'center', backgroundColor: C.sage, borderRadius: 12, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 46},
  confirmHint: {color: C.muted, fontFamily: F.r, fontSize: 8, marginTop: 8, textAlign: 'center'},
  confirmText: {color: '#fff', fontFamily: F.b, fontSize: 11},
  dateButton: {alignItems: 'center', backgroundColor: '#f6f8f4', borderColor: C.line, borderRadius: 12, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 7, minHeight: 48, paddingHorizontal: 11},
  dateRow: {flexDirection: 'row', gap: 8},
  dateText: {color: C.ink, fontFamily: F.s, fontSize: 10},
  disabled: {opacity: 0.55},
  disableLink: {alignItems: 'center', justifyContent: 'center', marginTop: 12, minHeight: 34},
  disableLinkText: {color: C.danger, fontFamily: F.s, fontSize: 9},
  draftCard: {padding: 14},
  draftHead: {alignItems: 'center', flexDirection: 'row', gap: 9},
  draftTitle: {color: C.ink, fontFamily: F.b, fontSize: 13},
  emptyCard: {alignItems: 'center', gap: 4, paddingVertical: 30},
  emptyTitle: {color: C.ink, fontFamily: F.b, fontSize: 14},
  eyebrow: {color: C.sage, fontFamily: F.b, fontSize: 9},
  header: {alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 5},
  helpToggle: {alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: 5, marginTop: 12, paddingHorizontal: 12, paddingVertical: 8},
  helpToggleText: {color: C.violet, fontFamily: F.s, fontSize: 9},
  iconBox: {alignItems: 'center', borderRadius: 13, height: 42, justifyContent: 'center', width: 42},
  infoRow: {alignItems: 'center', flexDirection: 'row', gap: 10},
  infoText: {color: C.muted, fontFamily: F.r, fontSize: 10, lineHeight: 17, marginTop: 2},
  infoTitle: {color: C.ink, fontFamily: F.b, fontSize: 12},
  input: {backgroundColor: '#f8faf6', borderColor: C.line, borderRadius: 12, borderWidth: 1, color: C.ink, fontFamily: F.r, fontSize: 11, minHeight: 48, paddingHorizontal: 12},
  label: {color: '#53604f', fontFamily: F.s, fontSize: 10, marginBottom: 6, marginTop: 12},
  loading: {alignItems: 'center', gap: 8, paddingVertical: 30},
  meta: {color: C.muted, fontFamily: F.m, fontSize: 9, marginTop: 10},
  noteInput: {minHeight: 76, paddingTop: 10},
  permissionCard: {padding: 14},
  privacyCard: {padding: 14},
  quickLink: {alignItems: 'center', backgroundColor: C.violetSoft, borderRadius: 12, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 44},
  quickLinkText: {color: C.violet, fontFamily: F.b, fontSize: 9},
  quickLinks: {flexDirection: 'row', gap: 8, marginTop: 9},
  rawInput: {minHeight: 150, paddingTop: 12},
  rejectButton: {alignItems: 'center', backgroundColor: '#faece8', borderRadius: 12, justifyContent: 'center', minHeight: 46, paddingHorizontal: 12},
  rejectText: {color: C.danger, fontFamily: F.b, fontSize: 9},
  retryButton: {alignItems: 'center', backgroundColor: C.sage, borderRadius: 12, flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 12, minHeight: 42, paddingHorizontal: 16},
  retryText: {color: '#fff', fontFamily: F.b, fontSize: 10},
  secondaryButton: {alignItems: 'center', backgroundColor: C.violet, borderRadius: 12, justifyContent: 'center', marginTop: 12, minHeight: 44},
  secondaryText: {color: '#fff', fontFamily: F.b, fontSize: 10},
  sectionTitle: {color: C.ink, fontFamily: F.x, fontSize: 16, marginTop: 18},
  segment: {alignItems: 'center', borderRadius: 9, flex: 1, paddingVertical: 8},
  segmentActive: {backgroundColor: C.sage},
  segmented: {backgroundColor: C.sageSoft, borderRadius: 12, flexDirection: 'row', padding: 4},
  segmentText: {color: C.sage, fontFamily: F.b, fontSize: 10},
  segmentTextActive: {color: '#fff'},
  smallActionRow: {flexDirection: 'row', gap: 8, marginTop: 8},
  smallButton: {alignItems: 'center', backgroundColor: C.violetSoft, borderRadius: 10, justifyContent: 'center', marginTop: 8, minHeight: 40},
  smallButtonText: {color: C.violet, fontFamily: F.b, fontSize: 9},
  statusCard: {padding: 14},
  statusHead: {alignItems: 'center', flexDirection: 'row', gap: 10},
  statusIcon: {alignItems: 'center', backgroundColor: '#fff', borderRadius: 15, height: 46, justifyContent: 'center', width: 46},
  statusText: {fontFamily: F.b, fontSize: 11, marginTop: 2},
  subtitle: {color: C.muted, fontFamily: F.r, fontSize: 9, marginTop: 1},
  tierActive: {borderColor: C.sage, borderWidth: 1.5},
  tierCard: {...shadow, alignItems: 'center', backgroundColor: '#fff', borderColor: C.line, borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 10, marginTop: 9, padding: 12},
  tierIcon: {alignItems: 'center', backgroundColor: C.sageSoft, borderRadius: 13, height: 42, justifyContent: 'center', width: 42},
  tierText: {color: C.muted, fontFamily: F.r, fontSize: 9, lineHeight: 14, marginTop: 1},
  tierTitle: {color: C.ink, fontFamily: F.b, fontSize: 11},
  title: {color: C.ink, fontFamily: F.x, fontSize: 21},
  warningBox: {backgroundColor: C.warningSoft, borderRadius: 11, flexDirection: 'row', gap: 7, marginTop: 10, padding: 9},
  warningText: {color: '#76622f', fontFamily: F.r, fontSize: 8, lineHeight: 13},
});
