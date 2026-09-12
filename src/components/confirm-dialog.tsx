import {ActivityIndicator, Modal, Pressable, StyleSheet, Text, View} from 'react-native';

import {MaterialIcon} from '@/screens/native/user/user-ui';

/**
 * The app's confirmation dialog, for anything destructive enough to ask first.
 *
 * `Alert.alert` cannot be used for this. react-native-web's Alert is literally
 * `class Alert { static alert() {} }` -- an empty method -- so on web every
 * confirmation built on it silently did nothing: no dialog appeared and the
 * `onPress` carrying the actual delete was never reachable. That is why
 * deleting was reported as "not working on the web" while working on Android;
 * the delete call itself was fine, it was simply never invoked.
 *
 * `Modal` has a real react-native-web implementation, so this renders and
 * behaves the same on web, Android and iOS, the same way
 * `ScheduleConflictDialog` already does for the overlapping-save prompt.
 */
export default function ConfirmDialog({
  busy = false,
  cancelLabel = 'ยกเลิก',
  confirmLabel,
  extraAction,
  icon = 'delete_forever',
  message,
  onCancel,
  onConfirm,
  title,
  tone = 'danger',
  visible,
}: {
  busy?: boolean;
  cancelLabel?: string;
  confirmLabel: string;
  /**
   * A third choice, for the handful of prompts that offer two ways forward
   * rather than one. Its presence stacks the buttons, because three of them
   * side by side leaves no room for a readable Thai label.
   */
  extraAction?: {icon?: string; label: string; onPress: () => void};
  icon?: string;
  message?: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  tone?: 'danger' | 'neutral';
  visible: boolean;
}) {
  const danger = tone === 'danger';
  const stacked = Boolean(extraAction);
  return <Modal animationType="fade" onRequestClose={busy ? undefined : onCancel} statusBarTranslucent transparent visible={visible}>
    {/* Tapping the backdrop cancels; `onStartShouldSetResponder` keeps a tap
        inside the card from bubbling out to it. */}
    <Pressable accessibilityLabel="ปิดหน้าต่างยืนยัน" onPress={busy ? undefined : onCancel} style={styles.overlay}>
      <View accessibilityRole="alert" onStartShouldSetResponder={() => true} style={styles.card}>
        <View style={[styles.icon, danger ? styles.iconDanger : styles.iconNeutral]}>
          <MaterialIcon color={danger ? '#b85f60' : '#557653'} name={icon} size={30} />
        </View>
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={[styles.actions, stacked && styles.actionsStacked]}>
          <Pressable accessibilityLabel={confirmLabel} accessibilityRole="button" disabled={busy} onPress={onConfirm} style={[styles.confirm, stacked && styles.full, danger ? styles.confirmDanger : styles.confirmNeutral, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <MaterialIcon color="#fff" name={icon} size={18} />}
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </Pressable>
          {extraAction ? <Pressable accessibilityLabel={extraAction.label} accessibilityRole="button" disabled={busy} onPress={extraAction.onPress} style={[styles.extra, styles.full, busy && styles.disabled]}>
            <MaterialIcon color="#4e694c" name={extraAction.icon ?? 'edit_note'} size={18} />
            <Text style={styles.extraText}>{extraAction.label}</Text>
          </Pressable> : null}
          <Pressable accessibilityLabel={cancelLabel} accessibilityRole="button" disabled={busy} onPress={onCancel} style={[styles.cancel, stacked && styles.full, busy && styles.disabled]}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  actions: {flexDirection: 'row-reverse', gap: 10, marginTop: 18},
  actionsStacked: {flexDirection: 'column'},
  cancel: {alignItems: 'center', backgroundColor: '#edf3e9', borderRadius: 16, flex: 1, justifyContent: 'center', minHeight: 52, paddingHorizontal: 10},
  cancelText: {color: '#4e694c', fontSize: 14, fontWeight: '800'},
  card: {backgroundColor: '#fbfcf7', borderRadius: 28, maxWidth: 460, padding: 22, width: '92%'},
  confirm: {alignItems: 'center', borderRadius: 16, flex: 1.15, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 52, paddingHorizontal: 12},
  confirmDanger: {backgroundColor: '#a95758'},
  confirmNeutral: {backgroundColor: '#557653'},
  confirmText: {color: '#fff', fontSize: 14, fontWeight: '800'},
  disabled: {opacity: .55},
  extra: {alignItems: 'center', backgroundColor: '#eef3fa', borderRadius: 16, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 52, paddingHorizontal: 12},
  extraText: {color: '#4e694c', fontSize: 14, fontWeight: '800'},
  full: {flex: 0, width: '100%'},
  icon: {alignItems: 'center', alignSelf: 'center', borderRadius: 32, height: 64, justifyContent: 'center', marginBottom: 12, width: 64},
  iconDanger: {backgroundColor: '#fde7e3'},
  iconNeutral: {backgroundColor: '#e5efe2'},
  message: {color: '#687165', fontSize: 14, lineHeight: 21, textAlign: 'center'},
  overlay: {alignItems: 'center', backgroundColor: 'rgba(32, 40, 31, .58)', flex: 1, justifyContent: 'center', padding: 16},
  title: {color: '#344131', fontSize: 21, fontWeight: '900', marginBottom: 8, textAlign: 'center'},
});
