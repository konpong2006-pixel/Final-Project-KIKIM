import {useEffect, useState} from 'react';
import {Animated, Easing, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

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
type Toast = {id: number; message?: string; title: string; tone: ToastTone};

const VISIBLE_MS = 4000;
const listeners = new Set<(toast: Toast | null) => void>();
let current: Toast | null = null;
let nextId = 0;

function publish(toast: Toast | null) {
  current = toast;
  for (const listener of listeners) listener(toast);
}

/** Shows a toast. Safe to call from anywhere, including outside React. */
export function showToast(title: string, message?: string, tone: ToastTone = 'error') {
  if (!title && !message) return;
  nextId += 1;
  publish({id: nextId, message, title, tone});
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
    Animated.timing(progress, {duration: 190, easing: Easing.out(Easing.quad), toValue: 1, useNativeDriver}).start();
    const timer = setTimeout(() => {
      Animated.timing(progress, {duration: 190, easing: Easing.in(Easing.quad), toValue: 0, useNativeDriver}).start(({finished}) => {
        // Only clear if this is still the toast that was showing, so a newer
        // one published mid-fade is not wiped out by the old one's timer.
        if (finished && current?.id === toast.id) publish(null);
      });
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [progress, toast]);

  if (!toast) return null;
  const tone = TONES[toast.tone];
  return (
    <View pointerEvents="box-none" style={[styles.host, {paddingTop: insets.top + 10}]}>
      <Animated.View
        style={[styles.animated, {
          opacity: progress,
          transform: [{translateY: progress.interpolate({inputRange: [0, 1], outputRange: [-18, 0]})}],
        }]}
      >
        <Pressable
          accessibilityLabel={`ปิดข้อความ ${toast.title}`}
          accessibilityRole="alert"
          onPress={dismissToast}
          style={[styles.card, {backgroundColor: tone.background, borderColor: tone.border}]}
        >
          <MaterialIcon color={tone.accent} name={tone.icon} size={21} />
          <View style={styles.copy}>
            <Text style={[styles.title, {color: tone.accent}]}>{toast.title}</Text>
            {toast.message ? <Text numberOfLines={3} style={styles.message}>{toast.message}</Text> : null}
          </View>
          <MaterialIcon color="#97a094" name="close" size={17} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  animated: {maxWidth: 520, width: '100%'},
  card: {alignItems: 'center', borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 11, paddingHorizontal: 15, paddingVertical: 13, shadowColor: '#20281f', shadowOffset: {height: 8, width: 0}, shadowOpacity: .16, shadowRadius: 18},
  copy: {flex: 1},
  host: {alignItems: 'center', left: 0, paddingHorizontal: 14, position: 'absolute', right: 0, top: 0, zIndex: 9999},
  message: {color: '#5d675b', fontSize: 12.5, lineHeight: 18, marginTop: 2},
  title: {fontSize: 14, fontWeight: '800'},
});
