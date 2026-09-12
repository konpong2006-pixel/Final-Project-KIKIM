import {ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';

import type {ScheduleConflict} from '@/services/firestore';
import {MaterialIcon} from '@/screens/native/user/user-ui';

function timeRange(startAt: string, endAt: string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: 'short',
    timeZone,
    year: 'numeric',
  });
  const timeOnly = new Intl.DateTimeFormat('th-TH', {hour: '2-digit', hour12: false, minute: '2-digit', timeZone});
  return `${formatter.format(new Date(startAt))}–${timeOnly.format(new Date(endAt))} น.`;
}

export default function ScheduleConflictDialog({
  conflicts,
  onConfirm,
  onEdit,
  proposedEndAt,
  proposedStartAt,
  saving = false,
  timeZone = 'Asia/Bangkok',
  visible,
}: {
  conflicts: ScheduleConflict[];
  onConfirm: () => void;
  onEdit: () => void;
  proposedEndAt: string;
  proposedStartAt: string;
  saving?: boolean;
  timeZone?: string;
  visible: boolean;
}) {
  return <Modal animationType="fade" onRequestClose={saving ? undefined : onEdit} transparent visible={visible}>
    <View style={styles.overlay}>
      <View accessibilityRole="alert" style={styles.card}>
        <View style={styles.icon}><MaterialIcon color="#a45e58" name="event_busy" size={31} /></View>
        <Text style={styles.title}>เวลานี้มีรายการทับซ้อน</Text>
        <Text style={styles.description}>คุณกำลังจะบันทึกรายการใหม่ในช่วง {timeRange(proposedStartAt, proposedEndAt, timeZone)} ซึ่งทับกับรายการต่อไปนี้</Text>
        <ScrollView style={styles.list}>
          {conflicts.map((conflict) => <View key={`${conflict.kind}-${conflict.id}`} style={styles.conflict}>
            <View style={styles.conflictIcon}><MaterialIcon color="#9a664a" name={conflict.kind === 'schedule' ? 'school' : 'event'} size={18} /></View>
            <View style={{flex: 1}}><Text style={styles.conflictTitle}>{conflict.title}</Text><Text style={styles.conflictTime}>{timeRange(conflict.startAt, conflict.endAt, timeZone)}</Text></View>
          </View>)}
        </ScrollView>
        <Text style={styles.note}>กิจกรรมพร้อมกันทำได้ เช่น ฟังพอดแคสต์ระหว่างเดินทาง แต่ต้องยืนยันอีกครั้งก่อนบันทึก</Text>
        <View style={styles.actions}>
          <Pressable accessibilityLabel="กลับไปแก้เวลา" disabled={saving} onPress={onEdit} style={[styles.editButton, saving && styles.disabled]}><MaterialIcon color="#557653" name="edit_calendar" size={18} /><Text style={styles.editText}>กลับไปแก้เวลา</Text></Pressable>
          <Pressable accessibilityLabel="ยืนยันบันทึกรายการซ้อนกัน" disabled={saving} onPress={onConfirm} style={[styles.confirmButton, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" size="small" /> : <MaterialIcon color="#fff" name="warning" size={18} />}<Text style={styles.confirmText}>{saving ? 'กำลังบันทึก…' : 'บันทึกซ้อนกัน'}</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  actions: {flexDirection: 'row', gap: 10, marginTop: 16},
  card: {backgroundColor: '#fbfcf7', borderRadius: 28, maxHeight: '82%', maxWidth: 560, padding: 22, width: '92%'},
  confirmButton: {alignItems: 'center', backgroundColor: '#a45e58', borderRadius: 16, flex: 1.15, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 52, paddingHorizontal: 12},
  confirmText: {color: '#fff', fontSize: 14, fontWeight: '800'},
  conflict: {alignItems: 'center', backgroundColor: '#fff5eb', borderColor: '#efd8c4', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 10, marginBottom: 8, padding: 12},
  conflictIcon: {alignItems: 'center', backgroundColor: '#f8e6d5', borderRadius: 20, height: 36, justifyContent: 'center', width: 36},
  conflictTime: {color: '#806f63', fontSize: 12, marginTop: 3},
  conflictTitle: {color: '#3d493a', fontSize: 14, fontWeight: '800'},
  description: {color: '#687165', fontSize: 14, lineHeight: 21, marginBottom: 12, textAlign: 'center'},
  disabled: {opacity: .55},
  editButton: {alignItems: 'center', backgroundColor: '#edf3e9', borderRadius: 16, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 52, paddingHorizontal: 10},
  editText: {color: '#4e694c', fontSize: 14, fontWeight: '800'},
  icon: {alignItems: 'center', alignSelf: 'center', backgroundColor: '#fde7e3', borderRadius: 32, height: 64, justifyContent: 'center', marginBottom: 12, width: 64},
  list: {maxHeight: 230},
  note: {backgroundColor: '#f1f5ed', borderRadius: 14, color: '#667463', fontSize: 12, lineHeight: 18, marginTop: 4, padding: 11},
  overlay: {alignItems: 'center', backgroundColor: 'rgba(32, 40, 31, .58)', flex: 1, justifyContent: 'center', padding: 16},
  title: {color: '#344131', fontSize: 23, fontWeight: '900', marginBottom: 8, textAlign: 'center'},
});
