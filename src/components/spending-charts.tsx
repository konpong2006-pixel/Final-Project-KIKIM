import {useMemo, useState} from 'react';
import {type GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';

import {aggregateSpending, type SpendingCategoryPoint, type SpendingPeriod, type SpendingTransactionInput} from '@/services/spending-analytics';
import {MaterialIcon} from '@/screens/native/user/user-ui';

const colors = ['#628762', '#707cae', '#c77b70', '#d3a957', '#77999c', '#9b78a3', '#8d9274', '#bd8760'];
const ink = '#29351f';
const muted = '#7f897f';
const font = {regular: 'Prompt_400Regular', semibold: 'Prompt_600SemiBold', bold: 'Prompt_700Bold', extra: 'Prompt_800ExtraBold'};

function money(value: number) {
  return `฿${value.toLocaleString('th-TH', {maximumFractionDigits: 2})}`;
}

type Props = {
  period: SpendingPeriod;
  referenceDate: Date;
  transactions: SpendingTransactionInput[];
};

export function SpendingCharts({period, referenceDate, transactions}: Props) {
  const analytics = useMemo(
    () => aggregateSpending(transactions, period, referenceDate),
    [period, referenceDate, transactions],
  );
  const [selectedDayKey, setSelectedDayKey] = useState('');
  const selectedDay = analytics.byDay.find((point) => point.key === selectedDayKey) ?? analytics.highestDay;
  const maxDay = Math.max(...analytics.byDay.map((point) => point.amount), 1);
  const averageDay = analytics.total / Math.max(analytics.byDay.length, 1);
  const averageLineBottom = 34 + Math.min(80, averageDay / maxDay * 80);
  const monthly = period === 'month';

  return <View style={styles.section}>
    <View style={styles.headingRow}>
      <View style={styles.headingIcon}><MaterialIcon color="#fff" name="monitoring" size={19} /></View>
      <View style={styles.headingCopy}>
        <Text style={styles.eyebrow}>SPENDING INSIGHTS</Text>
        <Text style={styles.title}>ภาพรวมรายจ่าย{monthly ? 'รายเดือน' : 'รายสัปดาห์'}</Text>
      </View>
      <View style={styles.totalPill}><Text style={styles.totalLabel}>รวม</Text><Text style={styles.total}>{money(analytics.total)}</Text></View>
    </View>

    {!analytics.transactionCount ? <View style={styles.empty}>
      <View style={styles.emptyIcon}><MaterialIcon color="#7b8f79" name="bar_chart" size={28} /></View>
      <Text style={styles.emptyTitle}>ยังไม่มีรายจ่ายในช่วงนี้</Text>
      <Text style={styles.emptyText}>เมื่อมีรายการรายจ่าย กราฟตามวันและหมวดหมู่จะแสดงที่นี่</Text>
    </View> : <>
      <View style={styles.chartCard}>
        <View style={styles.chartTitleRow}><View><Text style={styles.chartTitle}>รายจ่ายแยกตามวัน</Text><Text style={styles.chartSubtitle}>วันและวันที่ตรงกับรายการรายจ่ายด้านล่าง</Text></View>{selectedDay ? <View style={styles.selection}><Text style={styles.selectionCaption}>วันที่เลือก</Text><Text numberOfLines={1} style={styles.selectionLabel}>{selectedDay.label}</Text><Text style={styles.selectionAmount}>{money(selectedDay.amount)}</Text></View> : null}</View>
        <View style={styles.plotShell}>
          <View pointerEvents="none" style={[styles.gridLine, styles.gridLineTop]} />
          <View pointerEvents="none" style={[styles.gridLine, styles.gridLineMiddle]} />
          <View pointerEvents="none" style={[styles.gridLine, styles.gridLineBottom]} />
          <View pointerEvents="none" style={[styles.averageLine, {bottom: averageLineBottom}]} />
          <View pointerEvents="none" style={[styles.averageTag, {bottom: Math.min(122, averageLineBottom + 3)}]}><Text style={styles.averageTagText}>เฉลี่ย</Text></View>
          <ScrollView contentContainerStyle={[styles.dayChart, monthly && styles.monthDayChart]} horizontal={monthly} showsHorizontalScrollIndicator={false} style={styles.dayScroll}>
            {analytics.byDay.map((point, index) => {
              const selected = point.key === selectedDay?.key;
              const height = point.amount ? Math.max(7, point.amount / maxDay * 80) : 3;
              const numericDate = new Intl.DateTimeFormat('th-TH', {
                day: 'numeric',
                month: 'numeric',
                timeZone: 'Asia/Bangkok',
              }).format(point.date);
              return <Pressable
                accessibilityLabel={`${point.label} ${money(point.amount)}`}
                key={point.key}
                onHoverIn={() => setSelectedDayKey(point.key)}
                onPress={() => setSelectedDayKey(point.key)}
                style={[styles.dayColumn, index % 2 === 0 && styles.dayColumnTint, monthly && styles.monthDayColumn]}>
                <View style={styles.barTrack}>
                  {point.amount ? <Text numberOfLines={1} style={[styles.barValue, {bottom: height + 2}, selected && styles.barValueSelected]}>{money(point.amount)}</Text> : null}
                  <View style={[styles.dayBar, {height}, selected && styles.dayBarSelected, !point.amount && styles.zeroBar]} />
                </View>
                <Text style={[styles.axisLabel, selected && styles.axisLabelSelected]}>{point.shortLabel}</Text>
                <Text style={[styles.axisDateLabel, selected && styles.axisLabelSelected]}>{numericDate}</Text>
              </Pressable>;
            })}
          </ScrollView>
        </View>
        <View style={styles.dayLegend}>
          <View style={styles.dayLegendItem}><View style={styles.dayLegendDot} /><Text style={styles.dayLegendText}>รายจ่ายต่อวัน</Text></View>
          <View style={styles.dayLegendItem}><View style={styles.dayLegendDash} /><Text style={styles.dayLegendText}>เฉลี่ย {money(averageDay)}</Text></View>
          <Text style={styles.maxLabel}>สูงสุด {money(maxDay)}</Text>
        </View>
      </View>

      <View style={styles.chartCard}><View style={styles.chartTitleRow}><View><Text style={styles.chartTitle}>สัดส่วนรายจ่ายตามหมวดหมู่</Text><Text style={styles.chartSubtitle}>แตะวงกลมหรือชื่อหมวดเพื่อดูยอดที่ใช้</Text></View></View><SpendingDonut byCategory={analytics.byCategory} total={analytics.total} /></View>
    </>}
  </View>;
}

const SPOKE_COUNT = 120;

function categoryAtRatio(byCategory: SpendingCategoryPoint[], total: number, ratio: number) {
  let accumulated = 0;
  return byCategory.find((point) => {
    accumulated += point.amount / total;
    return ratio <= accumulated;
  }) ?? byCategory.at(-1) ?? null;
}

export function SpendingDonut({byCategory, compact = false, total}: {byCategory: SpendingCategoryPoint[]; compact?: boolean; total: number}) {
  const [selectedCategory, setSelectedCategory] = useState('');
  const selected = byCategory.find((point) => point.category === selectedCategory) ?? byCategory[0] ?? null;
  const spokes = useMemo(() => Array.from({length: SPOKE_COUNT}, (_, index) => {
    const point = categoryAtRatio(byCategory, total, (index + .5) / SPOKE_COUNT);
    return {color: colors[Math.max(0, byCategory.indexOf(point as SpendingCategoryPoint)) % colors.length], point};
  }), [byCategory, total]);
  const selectSlice = (event: GestureResponderEvent) => {
    if (!total) return;
    const size = compact ? 132 : 154;
    const x = event.nativeEvent.locationX - size / 2;
    const y = event.nativeEvent.locationY - size / 2;
    const angle = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
    const point = categoryAtRatio(byCategory, total, angle / (Math.PI * 2));
    if (point) setSelectedCategory(point.category);
  };

  if (!total || !byCategory.length) return <View style={styles.donutEmpty}><MaterialIcon color="#7b8f79" name="donut_large" size={28} /><View style={{flex: 1}}><Text style={styles.emptyTitle}>ยังไม่มีรายจ่ายสัปดาห์นี้</Text><Text style={styles.emptyTextInline}>เพิ่มรายจ่ายแล้วสัดส่วนแต่ละหมวดจะแสดงที่นี่</Text></View></View>;

  return <View style={styles.donutLayout}>
    <Pressable accessibilityLabel={`แผนภาพรายจ่าย รวม ${money(total)}`} onPress={selectSlice} style={[styles.donut, compact && styles.donutCompact]}>
      {spokes.map((spoke, index) => <View key={index} pointerEvents="none" style={[styles.spokeFrame, compact && styles.spokeFrameCompact, {transform: [{rotate: `${index * 360 / SPOKE_COUNT}deg`}]}]}><View style={[styles.spoke, compact && styles.spokeCompact, {backgroundColor: spoke.color}]} /></View>)}
      <View pointerEvents="none" style={[styles.donutCenter, compact && styles.donutCenterCompact]}><Text numberOfLines={1} style={styles.donutCenterLabel}>{selected?.category}</Text><Text adjustsFontSizeToFit minimumFontScale={.75} numberOfLines={1} style={styles.donutCenterAmount}>{money(selected?.amount ?? 0)}</Text><Text style={styles.donutCenterPercent}>{Math.round(selected?.percentage ?? 0)}%</Text></View>
    </Pressable>
    <View style={styles.legend}>{byCategory.map((point, index) => <Pressable accessibilityLabel={`${point.category} ${money(point.amount)}`} key={point.category} onHoverIn={() => setSelectedCategory(point.category)} onPress={() => setSelectedCategory(point.category)} style={[styles.legendRow, point.category === selected?.category && styles.legendRowSelected]}><View style={[styles.categoryDot, {backgroundColor: colors[index % colors.length]}]} /><View style={styles.legendCopy}><Text numberOfLines={1} style={styles.categoryName}>{point.category}</Text><Text style={styles.legendPercent}>{Math.round(point.percentage)}%</Text></View><Text style={styles.categoryAmount}>{money(point.amount)}</Text></Pressable>)}</View>
  </View>;
}

const shadow = {shadowColor: ink, shadowOffset: {height: 8, width: 0}, shadowOpacity: .06, shadowRadius: 18};
const styles = StyleSheet.create({
  axisDateLabel: {color: muted, fontFamily: font.regular, fontSize: 7, marginTop: -1},
  axisLabel: {color: muted, fontFamily: font.semibold, fontSize: 9, marginTop: 3},
  axisLabelSelected: {color: '#566ca5', fontFamily: font.bold},
  averageLine: {borderColor: '#999ca2', borderStyle: 'dashed', borderTopWidth: 1, left: 0, position: 'absolute', right: 0, zIndex: 2},
  averageTag: {backgroundColor: '#8b8e94', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, position: 'absolute', right: 3, zIndex: 4},
  averageTagText: {color: '#fff', fontFamily: font.bold, fontSize: 7},
  barTrack: {alignItems: 'center', height: 94, justifyContent: 'flex-end', position: 'relative', width: '100%'},
  barValue: {color: '#b8646b', fontFamily: font.bold, fontSize: 7, left: 0, position: 'absolute', right: 0, textAlign: 'center'},
  barValueSelected: {color: '#52639a'},
  categoryAmount: {color: ink, fontFamily: font.bold, fontSize: 11, minWidth: 72, textAlign: 'right'},
  categoryDot: {borderRadius: 5, height: 10, width: 10},
  categoryName: {color: ink, flex: 1, fontFamily: font.semibold, fontSize: 11},
  chartCard: {...shadow, backgroundColor: '#fff', borderColor: '#e4e9df', borderRadius: 19, borderWidth: 1, marginTop: 11, padding: 13},
  chartSubtitle: {color: muted, fontFamily: font.regular, fontSize: 9, marginTop: 2},
  chartTitle: {color: ink, fontFamily: font.bold, fontSize: 13},
  chartTitleRow: {alignItems: 'flex-start', flexDirection: 'row', gap: 8, justifyContent: 'space-between'},
  dayBar: {backgroundColor: '#df7f86', borderRadius: 8, minHeight: 3, width: 16},
  dayBarSelected: {backgroundColor: '#626fa8', width: 20},
  dayChart: {alignItems: 'flex-end', flexDirection: 'row', flexGrow: 1, minWidth: '100%', paddingHorizontal: 4},
  dayColumn: {alignItems: 'center', flex: 1, justifyContent: 'flex-end', minWidth: 34, paddingTop: 5},
  dayColumnTint: {backgroundColor: 'rgba(112, 124, 174, .045)'},
  dayLegend: {alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8},
  dayLegendDash: {borderColor: '#999ca2', borderStyle: 'dashed', borderTopWidth: 2, width: 18},
  dayLegendDot: {backgroundColor: '#df7f86', borderRadius: 5, height: 9, width: 9},
  dayLegendItem: {alignItems: 'center', flexDirection: 'row', gap: 5},
  dayLegendText: {color: muted, fontFamily: font.regular, fontSize: 8},
  dayScroll: {zIndex: 3},
  donut: {height: 154, position: 'relative', width: 154},
  donutCenter: {alignItems: 'center', backgroundColor: '#fff', borderRadius: 49, height: 98, justifyContent: 'center', left: 28, paddingHorizontal: 8, position: 'absolute', top: 28, width: 98},
  donutCenterAmount: {color: ink, fontFamily: font.extra, fontSize: 15, maxWidth: 82},
  donutCenterLabel: {color: muted, fontFamily: font.semibold, fontSize: 9, maxWidth: 78},
  donutCenterPercent: {color: '#626fa8', fontFamily: font.bold, fontSize: 10},
  donutCompact: {height: 132, width: 132},
  donutCenterCompact: {borderRadius: 42, height: 84, left: 24, top: 24, width: 84},
  donutEmpty: {alignItems: 'center', backgroundColor: '#f7f9f5', borderRadius: 15, flexDirection: 'row', gap: 11, marginTop: 12, padding: 14},
  donutLayout: {alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center', marginTop: 14},
  empty: {alignItems: 'center', backgroundColor: '#f7f9f5', borderColor: '#e3e9df', borderRadius: 18, borderStyle: 'dashed', borderWidth: 1, marginTop: 12, paddingHorizontal: 20, paddingVertical: 24},
  emptyIcon: {alignItems: 'center', backgroundColor: '#e7efe4', borderRadius: 22, height: 44, justifyContent: 'center', width: 44},
  emptyText: {color: muted, fontFamily: font.regular, fontSize: 10, lineHeight: 16, marginTop: 3, textAlign: 'center'},
  emptyTitle: {color: ink, fontFamily: font.bold, fontSize: 13, marginTop: 8},
  emptyTextInline: {color: muted, fontFamily: font.regular, fontSize: 9, lineHeight: 14, marginTop: 2},
  eyebrow: {color: '#626fa8', fontFamily: font.bold, fontSize: 8, letterSpacing: .5},
  headingCopy: {flex: 1},
  headingIcon: {alignItems: 'center', backgroundColor: '#626fa8', borderRadius: 15, height: 39, justifyContent: 'center', width: 39},
  headingRow: {alignItems: 'center', flexDirection: 'row', gap: 10},
  gridLine: {backgroundColor: '#dfe3dd', height: 1, left: 0, position: 'absolute', right: 0, zIndex: 1},
  gridLineBottom: {bottom: 34},
  gridLineMiddle: {bottom: 74},
  gridLineTop: {bottom: 114},
  legend: {flex: 1, gap: 5, minWidth: 150},
  legendCopy: {flex: 1, minWidth: 0},
  legendPercent: {color: muted, fontFamily: font.semibold, fontSize: 8, marginTop: 1},
  legendRow: {alignItems: 'center', borderColor: 'transparent', borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 39, paddingHorizontal: 8, paddingVertical: 5},
  legendRowSelected: {backgroundColor: '#f2f5ee', borderColor: '#dce8d8'},
  maxLabel: {color: muted, fontFamily: font.semibold, fontSize: 8, marginLeft: 'auto'},
  monthDayChart: {flexGrow: 0, minWidth: 790},
  monthDayColumn: {flex: 0, minWidth: 25},
  plotShell: {height: 129, marginTop: 9, overflow: 'hidden', position: 'relative'},
  section: {marginTop: 14},
  selection: {alignItems: 'flex-end', backgroundColor: '#eef0f8', borderRadius: 10, maxWidth: '50%', paddingHorizontal: 9, paddingVertical: 6},
  selectionAmount: {color: '#52639a', fontFamily: font.extra, fontSize: 11},
  selectionCaption: {color: '#8a91aa', fontFamily: font.semibold, fontSize: 7},
  selectionLabel: {color: '#737d9d', fontFamily: font.semibold, fontSize: 8, maxWidth: 150},
  spoke: {height: 78, left: 75, position: 'absolute', top: 0, width: 4},
  spokeCompact: {height: 67, left: 64, width: 4},
  spokeFrame: {height: 154, left: 0, position: 'absolute', top: 0, width: 154},
  spokeFrameCompact: {height: 132, width: 132},
  title: {color: ink, fontFamily: font.extra, fontSize: 15, marginTop: 1},
  total: {color: '#52639a', fontFamily: font.extra, fontSize: 13},
  totalLabel: {color: muted, fontFamily: font.semibold, fontSize: 8},
  totalPill: {alignItems: 'flex-end', backgroundColor: '#eef0f8', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7},
  zeroBar: {backgroundColor: '#dfe4dc'},
});
