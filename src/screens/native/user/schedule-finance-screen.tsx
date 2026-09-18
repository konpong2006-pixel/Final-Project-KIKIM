/* eslint-disable react-hooks/set-state-in-effect */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Text, View} from 'react-native';

import {Touchable} from '@/components/touchable';
import {loadLegacyPageData} from '@/services/legacy-data';
import {Card, EmptyBlock, LoadingBlock, UserHeader, UserShell, type UserNavigate, userStyles as styles} from './user-ui';

type Page = 'smartlife_schedule_finance_sync' | 'smartlife_schedule_finance_sync_week' | 'smartlife_schedule_finance_sync_month';
type Item = {id?: string; title?: string; startAt?: string; amount?: number; type?: string};
const tabs: [string, Page][] = [['วัน', 'smartlife_schedule_finance_sync'], ['สัปดาห์', 'smartlife_schedule_finance_sync_week'], ['เดือน', 'smartlife_schedule_finance_sync_month']];

export default function ScheduleFinanceScreen({page, uid, onNavigate}: {page: Page; uid: string; onNavigate: UserNavigate}) {
  const [data, setData] = useState<{schedules?: Item[]; activities?: Item[]; transactions?: Item[]} | null>(null);
  const load = useCallback(async () => { setData(await loadLegacyPageData(uid, `user/${page}`) as {schedules?: Item[]; activities?: Item[]; transactions?: Item[]}); }, [page, uid]);
  useEffect(() => { load().catch(() => setData({})); }, [load]);
  const studyItems = useMemo(() => [...(data?.schedules || []), ...(data?.activities || [])], [data]);
  const suggestedBudget = Math.max(60, Math.min(220, studyItems.length * 40));
  return <UserShell onNavigate={onNavigate}><UserHeader onNavigate={onNavigate} title="ตารางเวลาและการเงิน" subtitle="ช่วยวางแผนงบตามตารางเรียน" /><View style={styles.segmented}>{tabs.map(([label, target]) => <Touchable key={target} onPress={() => onNavigate(target)} style={[styles.segment, target === page && styles.segmentActive]}><Text style={[styles.segmentText, target === page && styles.segmentTextActive]}>{label}</Text></Touchable>)}</View>{data === null ? <LoadingBlock /> : <><Card style={{backgroundColor: '#e4e9f2'}}><Text style={styles.cardTitle}>คำแนะนำงบวันนี้</Text><Text style={[styles.sectionTitle, {color: '#52734b'}]}>กันงบอาหาร ฿{suggestedBudget}</Text><Text style={styles.bodyText}>คุณมีเรียนและกิจกรรม {studyItems.length} รายการในช่วงที่เลือก จึงควรกันงบอาหารและเดินทางไว้ก่อน</Text></Card><Card><Text style={styles.cardTitle}>ตารางที่ใช้คำนวณ</Text>{studyItems.length ? studyItems.map((item) => <View key={item.id} style={styles.row}><View style={[styles.rowDot, {backgroundColor: '#668d65'}]} /><Text style={styles.rowMain}>{item.title || 'รายการในตาราง'}</Text></View>) : <EmptyBlock label="เพิ่มตารางเรียนเพื่อรับคำแนะนำงบ" />}</Card><Card><Text style={styles.cardTitle}>รายการการเงินช่วงนี้</Text>{data.transactions?.length ? data.transactions.slice(0, 4).map((item) => <View key={item.id} style={styles.row}><View style={[styles.rowDot, {backgroundColor: item.type === 'income' ? '#668d65' : '#9297bb'}]} /><Text style={styles.rowMain}>{item.title || 'รายการการเงิน'}</Text><Text style={styles.rowSide}>฿{Number(item.amount || 0).toLocaleString('th-TH')}</Text></View>) : <EmptyBlock label="ยังไม่มีรายการการเงิน" />}</Card></>}</UserShell>;
}
