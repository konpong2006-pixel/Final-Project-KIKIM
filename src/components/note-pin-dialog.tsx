import {useState} from 'react';
import {ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';

import {MaterialIcon} from '@/screens/native/user/user-ui';

/**
 * Asks for the note PIN, or sets one for the first time.
 *
 * Built on `Modal` rather than `Alert.prompt`, which does not exist on Android
 * at all and is an empty function on react-native-web -- the same trap that
 * broke every confirmation in this app before. One implementation, identical on
 * Android and in the browser.
 */
export default function NotePinDialog(props: {
  busy?: boolean;
  error?: string;
  /** `set` asks twice and confirms; `unlock` asks once. */
  mode: 'set' | 'unlock';
  onCancel: () => void;
  onSubmit: (pin: string) => void;
  visible: boolean;
}) {
  // The form lives in a child that only exists while the dialog is open, so a
  // typed PIN is destroyed with the component rather than lingering in state
  // and having to be cleared.
  if (!props.visible) return null;
  return <PinForm {...props} />;
}

function PinForm({
  busy = false,
  error = '',
  mode,
  onCancel,
  onSubmit,
}: {
  busy?: boolean;
  error?: string;
  mode: 'set' | 'unlock';
  onCancel: () => void;
  onSubmit: (pin: string) => void;
  visible: boolean;
}) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [localError, setLocalError] = useState('');

  const submit = () => {
    if (mode === 'set' && pin !== confirmPin) {
      setLocalError('รหัสสองช่องไม่ตรงกัน');
      return;
    }
    setLocalError('');
    onSubmit(pin);
  };

  const shown = localError || error;
  const ready = pin.trim().length > 0 && (mode === 'unlock' || confirmPin.trim().length > 0);

  return <Modal animationType="fade" onRequestClose={busy ? undefined : onCancel} statusBarTranslucent transparent visible>
    <Pressable accessibilityLabel="ปิดหน้าต่างรหัส" onPress={busy ? undefined : onCancel} style={styles.overlay}>
      <View accessibilityRole="alert" onStartShouldSetResponder={() => true} style={styles.card}>
        <View style={styles.icon}><MaterialIcon color="#557653" name={mode === 'set' ? 'lock_reset' : 'lock'} size={28} /></View>
        <Text style={styles.title}>{mode === 'set' ? 'ตั้งรหัสล็อกโน้ต' : 'ใส่รหัสเพื่อเปิดโน้ต'}</Text>
        <Text style={styles.message}>
          {mode === 'set'
            ? 'ใช้รหัสเดียวกันกับโน้ตที่ล็อกทุกอัน ใช้ได้ทั้งบนแอปและบนเว็บ'
            : 'โน้ตนี้ถูกล็อกไว้ ใส่รหัสที่ตั้งไว้เพื่อเปิดอ่าน'}
        </Text>

        <TextInput
          accessibilityLabel="ช่องกรอกรหัส"
          autoFocus
          onChangeText={setPin}
          onSubmitEditing={mode === 'unlock' ? submit : undefined}
          placeholder="รหัสอย่างน้อย 4 ตัว"
          placeholderTextColor="#9aa39a"
          secureTextEntry
          style={styles.input}
          value={pin}
        />
        {mode === 'set' ? <TextInput
          accessibilityLabel="ช่องยืนยันรหัส"
          onChangeText={setConfirmPin}
          onSubmitEditing={submit}
          placeholder="ยืนยันรหัสอีกครั้ง"
          placeholderTextColor="#9aa39a"
          secureTextEntry
          style={styles.input}
          value={confirmPin}
        /> : null}

        {shown ? <Text style={styles.error}>{shown}</Text> : null}

        <View style={styles.actions}>
          <Pressable accessibilityLabel={mode === 'set' ? 'บันทึกรหัส' : 'ปลดล็อก'} accessibilityRole="button" disabled={busy || !ready} onPress={submit} style={[styles.confirm, (busy || !ready) && styles.disabled]}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <MaterialIcon color="#fff" name={mode === 'set' ? 'check' : 'lock_open'} size={18} />}
            <Text style={styles.confirmText}>{mode === 'set' ? 'บันทึกรหัส' : 'ปลดล็อก'}</Text>
          </Pressable>
          <Pressable accessibilityLabel="ยกเลิก" accessibilityRole="button" disabled={busy} onPress={onCancel} style={[styles.cancel, busy && styles.disabled]}>
            <Text style={styles.cancelText}>ยกเลิก</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  actions: {flexDirection: 'row-reverse', gap: 10, marginTop: 16},
  cancel: {alignItems: 'center', backgroundColor: '#edf3e9', borderRadius: 16, flex: 1, justifyContent: 'center', minHeight: 50},
  cancelText: {color: '#4e694c', fontFamily: 'Prompt_700Bold', fontSize: 13},
  card: {backgroundColor: '#fbfcf7', borderRadius: 28, maxWidth: 420, padding: 22, width: '92%'},
  confirm: {alignItems: 'center', backgroundColor: '#557653', borderRadius: 16, flex: 1.15, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 50},
  confirmText: {color: '#fff', fontFamily: 'Prompt_700Bold', fontSize: 13},
  disabled: {opacity: .55},
  error: {color: '#b85f60', fontFamily: 'Prompt_600SemiBold', fontSize: 11, marginTop: 10, textAlign: 'center'},
  icon: {alignItems: 'center', alignSelf: 'center', backgroundColor: '#e5efe2', borderRadius: 30, height: 60, justifyContent: 'center', marginBottom: 12, width: 60},
  input: {backgroundColor: '#f4f7f1', borderColor: '#dfe6dc', borderRadius: 14, borderWidth: 1, color: '#344131', fontFamily: 'Prompt_600SemiBold', fontSize: 15, marginTop: 10, minHeight: 50, paddingHorizontal: 14},
  message: {color: '#687165', fontFamily: 'Prompt_400Regular', fontSize: 12, lineHeight: 19, textAlign: 'center'},
  overlay: {alignItems: 'center', backgroundColor: 'rgba(32, 40, 31, .58)', flex: 1, justifyContent: 'center', padding: 16},
  title: {color: '#344131', fontFamily: 'Prompt_800ExtraBold', fontSize: 19, marginBottom: 6, textAlign: 'center'},
});
