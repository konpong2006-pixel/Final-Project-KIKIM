import {useState, type ReactNode} from 'react';
import {ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {ResponsiveSafeArea} from '@/components/layout/responsive-safe-area';
import {LinearGradient} from 'expo-linear-gradient';

export type UserNavigate = (page: string) => void;

export function MaterialIcon({name, color = '#2c341b', size = 22}: {name: string; color?: string; size?: number}) {
  return <Text style={{color, fontFamily: 'MaterialSymbols_400Regular', fontSize: size, lineHeight: size}}>{name}</Text>;
}

export function UserGradientBackdrop() {
  return <LinearGradient colors={['#fbfcf8', '#f0f3eb', '#e7ece1']} end={{x: 1, y: 1}} start={{x: 0, y: 0}} style={StyleSheet.absoluteFill} />;
}

export function UserShell({children, active, edgeToEdge = false, onNavigate, scroll = true}: {children: ReactNode; active?: string; edgeToEdge?: boolean; onNavigate: UserNavigate; scroll?: boolean}) {
  const body = <View style={[styles.body, edgeToEdge && styles.bodyEdge]}>{children}</View>;
  return <ResponsiveSafeArea style={[styles.safe, edgeToEdge && styles.flatSurface]}><View style={[styles.shell, edgeToEdge && styles.flatSurface]}>{edgeToEdge ? null : <UserGradientBackdrop />}{scroll ? <ScrollView contentContainerStyle={styles.scroll} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}<UserTabBar active={active} onNavigate={onNavigate} /></View></ResponsiveSafeArea>;
}

export function UserHeader({title, subtitle, right, onNavigate}: {title: string; subtitle?: string; right?: ReactNode; onNavigate: UserNavigate}) {
  return <LinearGradient colors={['rgba(255,255,255,.98)', 'rgba(240,245,236,.94)']} end={{x: 1, y: 1}} start={{x: 0, y: 0}} style={styles.header}><View><Text style={styles.brand}>SmartLife</Text><Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>{right ?? <Pressable onPress={() => onNavigate('smartlife_profile')} style={styles.avatar}><Text style={styles.avatarText}>SL</Text></Pressable>}</LinearGradient>;
}

export function Card({children, style, colors = ['rgba(255,255,255,.98)', '#f8faf5']}: {children: ReactNode; style?: object; colors?: readonly [string, string, ...string[]]}) {
  return <LinearGradient colors={colors} end={{x: 1, y: 1}} start={{x: 0, y: 0}} style={[styles.card, style]}>{children}</LinearGradient>;
}

export function PrimaryButton({label, onPress, disabled = false}: {label: string; onPress: () => void; disabled?: boolean}) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.primary, disabled && styles.disabled]}><LinearGradient colors={['#789a75', '#4d7148']} end={{x: 1, y: 1}} start={{x: 0, y: 0}} style={styles.primaryGradient}><Text style={styles.primaryText}>{label}</Text></LinearGradient></Pressable>;
}

export function LoadingBlock({label = 'กำลังโหลดข้อมูลจาก Firebase'}: {label?: string}) {
  return <View style={styles.loading}><ActivityIndicator color="#668d65" size="large" /><Text style={styles.muted}>{label}</Text></View>;
}

export function EmptyBlock({label}: {label: string}) {
  return <Text style={styles.empty}>{label}</Text>;
}

export function LegacyUserTabBar({active, onNavigate}: {active?: string; onNavigate: UserNavigate}) {
  const tabs = [
    ['home', 'หน้าหลัก', 'index'],
    ['calendar_month', 'ตารางเวลา', 'smartlife_calendar_day'],
    ['add', '', 'smartlife_scan_schedule'],
    ['account_balance_wallet', 'การเงิน', 'smartlife_finance_day'],
    ['note_alt', 'โน้ต', 'smartlife_notes'],
    ['person', 'โปรไฟล์', 'smartlife_profile'],
  ];
  const widths = ['20%', '20%', '20%', '13.333%', '13.333%', '13.334%'] as const;
  return <LinearGradient colors={['rgba(255,255,255,.99)', '#f7f9f4']} end={{x: 1, y: 0}} start={{x: 0, y: 0}} style={styles.tabs}>{tabs.map(([icon, label, page], index) => <Pressable key={page} onPress={() => onNavigate(page)} style={({pressed}) => [styles.tab, {width: widths[index]}, pressed && styles.tabPressed]}>{index === 2 ? <LinearGradient colors={['#71936e', '#3f633a']} end={{x: 1, y: 1}} start={{x: 0, y: 0}} style={styles.plus}><MaterialIcon color="#fff" name="add" size={31} /></LinearGradient> : <><MaterialIcon color={active === page ? '#5f835f' : '#9ea59b'} name={icon} size={20} /><Text numberOfLines={1} style={[styles.tabLabel, active === page && styles.active]}>{label}</Text></>}</Pressable>)}</LinearGradient>;
}

