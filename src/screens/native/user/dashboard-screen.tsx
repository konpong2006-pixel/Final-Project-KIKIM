/* eslint-disable react-hooks/set-state-in-effect */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';
import {ResponsiveSafeArea} from '@/components/layout/responsive-safe-area';
import AiActivityRecommendationCard from '@/components/ai-activity-recommendation-card';
import SleepLogCard from '@/components/sleep-log-card';
import {SpendingDonut} from '@/components/spending-charts';
import {LinearGradient} from 'expo-linear-gradient';
import {Timestamp} from 'firebase/firestore';

import {loadLegacyPageData, runLegacyDataAction} from '@/services/legacy-data';
import {calculateDailyAllowance, type DailyAllowance} from '@/services/dynamic-insights';
import {loadMonthlyBudget} from '@/services/monthly-budget';
import {buildNotificationFeed, isRankable, itemsOf as items, millis, priorityReasons, priorityScore, string, unreadCount, type FeedItem} from '@/services/notification-feed';
import {activities as activitiesStore, notes as notesStore} from '@/services/firestore';
import {recordTaskCompleted} from '@/services/behavior-tracking';
import {aggregateSpending, type SpendingTransactionInput} from '@/services/spending-analytics';
import {updateAndroidHomeWidget} from '@/services/android-home-widget';
import {MaterialIcon, UserGradientBackdrop, UserTabBar} from './user-ui';
import {showToast} from '@/components/app-toast';

/**
 * Page data arrives already serialised to ISO strings, so the slot times the
 * adaptive engine learns from have to be parsed back rather than read as
 * Firestore timestamps.
 */
