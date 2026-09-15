import {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';
import {ResponsiveSafeArea} from '@/components/layout/responsive-safe-area';

import {loadLegacyPageData} from '@/services/legacy-data';

type Props = {onNavigate: (page: string) => void; page: string; uid: string};
type Data = Record<string, unknown>;
const empty: Data = {};

function items(value: unknown) { return Array.isArray(value) ? value.filter((item): item is Data => Boolean(item) && typeof item === 'object') : []; }
function label(value: unknown, fallback = '-') { return typeof value === 'string' && value.trim() ? value : fallback; }
function thaiDate(value: unknown) { const date = new Date(String(value ?? '')); return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('th-TH', {dateStyle: 'medium', timeZone: 'Asia/Bangkok'}).format(date); }
function thaiTime(value: unknown) { const date = new Date(String(value ?? '')); return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('th-TH', {hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'}).format(date); }
function money(value: unknown) { return `฿${Number(value ?? 0).toLocaleString('th-TH')}`; }

function Card({children}: {children: React.ReactNode}) { return <View style={styles.card}>{children}</View>; }
function Row({title, detail, color = '#6f966f'}: {title: string; detail: string; color?: string}) { return <View style={styles.row}><View style={[styles.dot, {backgroundColor: color}]} /><View style={styles.rowCopy}><Text numberOfLines={1} style={styles.rowTitle}>{title}</Text><Text numberOfLines={2} style={styles.rowDetail}>{detail}</Text></View></View>; }

function TabBar({active, go}: {active: string; go: (page: string) => void}) {
  const tabs = [['⌂', 'หลัก', 'index'], ['▦', 'ตาราง', 'smartlife_calendar_day'], ['+', '', 'smartlife_scan_schedule'], ['▤', 'การเงิน', 'smartlife_finance_day'], ['▧', 'โน้ต', 'smartlife_notes']];
  return <View style={styles.tabs}>{tabs.map(([icon, name, target], index) => <Pressable key={target} onPress={() => go(target)} style={styles.tab}>{index === 2 ? <View style={styles.plus}><Text style={styles.plusText}>{icon}</Text></View> : <><Text style={[styles.tabIcon, active === target && styles.active]}>{icon}</Text><Text style={[styles.tabText, active === target && styles.active]}>{name}</Text></>}</Pressable>)}</View>;
}

function pageTitle(page: string) {
  if (page.includes('calendar')) return 'ตารางเรียน';
  if (page.includes('finance')) return 'การเงิน';
  if (page.includes('notes')) return 'โน้ต';
  if (page.includes('notification')) return 'การแจ้งเตือน';
  if (page.includes('profile')) return 'โปรไฟล์';
  if (page.includes('ai_')) return 'AI Assistant';
  if (page.includes('scan') || page.includes('receipt')) return 'Smart Scan';
  if (page.includes('add_') || page.includes('save_')) return 'เพิ่มรายการ';
  return 'SmartLife';
}

export default function UserPortal({onNavigate, page, uid}: Props) {
  const pageKey = `user/${page}`;
  const [loaded, setLoaded] = useState<{data: Data; key: string} | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const data = useMemo(() => loaded?.key === pageKey ? loaded.data : empty, [loaded, pageKey]);
  const loading = loaded?.key !== pageKey;
  const load = useCallback(async () => loadLegacyPageData(uid, pageKey) as Promise<Data>, [pageKey, uid]);
  useEffect(() => { let mounted = true; load().then((result) => { if (mounted) setLoaded({data: result, key: pageKey}); }).catch(() => { if (mounted) setLoaded({data: {}, key: pageKey}); }); return () => { mounted = false; }; }, [load, pageKey]);
  const refresh = useCallback(async () => { setRefreshing(true); try { setLoaded({data: await load(), key: pageKey}); } finally { setRefreshing(false); } }, [load, pageKey]);

  const body = useMemo(() => {
    const profile = (data.profile ?? {}) as Data;
    const schedules = items(data.schedules);
    const activities = items(data.activities);
    const transactions = items(data.transactions);
    const notes = items(data.notes);
    const notifications = items(data.notifications);
    const recommendations = items(data.recommendations);
    if (page === 'index') return <>
      <Text style={styles.greeting}>สวัสดี {label(profile.displayName, 'เพื่อน')} </Text><Text style={styles.caption}>สรุปของวันนี้จาก Firebase</Text>
      <Card><Text style={styles.cardTitle}>AI Assistant</Text><Text style={styles.aiPrompt}>“วันนี้ฉันมีเรียนกี่โมง?”</Text><Pressable onPress={() => onNavigate('smartlife_ai_assistant')}><Text style={styles.link}>เปิด AI Assistant ›</Text></Pressable></Card>
      <View style={styles.stats}><Stat label="คลาสเรียน" value={schedules.length} /><Stat label="งานที่ต้องทำ" value={activities.length} /><Stat label="ใช้จ่าย" value={money(transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount ?? 0), 0))} /></View>
      <Card><Text style={styles.cardTitle}>ตารางวันนี้</Text>{schedules.length ? schedules.slice(0, 3).map((item) => <Row key={label(item.id)} title={label(item.title)} detail={`${thaiTime(item.startAt)} · ${label(item.location, label(item.courseCode))}`} />) : <Text style={styles.empty}>ยังไม่มีตารางวันนี้</Text>}</Card>
    </>;
    if (page.includes('calendar')) return <><ModeTabs active={page} go={onNavigate} modes={[['D', 'smartlife_calendar_day'], ['W', 'smartlife_calendar_week'], ['M', 'smartlife_calendar_month']]} /><Card><Text style={styles.cardTitle}>รายการในตาราง</Text>{[...schedules, ...activities].length ? [...schedules, ...activities].map((item) => <Row key={label(item.id)} title={label(item.title)} detail={`${thaiDate(item.startAt)} · ${thaiTime(item.startAt)}-${thaiTime(item.endAt)}`} />) : <Text style={styles.empty}>ยังไม่มีรายการ</Text>}</Card><Pressable onPress={() => onNavigate('smartlife_add_activity')} style={styles.primary}><Text style={styles.primaryText}>เพิ่มกิจกรรม</Text></Pressable></>;
    if (page.includes('finance')) return <><ModeTabs active={page} go={onNavigate} modes={[['D', 'smartlife_finance_day'], ['W', 'smartlife_finance_week'], ['M', 'smartlife_finance_month']]} /><Card><Text style={styles.balance}>{money(transactions.reduce((sum, item) => sum + (item.type === 'income' ? Number(item.amount) : -Number(item.amount)), 0))}</Text><Text style={styles.caption}>ยอดคงเหลือในช่วงที่เลือก</Text></Card><Card><Text style={styles.cardTitle}>รายการการเงิน</Text>{transactions.length ? transactions.map((item) => <Row key={label(item.id)} title={label(item.merchant, label(item.category))} detail={`${label(item.category)} · ${thaiDate(item.occurredAt)} · ${money(item.amount)}`} color={item.type === 'income' ? '#6f966f' : '#9297bb'} />) : <Text style={styles.empty}>ยังไม่มีรายการ</Text>}</Card><Pressable onPress={() => onNavigate('smartlife_add_income')} style={styles.primary}><Text style={styles.primaryText}>เพิ่มรายรับ</Text></Pressable></>;
    if (page.includes('notes')) return <><ModeTabs active={page} go={onNavigate} modes={[['เรียน', 'smartlife_notes_study'], ['งาน', 'smartlife_notes_work'], ['ไอเดีย', 'smartlife_notes_ideas']]} /><Card><Text style={styles.cardTitle}>โน้ตของคุณ</Text>{notes.length ? notes.map((item) => <Row key={label(item.id)} title={label(item.title)} detail={`${label(item.category)} · ${String(item.content ?? '').slice(0, 80)}`} color="#9297bb" />) : <Text style={styles.empty}>ยังไม่มีโน้ต</Text>}</Card><Pressable onPress={() => onNavigate('smartlife_add_note')} style={styles.primary}><Text style={styles.primaryText}>เพิ่มโน้ต</Text></Pressable></>;
    if (page.includes('notification')) return <Card><Text style={styles.cardTitle}>การแจ้งเตือน</Text>{notifications.length ? notifications.map((item) => <Row key={label(item.id)} title={label(item.title)} detail={`${label(item.message)} · ${thaiDate(item.createdAt)}`} />) : <Text style={styles.empty}>ไม่มีการแจ้งเตือน</Text>}</Card>;
    if (page.includes('profile')) return <><Card><Text style={styles.profileName}>{label(profile.displayName, 'ผู้ใช้ SmartLife')}</Text><Text style={styles.caption}>{label(profile.email)}</Text></Card><Card><Text style={styles.cardTitle}>สถิติของคุณ</Text><Text style={styles.caption}>ตาราง {Number((data.counts as Data)?.schedules ?? 0)} · โน้ต {Number((data.counts as Data)?.notes ?? 0)} · การเงิน {Number((data.counts as Data)?.transactions ?? 0)}</Text></Card></>;
    if (page.includes('ai_')) return <Card><Text style={styles.cardTitle}>คำแนะนำจาก AI</Text>{recommendations.length ? recommendations.map((item) => <Row key={label(item.id)} title={label(item.title)} detail={label(item.explanation)} color="#9297bb" />) : <Text style={styles.empty}>ยังไม่มีคำแนะนำ</Text>}</Card>;
    if (page.includes('scan') || page.includes('receipt')) return <Card><Text style={styles.cardTitle}>Smart Scan</Text><Text style={styles.caption}>สแกนตารางเรียนหรือใบเสร็จผ่านกล้องและคลังรูปภาพ</Text><Pressable onPress={() => onNavigate('smartlife_scan_schedule')} style={styles.primary}><Text style={styles.primaryText}>เปิดกล้องสแกน</Text></Pressable></Card>;
    return <Card><Text style={styles.cardTitle}>{pageTitle(page)}</Text><Text style={styles.caption}>หน้านี้เป็น React Native .tsx พร้อมให้พัฒนาต่อ</Text></Card>;
  }, [data, onNavigate, page]);

  return <ResponsiveSafeArea style={styles.safe}><View style={styles.shell}><View style={styles.top}><View><Text style={styles.brand}>SmartLife</Text><Text style={styles.topTitle}>{pageTitle(page)}</Text></View><Pressable onPress={() => onNavigate('smartlife_profile')} style={styles.avatar}><Text style={styles.avatarText}>SL</Text></Pressable></View><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#6f966f" />}>{loading ? <View style={styles.loader}><ActivityIndicator color="#52734b" size="large" /><Text style={styles.caption}>กำลังโหลดข้อมูล Firebase</Text></View> : body}</ScrollView><TabBar active={page} go={onNavigate} /></View></ResponsiveSafeArea>;
}

function Stat({label, value}: {label: string; value: string | number}) { return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>; }
function ModeTabs({active, go, modes}: {active: string; go: (page: string) => void; modes: [string, string][]}) { return <View style={styles.mode}>{modes.map(([labelText, target]) => <Pressable key={target} onPress={() => go(target)} style={[styles.modeItem, active === target && styles.modeActive]}><Text style={[styles.modeText, active === target && styles.modeTextActive]}>{labelText}</Text></Pressable>)}</View>; }

const styles = StyleSheet.create({
  active: {color: '#4f754b'}, aiPrompt: {backgroundColor: '#e3eee0', borderRadius: 12, color: '#40543d', fontSize: 15, marginTop: 12, padding: 13}, avatar: {alignItems: 'center', backgroundColor: '#e8efe4', borderRadius: 22, height: 44, justifyContent: 'center', width: 44}, avatarText: {color: '#52734b', fontWeight: '900'}, balance: {color: '#28331f', fontSize: 31, fontWeight: '900'}, brand: {color: '#6f966f', fontSize: 13, fontWeight: '800'}, card: {backgroundColor: '#fff', borderRadius: 17, marginTop: 14, padding: 16}, cardTitle: {color: '#28331f', fontSize: 17, fontWeight: '800'}, caption: {color: '#818a7d', fontSize: 12, lineHeight: 18, marginTop: 4}, content: {padding: 18, paddingBottom: 28}, dot: {borderRadius: 5, height: 10, width: 10}, empty: {color: '#89918a', fontSize: 13, paddingVertical: 16, textAlign: 'center'}, greeting: {color: '#28331f', fontSize: 25, fontWeight: '900'}, link: {color: '#4f754b', fontSize: 13, fontWeight: '800', marginTop: 12}, loader: {alignItems: 'center', gap: 12, paddingTop: 100}, mode: {backgroundColor: '#e5ece1', borderRadius: 16, flexDirection: 'row', marginTop: 4, padding: 4}, modeActive: {backgroundColor: '#fff'}, modeItem: {alignItems: 'center', borderRadius: 12, flex: 1, paddingVertical: 9}, modeText: {color: '#81907c', fontSize: 13, fontWeight: '700'}, modeTextActive: {color: '#4f754b'}, plus: {alignItems: 'center', backgroundColor: '#4f754b', borderColor: '#fff', borderRadius: 29, borderWidth: 4, height: 58, justifyContent: 'center', marginTop: -22, shadowColor: '#28331f', shadowOffset: {height: 8, width: 0}, shadowOpacity: .2, shadowRadius: 12, width: 58}, plusText: {color: '#fff', fontSize: 30, fontWeight: '500'}, primary: {alignItems: 'center', backgroundColor: '#668d65', borderRadius: 14, justifyContent: 'center', minHeight: 49, marginTop: 15}, primaryText: {color: '#fff', fontSize: 15, fontWeight: '800'}, profileName: {color: '#28331f', fontSize: 22, fontWeight: '900'}, row: {alignItems: 'center', backgroundColor: '#f7f9f4', borderRadius: 12, flexDirection: 'row', gap: 10, marginTop: 10, padding: 12}, rowCopy: {flex: 1}, rowDetail: {color: '#7c8578', fontSize: 12, lineHeight: 18, marginTop: 2}, rowTitle: {color: '#30402b', fontSize: 13, fontWeight: '700'}, safe: {backgroundColor: '#f1f3ed', flex: 1}, shell: {backgroundColor: '#f1f3ed', flex: 1}, stat: {alignItems: 'center', backgroundColor: '#fff', borderRadius: 15, flex: 1, padding: 13}, statLabel: {color: '#7b8375', fontSize: 12, marginTop: 4, textAlign: 'center'}, statValue: {color: '#28331f', fontSize: 20, fontWeight: '900'}, stats: {flexDirection: 'row', gap: 9, marginTop: 14}, tab: {alignItems: 'center', flex: 1, justifyContent: 'center'}, tabIcon: {color: '#a0a9a0', fontSize: 20}, tabText: {color: '#9aa39a', fontSize: 12, fontWeight: '700', marginTop: 3}, tabs: {alignItems: 'center', backgroundColor: '#fff', borderTopColor: '#e2e6df', borderTopWidth: 1, flexDirection: 'row', height: 76, paddingHorizontal: 12}, top: {alignItems: 'center', backgroundColor: '#fff', borderBottomColor: '#e8ece4', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 18}, topTitle: {color: '#28331f', fontSize: 20, fontWeight: '900', marginTop: 2},
});
