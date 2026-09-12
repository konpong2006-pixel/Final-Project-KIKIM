import {createElement, useMemo, useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';

import type {DateTimePickerProps, PlainDateTimeFieldProps} from './date-time-picker';

/**
 * The web half of the app's date and time entry.
 *
 * `@expo/ui` ships a web build of DateTimePicker that is a stub returning
 * `null`, so on web the picker every form opened rendered nothing at all and a
 * time could only be entered as free text. The browser's own
 * `<input type="date">` / `<input type="time">` is the fix: a real picker on
 * every desktop and mobile browser, keyboard and screen-reader accessible, and
 * incapable of producing a malformed value in the first place.
 *
 * react-native-web renders to the DOM, so a raw `input` sits happily inside the
 * React Native tree. It is styled to match the fields around it rather than
 * left with browser defaults.
 */

const pad = (value: number) => String(value).padStart(2, '0');
const valid = (value: Date | undefined) => (value && !Number.isNaN(value.getTime()) ? value : undefined);

function dateText(value: Date) {
  const usable = valid(value);
  return usable ? `${usable.getFullYear()}-${pad(usable.getMonth() + 1)}-${pad(usable.getDate())}` : '';
}

function timeText(value: Date) {
  const usable = valid(value);
  return usable ? `${pad(usable.getHours())}:${pad(usable.getMinutes())}` : '';
}

/** Applies only the date half or only the time half of an edit onto `base`. */
function merged(base: Date, mode: 'date' | 'time', raw: string) {
  const result = new Date((valid(base) ?? new Date()).getTime());
  if (mode === 'date') {
    const [year, month, day] = raw.split('-').map(Number);
    if (!year || !month || !day) return null;
    result.setFullYear(year, month - 1, day);
  } else {
    const [hour, minute] = raw.split(':').map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    result.setHours(hour, minute, 0, 0);
  }
  return result;
}

// Longhand only: mixing the `border` shorthand with longhand overrides makes
// React warn and makes the merge below order-dependent.
const BASE_INPUT_STYLE: Record<string, string | number> = {
  background: '#ffffff',
  borderColor: '#d3ddd1',
  borderRadius: 12,
  borderStyle: 'solid',
  borderWidth: 1,
  boxSizing: 'border-box',
  color: '#2f3a2e',
  fontFamily: 'inherit',
  fontSize: 16,
  paddingBottom: 12,
  paddingLeft: 14,
  paddingRight: 14,
  paddingTop: 12,
  width: '100%',
};

type BrowserInputProps = {
  disabled?: boolean;
  max?: string;
  min?: string;
  mode: 'date' | 'time';
  onValue: (raw: string) => void;
  style?: Record<string, string | number>;
  value: string;
};

function BrowserInput({disabled, max, min, mode, onValue, style, value}: BrowserInputProps) {
  return createElement('input', {
    disabled,
    max,
    min,
    onChange: (event: {target: {value: string}}) => onValue(event.target.value),
    step: mode === 'time' ? 60 : undefined,
    style: {...BASE_INPUT_STYLE, ...style},
    type: mode,
    value,
  });
}

export default function DateTimePicker({maximumDate, minimumDate, mode = 'date', onDismiss, onValueChange, value}: DateTimePickerProps) {
  const field: 'date' | 'time' = mode === 'time' ? 'time' : 'date';
  // The incoming value is snapshotted when the dialog opens, the same way the
  // Android dialog presentation behaves: callers mount this only while the
  // picker is meant to be visible and unmount it again on either callback.
  const [draft, setDraft] = useState(() => (field === 'date' ? dateText(value) : timeText(value)));

  // The caller unmounts the picker in response to either callback, matching how
  // the Android dialog presentation behaves.
  const dismiss = () => onDismiss?.();
  const confirm = () => {
    const selected = merged(value, field, draft);
    if (!selected) return dismiss();
    onValueChange?.({nativeEvent: {timestamp: selected.getTime(), utcOffset: -selected.getTimezoneOffset()}}, selected);
  };

  // The sheet is wrapped in a real DOM element whose click handler stops
  // propagation. The `<input>` is a plain DOM node rather than a React Native
  // view, so its clicks are not part of the responder system and would
  // otherwise bubble all the way to the backdrop and close the dialog the
  // moment the user reached for the field.
  const sheet = createElement(
    'div',
    {onClick: (event: {stopPropagation: () => void}) => event.stopPropagation(), style: {maxWidth: 360, width: '100%'}},
    <View style={styles.sheet}>
      <Text style={styles.heading}>{field === 'date' ? 'เลือกวันที่' : 'เลือกเวลา'}</Text>
      <BrowserInput
        max={field === 'date' ? dateText(maximumDate ?? new Date(NaN)) || undefined : undefined}
        min={field === 'date' ? dateText(minimumDate ?? new Date(NaN)) || undefined : undefined}
        mode={field}
        onValue={setDraft}
        value={draft}
      />
      <View style={styles.actions}>
        <Pressable onPress={dismiss} style={styles.secondary}><Text style={styles.secondaryText}>ยกเลิก</Text></Pressable>
        <Pressable disabled={!draft} onPress={confirm} style={[styles.primary, !draft && styles.primaryDisabled]}><Text style={styles.primaryText}>ตกลง</Text></Pressable>
      </View>
    </View>,
  );

  return <Modal animationType="fade" onRequestClose={dismiss} transparent visible>
    <Pressable onPress={dismiss} style={styles.backdrop}>{sheet}</Pressable>
  </Modal>;
}

export function PlainDateTimeField({editable, mode, onChangeText, style, value}: PlainDateTimeFieldProps) {
  // Carry the surrounding field's own styling across so the control stays
  // visually identical; only the input type changes.
  const inherited = useMemo(() => {
    const resolved = StyleSheet.flatten(style) ?? {};
    const entries: Record<string, string | number> = {};
    const copy = (key: string, source: unknown) => {
      if (typeof source === 'string' || typeof source === 'number') entries[key] = source;
    };
    copy('background', resolved.backgroundColor);
    copy('borderColor', resolved.borderColor);
    copy('borderRadius', resolved.borderRadius);
    copy('borderWidth', resolved.borderWidth);
    copy('color', resolved.color);
    copy('fontSize', resolved.fontSize);
    copy('fontWeight', resolved.fontWeight);
    copy('paddingBottom', resolved.paddingVertical ?? resolved.paddingBottom ?? resolved.padding);
    copy('paddingLeft', resolved.paddingHorizontal ?? resolved.paddingLeft ?? resolved.padding);
    copy('paddingRight', resolved.paddingHorizontal ?? resolved.paddingRight ?? resolved.padding);
    copy('paddingTop', resolved.paddingVertical ?? resolved.paddingTop ?? resolved.padding);
    if (entries.borderColor !== undefined && entries.borderWidth === undefined) entries.borderWidth = 1;
    return entries;
  }, [style]);

  return <BrowserInput disabled={editable === false} mode={mode} onValue={onChangeText} style={inherited} value={value} />;
}

const styles = StyleSheet.create({
  actions: {flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 18},
  backdrop: {alignItems: 'center', backgroundColor: 'rgba(24, 33, 23, 0.45)', flex: 1, justifyContent: 'center', padding: 24},
  heading: {color: '#2f3a2e', fontSize: 16, fontWeight: '700', marginBottom: 12},
  primary: {backgroundColor: '#5f875f', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10},
  primaryDisabled: {opacity: 0.5},
  primaryText: {color: '#ffffff', fontWeight: '700'},
  secondary: {borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10},
  secondaryText: {color: '#5c6a5a', fontWeight: '600'},
  sheet: {backgroundColor: '#ffffff', borderRadius: 18, padding: 22, width: '100%'},
});