function dateOf(value: unknown) {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type Props = {onNavigate: (page: string) => void; uid: string};
type Item = Record<string, unknown>;

const colors = {pine: '#2c341b', sage: '#6f8f6d', sageDark: '#5f835f', sageSoft: '#dfe7dc', mist: '#f4f5ef', paper: '#ffffff', muted: '#8b9085', finance: '#9297bb', financeSoft: '#eceef7', note: '#bb9293', noteSoft: '#f3e8e8'};
const showDevTools = __DEV__ || process.env.EXPO_PUBLIC_SMARTLIFE_SHOW_DEV_TOOLS === 'true';

function time(value: unknown) { const date = new Date(String(value ?? '')); return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('th-TH', {hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'}).format(date); }
function money(value: number) { return `฿${value.toLocaleString('th-TH')}`; }
function dayKey(date: Date) { return new Intl.DateTimeFormat('en-CA', {day: '2-digit', month: '2-digit', timeZone: 'Asia/Bangkok', year: 'numeric'}).format(date); }
function shortDateLabel(date: Date) { return new Intl.DateTimeFormat('th-TH', {timeZone: 'Asia/Bangkok', weekday: 'short'}).format(date); }
function dayNumber(date: Date) { return new Intl.DateTimeFormat('th-TH', {day: 'numeric', timeZone: 'Asia/Bangkok'}).format(date); }

function SoftPress({children, onPress, style}: {children: React.ReactNode; onPress: () => void; style?: object}) {
  return <Pressable onPress={onPress} style={({pressed}) => [style, pressed && styles.pressed]}>{children}</Pressable>;
}

function StatCard({icon, value, label, tint = colors.sageSoft}: {icon: string; value: string | number; label: string; tint?: string}) {
  return <View style={styles.statCard}><View style={[styles.statIcon, {backgroundColor: tint}]}><MaterialIcon color={colors.sageDark} name={icon} size={18} /></View><Text adjustsFontSizeToFit minimumFontScale={.7} numberOfLines={1} style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

export default function DashboardScreen({onNavigate, uid}: Props) {
  const [data, setData] = useState<Item | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [completingId, setCompletingId] = useState('');
  const [allowance, setAllowance] = useState<DailyAllowance | null>(null);
  const [budgetAmount, setBudgetAmount] = useState(0);
  const [monthTransactions, setMonthTransactions] = useState<{amount: number; occurredAt: never; type: 'expense' | 'income'}[]>([]);
  const [weekTransactions, setWeekTransactions] = useState<SpendingTransactionInput[]>([]);
  // `user/index` is a one-day window, so its transactions cannot answer what is
  // left of the monthly limit. The month's spending and the saved limit are
  // fetched alongside it, and neither failing may stop the dashboard loading.
  const load = useCallback(async () => {
    const [pageData, monthData, weekData, savedBudget] = await Promise.all([
      loadLegacyPageData(uid, 'user/index') as Promise<Item>,
      (loadLegacyPageData(uid, 'user/smartlife_finance_month') as Promise<{transactions?: unknown}>)
        .catch((error) => { console.error('[Dashboard] Month transactions load failed', error); return null; }),
      (loadLegacyPageData(uid, 'user/smartlife_finance_week') as Promise<{transactions?: unknown}>)
        .catch((error) => { console.error('[Dashboard] Week transactions load failed', error); return null; }),
      loadMonthlyBudget(uid).catch((error) => { console.error('[Dashboard] Saved budget load failed', error); return null; }),
    ]);
    const monthly = savedBudget?.amount ?? 0;
    const spending = items(monthData?.transactions).map((item) => ({
      amount: Number(item.amount ?? 0),
      occurredAt: item.occurredAt as never,
      type: item.type === 'income' ? 'income' as const : 'expense' as const,
    }));
    setWeekTransactions(items(weekData?.transactions).map((item) => ({
      amount: item.amount,
      category: string(item, 'category', 'อื่น ๆ'),
      occurredAt: item.occurredAt,
      type: item.type,
    })));
    setBudgetAmount(monthly);
    setMonthTransactions(spending);
    setAllowance(calculateDailyAllowance({monthlyBudget: monthly, transactions: spending}));
    setData(pageData);
  }, [uid]);
  useEffect(() => { load().catch(() => setData({})); }, [load]);
  const refresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);
  const seedAiDynamicData = useCallback(async () => {
    setSeeding(true);
    try {
      const result = await runLegacyDataAction(uid, 'user/index', {action: 'seed-ai-dynamic-test-data'});
      await load();
      const summary = result && typeof result === 'object' ? Object.entries(result).map(([key, value]) => `${key}: ${value}`).join('\n') : '';
      showToast('เพิ่มข้อมูลสำเร็จ', summary || 'เพิ่มข้อมูลทดสอบเรียบร้อยแล้ว', 'success');
    } catch (error) {
      showToast('เพิ่มข้อมูลไม่สำเร็จ', error instanceof Error ? error.message : 'ลองใหม่อีกครั้ง');
    } finally {
      setSeeding(false);
    }
  }, [load, uid]);

  const profile = (data?.profile ?? {}) as Item;
  const schedules = useMemo(() => items(data?.schedules).sort((a, b) => new Date(String(a.startAt)).getTime() - new Date(String(b.startAt)).getTime()), [data]);
  const activities = useMemo(() => items(data?.activities), [data]);
  const notes = useMemo(() => items(data?.notes), [data]);
  const transactions = useMemo(() => items(data?.transactions), [data]);
  const weeklySpending = useMemo(() => aggregateSpending(weekTransactions, 'week'), [weekTransactions]);
  const notifications = useMemo(() => items(data?.notifications), [data]);
  // The badge counts what is true right now: derived alerts while their
  // condition holds, plus stored notifications that are genuinely unread. It
  // reads from the same feed the notification list renders, so the number on
  // the bell and the rows behind it can never disagree.
  const feed = useMemo<FeedItem[]>(() => buildNotificationFeed({
    activities: data?.activities,
    monthlyBudget: budgetAmount,
    monthTransactions,
    notes: data?.notes,
    stored: notifications as never,
    todayExpenses: items(data?.transactions).filter((item) => item.type === 'expense').map((item) => ({amount: Number(item.amount ?? 0)})),
  }), [budgetAmount, data, monthTransactions, notifications]);
  const workNotes = useMemo(() => notes.filter((item) => item.status !== 'completed' && /งาน|task|assignment|homework/i.test(string(item, 'category', ''))), [notes]);
  // `pending` drives the priority card, the focus tile and the "งานที่ต้องทำ"
  // count, so a sleep log has to be filtered out here too -- otherwise a logged
  // night is ranked as an overdue to-do with a "เสร็จ" button on it.
  const pending = useMemo(() => [
    ...activities.filter((item) => item.status !== 'completed' && isRankable(item)).map((item): Item => ({...item, __entity: 'activity'})),
    ...workNotes.map((item): Item => ({...item, __entity: 'note'})),
  ], [activities, workNotes]);
  // Both budget surfaces read from the same allowance, so the tile and the
  // assistant's instant answer can never quote different numbers.
  const allowanceValue = allowance ? money(allowance.amount) : '—';
  const allowanceAnswer = !allowance ? 'ตั้งงบเดือนนี้ก่อน'
    : allowance.overBudget ? `เกินงบแล้ว ${money(Math.abs(allowance.remainingBudget))}`
    : `ตอบทันที: วันนี้ใช้ได้อีก ${money(allowance.amount)}`;
  // The card headlines the same allowance as the tile above it -- it used to
  // show a day's income minus expenses, which sat at ฿0 next to a tile saying
  // ฿392. The bar behind it is the share of the month's limit still unspent,
  // rather than the old balance-over-income ratio that measured nothing.
  const monthBudgetLeftPercent = allowance && allowance.monthlyBudget > 0
    ? Math.min(100, Math.max(0, allowance.remainingBudget / allowance.monthlyBudget * 100))
    : 0;
  const unread = unreadCount(feed);
  const urgent = useMemo(() => [...pending].sort((a, b) => priorityScore(b) - priorityScore(a) || millis(a) - millis(b)).slice(0, 2), [pending]);
  useEffect(() => {
    if (!data) return;
    const now = new Date();
    const today = dayKey(now);
    const nextSchedule = schedules.find((item) => dayKey(new Date(String(item.startAt ?? ''))) === today && new Date(String(item.startAt ?? '')).getTime() >= now.getTime()) ?? schedules[0];
    const topTask = urgent[0] ?? pending[0];
    const headline = nextSchedule ? string(nextSchedule, 'title', 'SmartLife วันนี้') : 'SmartLife วันนี้';
    const subheadline = nextSchedule ? `${time(nextSchedule.startAt)} · ${string(nextSchedule, 'location', string(nextSchedule, 'courseCode', 'ตารางวันนี้'))}` : 'ไม่มีตารางเรียนที่กำลังจะถึง';
    const focusTitle = topTask ? `โฟกัส: ${string(topTask, 'title')}` : 'วันนี้ยังไม่มีงานที่ต้องโฟกัส';
    const budgetLabel = allowance ? `งบวันนี้ ${allowanceValue}` : 'งบวันนี้ยังไม่ได้ตั้ง';
    const updatedAtLabel = `อัปเดต ${time(now.toISOString())}`;
    updateAndroidHomeWidget({
      budgetLabel,
      dateLabel: shortDateLabel(now),
      dayNumber: dayNumber(now),
      focusTitle,
      headline,
      subheadline,
      updatedAtLabel,
    }).catch((error) => console.warn('[Dashboard] Android widget sync failed', error));
  }, [allowance, allowanceValue, data, pending, schedules, urgent]);
  const markComplete = useCallback(async (item: Item) => {
    const id = string(item, 'id', '');
    const entity = string(item, '__entity', 'activity');
    if (!id || completingId) return;
    setCompletingId(id);
    const key = entity === 'note' ? 'notes' : 'activities';
    setData((current) => current ? {...current, [key]: items(current[key]).map((entry) => string(entry, 'id', '') === id ? {...entry, completedAt: new Date().toISOString(), status: 'completed'} : entry)} : current);
    try {
      if (entity === 'note') await notesStore.update(uid, id, {completedAt: Timestamp.fromDate(new Date()), status: 'completed'});
      else {
        await activitiesStore.update(uid, id, {status: 'completed'});
        // Only activities live in the adaptive engine's schedule; notes have no
        // slot for it to learn a preferred hour from.
        void recordTaskCompleted(id, {scheduledEndAt: dateOf(item.endAt), scheduledStartAt: dateOf(item.startAt)});
      }
    } catch (error) {
      await load().catch(() => undefined);
      showToast('อัปเดตงานไม่สำเร็จ', error instanceof Error ? error.message : 'ลองใหม่อีกครั้ง');
    } finally {
      setCompletingId('');
    }
  }, [completingId, load, uid]);

  return <ResponsiveSafeArea style={styles.safe}><View style={styles.screen}><UserGradientBackdrop />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.sage} />} showsVerticalScrollIndicator={false}>
      <View style={styles.topRow}>
        <SoftPress onPress={() => onNavigate('smartlife_profile')} style={styles.profileRow}><View style={styles.avatar}><View style={styles.avatarGlow} /><Text style={styles.avatarText}>{string(profile, 'displayName', 'SL').slice(0, 2).toUpperCase()}</Text></View><View style={styles.greeting}><Text numberOfLines={1} style={styles.hello}>สวัสดีตอนเช้า</Text><Text ellipsizeMode="tail" numberOfLines={1} style={styles.name}>{string(profile, 'displayName', 'เพื่อน')}</Text></View></SoftPress>
        <SoftPress onPress={() => onNavigate('smartlife_notifications')} style={styles.bell}><MaterialIcon name="notifications" size={24} />{unread > 0 ? <View style={styles.unread}><Text style={styles.unreadText}>{unread > 9 ? '9+' : unread}</Text></View> : null}</SoftPress>
      </View>

      {!data ? <View style={styles.loading}><ActivityIndicator color={colors.sage} size="large" /><Text style={styles.muted}>กำลังโหลดข้อมูลจาก Firebase</Text></View> : <>
        <SoftPress onPress={() => onNavigate('smartlife_ai_assistant')} style={styles.aiCard}><LinearGradient colors={['#769674', '#8fa69a', '#a8b7aa']} end={{x: 1, y: 1}} start={{x: 0, y: 0}} style={StyleSheet.absoluteFill} />
          <View style={styles.aiTop}><View style={styles.aiHeading}><MaterialIcon color="#fff" name="smart_toy" size={21} /><Text style={styles.aiTitle}>AI Assistant</Text></View><View style={styles.mic}><MaterialIcon name="mic" size={21} /></View></View>
          <View style={styles.prompt}><Text numberOfLines={1} style={styles.promptText}>“วันนี้ฉันมีเรียนกี่โมง?”</Text><MaterialIcon color="#fff" name="chevron_right" size={22} /></View>
          <View style={styles.quickAnswer}><Text style={styles.quickQuestion}>“เหลือเงินกินข้าวเท่าไหร่?”</Text><Text style={styles.quickValue}>{allowanceAnswer}</Text></View>
        </SoftPress>
        <View style={{marginBottom: 15}}><AiActivityRecommendationCard onNavigate={onNavigate} uid={uid} /></View>
        <SleepLogCard onLogged={() => { void load(); }} uid={uid} variant="log" />

        {showDevTools && pending.length === 0 && transactions.length === 0 ? <Pressable disabled={seeding} onPress={seedAiDynamicData} style={({pressed}) => [styles.seedCard, pressed && styles.pressed, seeding && {opacity: .6}]}><View style={styles.seedIcon}><MaterialIcon color={colors.sageDark} name="database" size={20} /></View><View style={{flex: 1}}><Text style={styles.seedTitle}>เติมข้อมูลทดสอบ AI Dynamic</Text><Text style={styles.seedSub}>เพิ่มตาราง งาน โน้ต และการเงินเข้า Firebase ของบัญชีนี้</Text></View><Text style={styles.seedAction}>{seeding ? 'กำลังเพิ่ม...' : 'เพิ่มเลย'}</Text></Pressable> : null}

        <View style={[styles.priorityCard, {overflow: 'hidden'}]}><LinearGradient colors={['rgba(255,255,255,.98)', '#eef4ea']} end={{x: 1, y: 1}} start={{x: 0, y: 0}} style={StyleSheet.absoluteFill} />
          <View style={styles.priorityHeader}><View style={styles.priorityTitleRow}><MaterialIcon color={colors.sageDark} name="auto_awesome" size={18} /><Text style={styles.priorityTitle}>AI จัดลำดับวันนี้</Text></View><View style={styles.dynamicBadge}><Text style={styles.dynamicText}>Dynamic</Text></View></View>
          <Text style={styles.priorityCaption}>ระบบดันสอบและงานด่วนขึ้นก่อนตามบริบทของวัน</Text>
          {urgent.length ? urgent.map((item, index) => <View key={string(item, 'id', String(index))} style={styles.priorityItem}><View style={[styles.rank, index === 1 && styles.rankSoft]}><Text style={styles.rankText}>{index + 1}</Text></View><View style={styles.priorityCopy}><Text numberOfLines={1} style={styles.priorityItemTitle}>{string(item, 'title')}</Text><Text style={styles.priorityItemSub}>{time(item.startAt)} · {string(item, 'type', 'งานสำคัญ')} · คะแนน {priorityScore(item)}</Text><View style={styles.reasonWrap}>{priorityReasons(item).map((reason) => <View key={reason} style={styles.reasonChip}><Text style={styles.reasonText}>{reason}</Text></View>)}</View></View><View style={styles.priorityActions}><View style={styles.urgency}><Text style={styles.urgencyText}>{index === 0 ? 'ด่วน' : 'สำคัญ'}</Text></View><Pressable accessibilityLabel={`ทำ ${string(item, 'title')} ให้เสร็จ`} disabled={Boolean(completingId)} onPress={() => void markComplete(item)} style={({pressed}) => [styles.doneButton, pressed && styles.pressed]}>{completingId === string(item, 'id', '') ? <ActivityIndicator color="#fff" size="small" /> : <MaterialIcon color="#fff" name="check" size={15} />}<Text style={styles.doneText}>เสร็จ</Text></Pressable></View></View>) : <View style={styles.priorityItem}><View style={styles.rank}><MaterialIcon color="#fff" name="check" size={15} /></View><View style={styles.priorityCopy}><Text style={styles.priorityItemTitle}>วันนี้ไม่มีงานด่วน</Text><Text style={styles.priorityItemSub}>AI จะอัปเดตเมื่อมีรายการใหม่</Text></View></View>}
          <View style={styles.collapsed}><MaterialIcon color="#7e8979" name="inventory_2" size={15} /><Text style={styles.collapsedText}>ข้อมูลรองถูกย่อไว้ชั่วคราว: งบอาหาร โน้ตทั่วไป และรายการไม่เร่งด่วน</Text></View>
        </View>

        <View style={styles.stats}><StatCard icon="calendar_today" label="คลาสเรียน" value={schedules.length} /><StatCard icon="task_alt" label="งานที่ต้องทำ" tint={colors.noteSoft} value={pending.length} /><StatCard icon="account_balance_wallet" label={allowance ? 'งบวันนี้' : 'ยังไม่ได้ตั้งงบ'} tint={colors.financeSoft} value={allowanceValue} /></View>

        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>ตารางวันนี้</Text><SoftPress onPress={() => onNavigate('smartlife_calendar_day')}><Text style={styles.seeAll}>ดูทั้งหมด</Text></SoftPress></View>
        <View style={styles.scheduleCard}>{schedules.length ? schedules.slice(0, 3).map((item, index) => <View key={string(item, 'id', String(index))} style={[styles.classRow, index > 0 && styles.classBorder]}><View style={styles.timePill}><Text style={styles.classTime}>{time(item.startAt)}</Text></View><View style={[styles.courseLine, {backgroundColor: string(item, 'color', index % 2 ? colors.finance : colors.sage)}]} /><View style={styles.courseCopy}><Text style={styles.courseTitle}>{string(item, 'title')}</Text><View style={styles.roomRow}><MaterialIcon color="#899284" name="location_on" size={14} /><Text style={styles.roomText}>{string(item, 'location', string(item, 'courseCode'))}</Text></View></View></View>) : <View style={styles.empty}><MaterialIcon color="#a4ada0" name="event_available" size={30} /><Text style={styles.emptyText}>วันนี้ยังไม่มีคลาสเรียน</Text></View>}</View>

        <Text style={styles.sectionTitle}>โฟกัสวันนี้</Text>
        <View style={styles.focusGrid}>
          <SoftPress onPress={() => onNavigate('smartlife_add_task')} style={styles.focusCard}><View style={styles.panelHeading}><MaterialIcon color={colors.note} name="check_box" size={17} /><Text style={styles.panelTitle}>โฟกัสวันนี้</Text></View>{pending.length ? pending.slice(0, 2).map((item, index) => <View key={string(item, 'id', String(index))} style={styles.taskRow}><View style={styles.taskCheck}><MaterialIcon color="#fff" name="check" size={11} /></View><View style={{flex: 1}}><Text numberOfLines={1} style={styles.taskTitle}>{string(item, 'title')}</Text><Text style={styles.taskTime}>{time(item.startAt)}</Text></View></View>) : <Text style={styles.panelEmpty}>ยังไม่มีงานที่ต้องทำ</Text>}</SoftPress>
          <SoftPress onPress={() => onNavigate('smartlife_finance_day')} style={styles.focusCard}><View style={styles.panelHeading}><MaterialIcon color={colors.finance} name="account_balance_wallet" size={17} /><Text style={styles.panelTitle}>งบคงเหลือ</Text></View><View style={styles.budgetLine}><Text style={styles.budgetValue}>{allowanceValue}</Text><Text style={styles.budgetUnit}>{allowance ? '/ วันนี้' : 'ยังไม่ได้ตั้งงบ'}</Text></View><View style={styles.progress}><View style={[styles.progressFill, {width: `${monthBudgetLeftPercent}%`}]} /></View><View style={styles.tagWrap}>{transactions.filter((item) => item.type === 'expense').slice(0, 3).map((item, index) => <View key={string(item, 'id', String(index))} style={styles.tag}><Text numberOfLines={1} style={styles.tagText}>{string(item, 'category', 'ทั่วไป')} {money(Number(item.amount ?? 0))}</Text></View>)}</View></SoftPress>
        </View>

        {notes[0] ? <SoftPress onPress={() => onNavigate('smartlife_notes_study')} style={styles.noteLink}><View style={styles.noteIcon}><MaterialIcon color={colors.note} name="note_alt" size={20} /></View><View style={{flex: 1}}><Text style={styles.noteEyebrow}>โน้ตที่เชื่อมกับตารางวันนี้</Text><Text numberOfLines={1} style={styles.noteTitle}>{string(notes[0], 'title')}</Text></View><MaterialIcon color={colors.sageDark} name="chevron_right" size={23} /></SoftPress> : null}

        <View style={styles.weeklySpendingCard}>
          <View style={styles.weeklySpendingHead}><View><Text style={styles.weeklySpendingEyebrow}>สรุปการใช้เงิน</Text><Text style={styles.weeklySpendingTitle}>รายจ่ายสัปดาห์นี้</Text></View><Pressable accessibilityLabel="ดูรายละเอียดรายจ่ายรายสัปดาห์" onPress={() => onNavigate('smartlife_finance_week')} style={styles.weeklySpendingLink}><Text style={styles.weeklySpendingLinkText}>ดูทั้งหมด</Text><MaterialIcon color={colors.sageDark} name="chevron_right" size={18} /></Pressable></View>
          <SpendingDonut byCategory={weeklySpending.byCategory} compact total={weeklySpending.total} />
        </View>
      </>}
    </ScrollView>
    <UserTabBar active="index" onNavigate={onNavigate} />
  </View></ResponsiveSafeArea>;
}

const shadow = {shadowColor: colors.pine, shadowOffset: {height: 10, width: 0}, shadowOpacity: .08, shadowRadius: 22};
const font = {regular: 'Prompt_400Regular', medium: 'Prompt_500Medium', semibold: 'Prompt_600SemiBold', bold: 'Prompt_700Bold', extra: 'Prompt_800ExtraBold'};
const styles = StyleSheet.create({
  seedAction: {color: colors.sageDark, fontFamily: font.bold, fontSize: 10},
  seedCard: {...shadow, alignItems: 'center', backgroundColor: '#fff', borderColor: 'rgba(111,143,109,.18)', borderRadius: 17, borderWidth: 1, flexDirection: 'row', gap: 10, marginBottom: 15, padding: 13},
  seedIcon: {alignItems: 'center', backgroundColor: colors.sageSoft, borderRadius: 13, height: 40, justifyContent: 'center', width: 40},
  seedSub: {color: colors.muted, fontFamily: font.regular, fontSize: 9, marginTop: 1},
  seedTitle: {color: colors.pine, fontFamily: font.bold, fontSize: 12},
  aiCard: {...shadow, backgroundColor: '#88a188', borderRadius: 18, marginBottom: 15, minHeight: 142, overflow: 'hidden', padding: 16},
  aiHeading: {alignItems: 'center', flexDirection: 'row', gap: 10},
  aiTitle: {color: '#fff', fontFamily: font.bold, fontSize: 17},
  aiTop: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  avatar: {...shadow, alignItems: 'center', backgroundColor: '#834b51', borderColor: '#fff', borderRadius: 25, borderWidth: 2, flexShrink: 0, height: 50, justifyContent: 'center', overflow: 'hidden', width: 50},
  avatarGlow: {backgroundColor: '#d8b3a5', borderRadius: 22, height: 32, opacity: .34, position: 'absolute', right: -8, top: -6, width: 32},
  avatarText: {color: '#fff', fontFamily: font.bold, fontSize: 15},
  // The bell keeps its own square and is never allowed to shrink or be
  // pushed out of the row: a long display name may only eat the space left
  // over, not the one control in the header.
  bell: {...shadow, alignItems: 'center', backgroundColor: '#fff', borderRadius: 25, flexGrow: 0, flexShrink: 0, height: 50, justifyContent: 'center', width: 50},
  budgetLine: {alignItems: 'baseline', flexDirection: 'row', marginTop: 11},
  budgetUnit: {color: colors.muted, fontFamily: font.regular, fontSize: 10, marginLeft: 4},
  budgetValue: {color: colors.pine, fontFamily: font.extra, fontSize: 24},
  classBorder: {borderTopColor: 'rgba(44,52,27,.08)', borderTopWidth: 1},
  classRow: {alignItems: 'center', flexDirection: 'row', minHeight: 70, paddingHorizontal: 13},
  classTime: {color: colors.sageDark, fontFamily: font.bold, fontSize: 11},
  collapsed: {alignItems: 'center', backgroundColor: '#eef2e9', borderRadius: 11, flexDirection: 'row', gap: 8, marginTop: 10, paddingHorizontal: 11, paddingVertical: 9},
  collapsedText: {color: '#7b8476', flex: 1, fontFamily: font.regular, fontSize: 9, lineHeight: 14},
  content: {padding: 22, paddingBottom: 28},
  courseCopy: {flex: 1},
  courseLine: {borderRadius: 3, height: 38, marginHorizontal: 11, width: 4},
  courseTitle: {color: colors.pine, fontFamily: font.semibold, fontSize: 13},
  dynamicBadge: {backgroundColor: '#e8f0e4', borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5},
  dynamicText: {color: colors.sageDark, fontFamily: font.semibold, fontSize: 8},
  doneButton: {alignItems: 'center', backgroundColor: colors.sageDark, borderRadius: 10, flexDirection: 'row', gap: 2, minHeight: 29, paddingHorizontal: 7},
  doneText: {color: '#fff', fontFamily: font.bold, fontSize: 7},
  empty: {alignItems: 'center', gap: 8, paddingVertical: 22},
  emptyText: {color: colors.muted, fontFamily: font.regular, fontSize: 11},
  focusCard: {...shadow, backgroundColor: '#fff', borderRadius: 17, flex: 1, minHeight: 154, padding: 13},
  focusGrid: {flexDirection: 'row', gap: 11, marginBottom: 15, marginTop: 11},
  hello: {color: '#8a9282', fontFamily: font.regular, fontSize: 12},
  loading: {alignItems: 'center', gap: 12, paddingVertical: 100},
  mic: {alignItems: 'center', backgroundColor: 'rgba(255,255,255,.95)', borderColor: 'rgba(255,255,255,.55)', borderRadius: 22, borderWidth: 5, height: 44, justifyContent: 'center', width: 44},
  muted: {color: colors.muted, fontFamily: font.regular, fontSize: 11},
  name: {color: colors.pine, fontFamily: font.extra, fontSize: 19, marginTop: -1},
  noteEyebrow: {color: colors.note, fontFamily: font.semibold, fontSize: 9},
  noteIcon: {alignItems: 'center', backgroundColor: colors.noteSoft, borderRadius: 12, height: 39, justifyContent: 'center', width: 39},
  noteLink: {...shadow, alignItems: 'center', backgroundColor: '#fff', borderRadius: 17, flexDirection: 'row', gap: 11, marginBottom: 4, padding: 13},
  noteTitle: {color: colors.pine, fontFamily: font.semibold, fontSize: 12, marginTop: 1},
  panelEmpty: {color: colors.muted, fontFamily: font.regular, fontSize: 10, marginTop: 16},
  panelHeading: {alignItems: 'center', flexDirection: 'row', gap: 6},
  panelTitle: {color: colors.pine, fontFamily: font.bold, fontSize: 11},
  pressed: {opacity: .85, transform: [{scale: .985}]},
  priorityCaption: {color: colors.muted, fontFamily: font.regular, fontSize: 9, marginBottom: 8, marginTop: 3},
  priorityCard: {...shadow, backgroundColor: '#fff', borderRadius: 18, marginBottom: 15, padding: 14},
  priorityCopy: {flex: 1},
  priorityHeader: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  priorityItem: {alignItems: 'center', backgroundColor: '#f6f8f3', borderColor: 'rgba(44,52,27,.06)', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 9, marginTop: 7, padding: 9},
  priorityActions: {alignItems: 'flex-end', gap: 6},
  priorityItemSub: {color: colors.muted, fontFamily: font.regular, fontSize: 9, marginTop: 1},
  priorityItemTitle: {color: colors.pine, fontFamily: font.semibold, fontSize: 11},
  priorityTitle: {color: colors.pine, fontFamily: font.bold, fontSize: 14},
  priorityTitleRow: {alignItems: 'center', flexDirection: 'row', gap: 7},
  progress: {backgroundColor: '#e6e6ec', borderRadius: 99, height: 6, marginTop: 9, overflow: 'hidden'},
  progressFill: {backgroundColor: colors.finance, borderRadius: 99, height: 6},
  // `minWidth: 0` is what actually lets the name truncate on web, where a
  // flex item defaults to min-width:auto and refuses to shrink below its
  // content -- which is how a 30-character name ran off the screen edge.
  greeting: {flex: 1, minWidth: 0},
  profileRow: {alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12, minWidth: 0},
  prompt: {alignItems: 'center', backgroundColor: 'rgba(72,105,72,.24)', borderColor: 'rgba(44,52,27,.08)', borderRadius: 14, borderWidth: 1, flexDirection: 'row', height: 41, justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 13},
  promptText: {color: '#fff', flex: 1, fontFamily: font.regular, fontSize: 12},
  quickAnswer: {alignItems: 'center', backgroundColor: 'rgba(255,255,255,.45)', borderRadius: 11, flexDirection: 'row', justifyContent: 'space-between', marginTop: 7, paddingHorizontal: 11, paddingVertical: 7},
  quickQuestion: {color: colors.pine, fontFamily: font.regular, fontSize: 9},
  quickValue: {color: colors.pine, fontFamily: font.bold, fontSize: 9},
  rank: {alignItems: 'center', backgroundColor: colors.pine, borderRadius: 9, height: 26, justifyContent: 'center', width: 26},
  rankSoft: {backgroundColor: colors.sage},
  rankText: {color: '#fff', fontFamily: font.bold, fontSize: 10},
  reasonChip: {backgroundColor: '#edf3ea', borderRadius: 99, paddingHorizontal: 7, paddingVertical: 3},
  reasonText: {color: colors.sageDark, fontFamily: font.semibold, fontSize: 7},
  reasonWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5},
  roomRow: {alignItems: 'center', flexDirection: 'row', marginTop: 3},
  roomText: {color: '#899284', fontFamily: font.regular, fontSize: 9},
  safe: {backgroundColor: '#eef1e9', flex: 1},
  scheduleCard: {...shadow, backgroundColor: '#fff', borderRadius: 18, marginBottom: 16, overflow: 'hidden'},
  screen: {backgroundColor: colors.mist, flex: 1},
  sectionHeading: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10},
  sectionTitle: {color: colors.pine, fontFamily: font.bold, fontSize: 15},
  seeAll: {color: colors.sageDark, fontFamily: font.semibold, fontSize: 10},
  statCard: {...shadow, alignItems: 'center', backgroundColor: '#fff', borderRadius: 17, flex: 1, height: 101, justifyContent: 'center'},
  statIcon: {alignItems: 'center', borderRadius: 17, height: 34, justifyContent: 'center', width: 34},
  statLabel: {color: colors.muted, fontFamily: font.regular, fontSize: 9, marginTop: 1, textAlign: 'center'},
  statValue: {color: colors.pine, fontFamily: font.extra, fontSize: 19, marginTop: 4},
  stats: {flexDirection: 'row', gap: 10, marginBottom: 17},
  tag: {backgroundColor: colors.financeSoft, borderRadius: 99, maxWidth: '100%', paddingHorizontal: 7, paddingVertical: 3},
  tagText: {color: '#73799f', fontFamily: font.medium, fontSize: 7},
  tagWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 9},
  taskCheck: {alignItems: 'center', backgroundColor: colors.note, borderRadius: 7, height: 20, justifyContent: 'center', width: 20},
  taskRow: {alignItems: 'center', flexDirection: 'row', gap: 7, marginTop: 11},
  taskTime: {color: colors.muted, fontFamily: font.regular, fontSize: 8},
  taskTitle: {color: colors.pine, fontFamily: font.semibold, fontSize: 9},
  timePill: {alignItems: 'center', backgroundColor: '#edf3ea', borderRadius: 10, minWidth: 48, paddingHorizontal: 7, paddingVertical: 6},
  topRow: {alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginBottom: 15},
  unread: {alignItems: 'center', backgroundColor: '#f35659', borderColor: '#fff', borderRadius: 8, borderWidth: 2, height: 16, justifyContent: 'center', minWidth: 16, position: 'absolute', right: 4, top: 4},
  unreadText: {color: '#fff', fontFamily: font.bold, fontSize: 7},
  urgency: {backgroundColor: '#fff', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4},
  urgencyText: {color: colors.note, fontFamily: font.semibold, fontSize: 8},
  weeklySpendingCard: {...shadow, backgroundColor: '#fff', borderColor: 'rgba(111,143,109,.16)', borderRadius: 19, borderWidth: 1, marginBottom: 5, marginTop: 12, padding: 14},
  weeklySpendingEyebrow: {color: colors.finance, fontFamily: font.bold, fontSize: 9},
  weeklySpendingHead: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  weeklySpendingLink: {alignItems: 'center', flexDirection: 'row', gap: 2, paddingVertical: 5},
  weeklySpendingLinkText: {color: colors.sageDark, fontFamily: font.semibold, fontSize: 9},
  weeklySpendingTitle: {color: colors.pine, fontFamily: font.extra, fontSize: 15, marginTop: 1},
});
