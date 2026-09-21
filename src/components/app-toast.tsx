import {useEffect, useState} from 'react';
import {AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Touchable} from '@/components/touchable';
import {MaterialIcon} from '@/screens/native/user/user-ui';

/**
 * The app's one-way notification: "saved", "could not save", "check your
 * connection". Anything that asks a question belongs in `ConfirmDialog`
 * instead.
 *
 * These were all `Alert.alert`, which react-native-web implements as
 * `static alert() {}` -- an empty method -- so on web every one of them was
 * silently dropped: a failed save, a failed delete and a failed sync all
 * looked exactly like success. This renders from plain `View`/`Animated`, so
 * the same message appears on web, Android and iOS.
 *
 * The API is imperative on purpose. It is a near drop-in for the
 * `Alert.alert(title, message)` calls it replaces, so a call site does not have
 * to grow a piece of state and a rendered element just to report an error, and
 * it can be called from outside React (a `.catch` in a service, a callback in a
 * module) the way `Alert.alert` could.
 */

export type ToastTone = 'error' | 'info' | 'success';
export type ToastAction = {label: string; onPress: () => void};
type Toast = {action?: ToastAction; id: number; message?: string; title: string; tone: ToastTone};

const VISIBLE_MS = 4000;
const listeners = new Set<(toast: Toast | null) => void>();
let current: Toast | null = null;
let nextId = 0;

function publish(toast: Toast | null) {
  current = toast;
  for (const listener of listeners) listener(toast);
}

/**
 * Shows a toast. Safe to call from anywhere, including outside React.
 *
 * `action` turns a one-way notice into a low-friction undo: a low-stakes,
 * reversible outcome (e.g. a duplicate transaction that was auto-skipped) can
 * report itself and offer a way back, instead of blocking on a dialog before
 * the outcome is even known.
 */
export function showToast(title: string, message?: string, tone: ToastTone = 'error', action?: ToastAction) {
  if (!title && !message) return;
  nextId += 1;
  publish({action, id: nextId, message, title, tone});
}

/** Turns an unknown thrown value into the message these toasts want. */
export function toastMessage(error: unknown, fallback = 'กรุณาลองใหม่อีกครั้ง') {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function dismissToast() {
  publish(null);
}

const TONES: Record<ToastTone, {accent: string; background: string; border: string; icon: string}> = {
  error: {accent: '#a95758', background: '#fdf1ef', border: '#f0d4cf', icon: 'error_outline'},
  info: {accent: '#4f6b86', background: '#eef3f9', border: '#d3e0ec', icon: 'info'},
  success: {accent: '#4e754b', background: '#eef6ea', border: '#d5e6cf', icon: 'check_circle'},
};

/**
 * Mounted once at the app root. Renders whatever `showToast` last published,
 * above the current screen and without swallowing taps meant for it.
 */
export default function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(current);
  // Held as lazily-initialised state, not a ref: the value is read during
  // render to build the animated style, which the compiler forbids for refs.
  const [progress] = useState(() => new Animated.Value(0));
  const [iconBounce] = useState(() => new Animated.Value(0));
  const [shake] = useState(() => new Animated.Value(0));

  useEffect(() => {
    listeners.add(setToast);
    return () => {
      listeners.delete(setToast);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    // react-native-web has no native driver; asking for one there only earns a
    // warning and a fall back to JS anyway.
    const useNativeDriver = Platform.OS !== 'web';
    progress.setValue(0);
    iconBounce.setValue(0);
    Animated.parallel([
      Animated.timing(progress, {duration: 210, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver}),
      Animated.spring(iconBounce, {damping: 9, mass: 0.6, stiffness: 220, toValue: 1, useNativeDriver}),
    ]).start();

    // A failed save or a rejected input gets a short sideways shake once the
    // card has landed, so it reads as "no" without waiting to be read. Skipped
    // when the OS asks for reduced motion.
    let cancelled = false;
    shake.setValue(0);
    if (toast.tone === 'error') {
      AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
        if (cancelled || reduced) return;
        Animated.sequence([
          Animated.delay(120),
          Animated.timing(shake, {duration: 45, toValue: 1, useNativeDriver}),
          Animated.timing(shake, {duration: 70, toValue: -1, useNativeDriver}),
          Animated.timing(shake, {duration: 70, toValue: 0.6, useNativeDriver}),
          Animated.timing(shake, {duration: 60, toValue: -0.3, useNativeDriver}),
          Animated.timing(shake, {duration: 45, toValue: 0, useNativeDriver}),
        ]).start();
      }).catch(() => undefined);
    }

    const timer = setTimeout(() => {
      Animated.timing(progress, {duration: 190, easing: Easing.in(Easing.quad), toValue: 0, useNativeDriver}).start(({finished}) => {
        // Only clear if this is still the toast that was showing, so a newer
        // one published mid-fade is not wiped out by the old one's timer.
        if (finished && current?.id === toast.id) publish(null);
      });
    }, VISIBLE_MS);
    return () => { cancelled = true; shake.stopAnimation(); clearTimeout(timer); };
  }, [iconBounce, progress, shake, toast]);

  if (!toast) return null;
  const tone = TONES[toast.tone];
  return (
    <View pointerEvents="box-none" style={[styles.host, {paddingTop: insets.top + 10}]}>
      <Animated.View
        style={[styles.animated, {
          opacity: progress,
          transform: [
            {translateY: progress.interpolate({inputRange: [0, 1], outputRange: [-20, 0]})},
            {scale: progress.interpolate({inputRange: [0, 1], outputRange: [0.93, 1]})},
            {translateX: shake.interpolate({inputRange: [-1, 1], outputRange: [-7, 7]})},
          ],
        }]}
      >
        <View accessibilityRole="alert" style={[styles.card, {backgroundColor: tone.background, borderColor: tone.border}]}>
          <Animated.View style={{transform: [{scale: iconBounce}]}}>
            <MaterialIcon color={tone.accent} name={tone.icon} size={22} />
          </Animated.View>
          <View style={styles.copy}>
            <Text style={[styles.title, {color: tone.accent}]}>{toast.title}</Text>
            {toast.message ? <Text numberOfLines={3} style={styles.message}>{toast.message}</Text> : null}
          </View>
          {toast.action ? (
            <Touchable accessibilityLabel={toast.action.label} onPress={() => { toast.action?.onPress(); dismissToast(); }} style={styles.actionButton}>
              <Text style={[styles.actionText, {color: tone.accent}]}>{toast.action.label}</Text>
            </Touchable>
          ) : null}
          <Touchable accessibilityLabel={`ปิดข้อความ ${toast.title}`} hitSlop={10} onPress={dismissToast}>
            <MaterialIcon color="#97a094" name="close" size={17} />
          </Touchable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {paddingHorizontal: 4, paddingVertical: 4},
  actionText: {fontSize: 12.5, fontWeight: '800', textDecorationLine: 'underline'},
  animated: {maxWidth: 520, width: '100%'},
  card: {alignItems: 'center', borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 11, paddingHorizontal: 15, paddingVertical: 13, shadowColor: '#20281f', shadowOffset: {height: 8, width: 0}, shadowOpacity: .16, shadowRadius: 18},
  copy: {flex: 1},
  host: {alignItems: 'center', left: 0, paddingHorizontal: 14, position: 'absolute', right: 0, top: 0, zIndex: 9999},
  message: {color: '#5d675b', fontSize: 12.5, lineHeight: 18, marginTop: 2},
  title: {fontSize: 14, fontWeight: '800'},
});