// Added for Merged Planner: a symmetrical 2-1-2 navigation with a central OCR scanner.
export function UserTabBar({active, onNavigate}: {active?: string; onNavigate: UserNavigate}) {
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
  const leftTabs = [['home', 'หน้าหลัก', 'index'], ['calendar_month', 'แพลนเนอร์', 'smartlife_planner']];
  const rightTabs = [['account_balance_wallet', 'การเงิน', 'smartlife_finance_day'], ['person', 'โปรไฟล์', 'smartlife_profile']];
  const openForm = (page: string) => { setIsBottomSheetOpen(false); onNavigate(page); };
  const renderTab = ([icon, label, page]: string[]) => <Pressable key={page} onPress={() => onNavigate(page)} style={({pressed}) => [styles.tab, pressed && styles.tabPressed]}><MaterialIcon color={active === page ? '#5f835f' : '#9ea59b'} name={icon} size={20} /><Text numberOfLines={1} style={[styles.tabLabel, active === page && styles.active]}>{label}</Text></Pressable>;
  return <>
    <LinearGradient colors={['rgba(255,255,255,.99)', '#f7f9f4']} end={{x: 1, y: 0}} start={{x: 0, y: 0}} style={styles.tabs}>
      {leftTabs.map(renderTab)}
      {/* The centre action opens a clear add menu so users do not have to guess which screen to use. */}
      <Pressable accessibilityLabel="เปิดเมนูเพิ่มข้อมูล" onPress={() => setIsBottomSheetOpen(true)} style={({pressed}) => [styles.tab, pressed && styles.tabPressed]}><LinearGradient colors={['#71936e', '#3f633a']} end={{x: 1, y: 1}} start={{x: 0, y: 0}} style={styles.plus}><MaterialIcon color="#fff" name="add" size={31} /></LinearGradient></Pressable>
      {rightTabs.map(renderTab)}
    </LinearGradient>
    <Modal animationType="fade" onRequestClose={() => setIsBottomSheetOpen(false)} transparent visible={isBottomSheetOpen}>
      <Pressable accessibilityLabel="ปิดเมนูเพิ่มรายการ" onPress={() => setIsBottomSheetOpen(false)} style={styles.sheetBackdrop}>
        <View onStartShouldSetResponder={() => true} style={styles.addSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>เพิ่มรายการใหม่</Text>
          <Text style={styles.sheetSubtitle}>เลือกสิ่งที่คุณต้องการบันทึก</Text>
          <Pressable onPress={() => openForm('smartlife_scan_schedule')} style={({pressed}) => [styles.sheetOption, pressed && styles.tabPressed]}><View style={[styles.sheetIcon, {backgroundColor: '#e8ecf7'}]}><MaterialIcon color="#6572ad" name="document_scanner" size={22} /></View><View style={styles.sheetCopy}><Text style={styles.sheetOptionTitle}>Smart Scan</Text><Text style={styles.sheetOptionSub}>สแกนตารางเรียน ใบเสร็จ หรือเอกสารให้ AI อ่าน</Text></View><MaterialIcon color="#8b988b" name="chevron_right" size={22} /></Pressable>
          <Pressable onPress={() => openForm('smartlife_add_activity')} style={({pressed}) => [styles.sheetOption, pressed && styles.tabPressed]}><View style={[styles.sheetIcon, {backgroundColor: '#e5efe2'}]}><MaterialIcon color="#52734b" name="event" size={22} /></View><View style={styles.sheetCopy}><Text style={styles.sheetOptionTitle}>กิจกรรม/ตารางใหม่</Text><Text style={styles.sheetOptionSub}>เพิ่มคลาส นัดหมาย หรือกิจกรรมที่มีเวลา</Text></View><MaterialIcon color="#8b988b" name="chevron_right" size={22} /></Pressable>
          <Pressable onPress={() => openForm('smartlife_add_task')} style={({pressed}) => [styles.sheetOption, pressed && styles.tabPressed]}><View style={[styles.sheetIcon, {backgroundColor: '#f3e8e8'}]}><MaterialIcon color="#bb7777" name="check_box" size={22} /></View><View style={styles.sheetCopy}><Text style={styles.sheetOptionTitle}>เพิ่มงาน</Text><Text style={styles.sheetOptionSub}>งานส่ง การบ้าน Quiz หรือสิ่งที่ AI Dynamic ต้องจัดลำดับ</Text></View><MaterialIcon color="#8b988b" name="chevron_right" size={22} /></Pressable>
          <Pressable onPress={() => openForm('smartlife_add_income')} style={({pressed}) => [styles.sheetOption, pressed && styles.tabPressed]}><View style={[styles.sheetIcon, {backgroundColor: '#eceef7'}]}><MaterialIcon color="#6572ad" name="account_balance_wallet" size={22} /></View><View style={styles.sheetCopy}><Text style={styles.sheetOptionTitle}>เพิ่มรายรับ</Text><Text style={styles.sheetOptionSub}>บันทึกเงินเข้าเอง ส่วนรายจ่ายใช้ Smart Scan หรือหน้าการเงิน</Text></View><MaterialIcon color="#8b988b" name="chevron_right" size={22} /></Pressable>
          <Pressable onPress={() => openForm('smartlife_add_note')} style={({pressed}) => [styles.sheetOption, pressed && styles.tabPressed]}><View style={[styles.sheetIcon, {backgroundColor: '#f5e8e8'}]}><MaterialIcon color="#bb7777" name="edit_note" size={22} /></View><View style={styles.sheetCopy}><Text style={styles.sheetOptionTitle}>โน้ตใหม่</Text><Text style={styles.sheetOptionSub}>บันทึกไอเดียและเรื่องสำคัญ</Text></View><MaterialIcon color="#8b988b" name="chevron_right" size={22} /></Pressable>
        </View>
      </Pressable>
    </Modal>
  </>;
}

export const userStyles = StyleSheet.create({
  actionRow: {flexDirection: 'row', gap: 10, marginTop: 14},
  badge: {alignSelf: 'flex-start', backgroundColor: '#e5efe2', borderRadius: 99, color: '#52734b', fontSize: 11, fontWeight: '800', paddingHorizontal: 9, paddingVertical: 5},
  bodyText: {color: '#6f796b', fontFamily: 'Prompt_400Regular', fontSize: 13, lineHeight: 20, marginTop: 5},
  cardTitle: {color: '#29351f', fontFamily: 'Prompt_700Bold', fontSize: 17},
  field: {backgroundColor: '#f7f8f5', borderColor: '#e1e6dc', borderRadius: 13, borderWidth: 1, color: '#33412e', fontSize: 14, marginTop: 7, minHeight: 48, paddingHorizontal: 14},
  label: {color: '#4c5748', fontFamily: 'Prompt_600SemiBold', fontSize: 12, marginTop: 15},
  muted: {color: '#818a7d', fontFamily: 'Prompt_400Regular', fontSize: 12, lineHeight: 18},
  row: {alignItems: 'center', backgroundColor: '#f7f9f4', borderRadius: 13, flexDirection: 'row', gap: 11, marginTop: 10, padding: 13},
  rowDot: {borderRadius: 5, height: 10, width: 10},
  rowMain: {color: '#33412e', flex: 1, fontFamily: 'Prompt_600SemiBold', fontSize: 14},
  rowSide: {color: '#668d65', fontFamily: 'Prompt_600SemiBold', fontSize: 12},
  rowSub: {color: '#7c8679', fontFamily: 'Prompt_400Regular', fontSize: 11, lineHeight: 16, marginTop: 2},
  sectionTitle: {color: '#29351f', fontFamily: 'Prompt_700Bold', fontSize: 22, marginTop: 5},
  segmented: {backgroundColor: '#e7ede4', borderRadius: 14, flexDirection: 'row', marginTop: 14, padding: 4},
  segment: {alignItems: 'center', borderRadius: 10, flex: 1, paddingVertical: 9},
  segmentActive: {backgroundColor: '#fff'},
  segmentText: {color: '#7f8b7c', fontFamily: 'Prompt_600SemiBold', fontSize: 12},
  segmentTextActive: {color: '#52734b'},
});

const styles = StyleSheet.create({
  active: {color: '#4f754b'},
  addSheet: {backgroundColor: '#fbfcf8', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, paddingBottom: 34, width: '100%'},
  avatar: {alignItems: 'center', backgroundColor: '#e8efe4', borderRadius: 22, height: 44, justifyContent: 'center', width: 44},
  avatarText: {color: '#52734b', fontFamily: 'Prompt_700Bold'},
  body: {flex: 1, padding: 18},
  bodyEdge: {padding: 0},
  brand: {color: '#668d65', fontFamily: 'Prompt_600SemiBold', fontSize: 13},
  card: {borderColor: 'rgba(255,255,255,.8)', borderRadius: 18, borderWidth: 1, boxShadow: '0 8px 18px rgba(44, 52, 27, 0.07)', marginTop: 14, padding: 16},
  disabled: {opacity: .55},
  empty: {color: '#879082', fontFamily: 'Prompt_400Regular', fontSize: 13, paddingVertical: 20, textAlign: 'center'},
  flatSurface: {backgroundColor: '#f4f7f4'},
  header: {alignItems: 'center', borderBottomColor: '#e5e9e1', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 18},
  loading: {alignItems: 'center', gap: 12, paddingTop: 90},
  muted: {color: '#808a7b', fontFamily: 'Prompt_400Regular', fontSize: 12},
  plus: {alignItems: 'center', borderColor: '#fff', borderRadius: 31, borderWidth: 5, boxShadow: '0 8px 13px rgba(35, 48, 30, 0.28)', height: 62, justifyContent: 'center', marginTop: -27, width: 62},
  primary: {borderRadius: 14, marginTop: 15, overflow: 'hidden'},
  primaryGradient: {alignItems: 'center', justifyContent: 'center', minHeight: 50},
  primaryText: {color: '#fff', fontFamily: 'Prompt_700Bold', fontSize: 15},
  safe: {backgroundColor: '#f0f2ec', flex: 1},
  scroll: {flexGrow: 1, paddingBottom: 12},
  shell: {backgroundColor: '#f0f2ec', flex: 1},
  sheetBackdrop: {backgroundColor: 'rgba(20,31,20,.42)', flex: 1, justifyContent: 'flex-end'},
  sheetCopy: {flex: 1},
  sheetHandle: {alignSelf: 'center', backgroundColor: '#d8e0d6', borderRadius: 4, height: 4, marginBottom: 15, width: 42},
  sheetIcon: {alignItems: 'center', borderRadius: 15, height: 44, justifyContent: 'center', width: 44},
  sheetOption: {alignItems: 'center', backgroundColor: '#fff', borderColor: '#e8ede5', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 11, marginTop: 10, padding: 12},
  sheetOptionSub: {color: '#879087', fontFamily: 'Prompt_400Regular', fontSize: 11, lineHeight: 16, marginTop: 1},
  sheetOptionTitle: {color: '#2c341b', fontFamily: 'Prompt_700Bold', fontSize: 13},
  sheetSubtitle: {color: '#818b7f', fontFamily: 'Prompt_400Regular', fontSize: 11, marginTop: 2},
  sheetTitle: {color: '#29351f', fontFamily: 'Prompt_700Bold', fontSize: 17},
  subtitle: {color: '#84907f', fontFamily: 'Prompt_400Regular', fontSize: 12, marginTop: 3},
  tab: {alignItems: 'center', flex: 1, justifyContent: 'center'},
  tabLabel: {color: '#9aa39a', fontFamily: 'Prompt_500Medium', fontSize: 10, marginTop: 4, textAlign: 'center'},
  tabPressed: {opacity: .65, transform: [{translateY: -1}]},
  tabs: {alignItems: 'center', borderTopColor: '#e2e6df', borderTopWidth: 1, boxShadow: '0 -8px 18px rgba(44, 52, 27, 0.07)', flexDirection: 'row', height: 78, paddingHorizontal: 0},
  title: {color: '#29351f', fontFamily: 'Prompt_700Bold', fontSize: 23, marginTop: 2},
});
