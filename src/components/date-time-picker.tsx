import NativeDateTimePicker, {type DateTimePickerProps} from '@expo/ui/community/datetime-picker';
import {StyleProp, TextInput, TextStyle} from 'react-native';

/**
 * The app's date and time entry, split by platform.
 *
 * `@expo/ui`'s DateTimePicker has no web implementation at all -- its
 * `DateTimePicker.web.tsx` is a stub that returns `null` -- so on web every
 * screen that opened a picker rendered nothing and the value could not be
 * changed, the same class of silent no-op as `Alert.alert` on
 * react-native-web. `date-time-picker.web.tsx` supplies a real picker built on
 * the browser's own `<input type="date">` / `<input type="time">`.
 *
 * This native half deliberately forwards straight through, so Android and iOS
 * behave exactly as they did before; screens only swap which module they import
 * the picker from.
 */
export default function DateTimePicker(props: DateTimePickerProps) {
  return <NativeDateTimePicker {...props} />;
}

export type {DateTimePickerProps};

export type PlainDateTimeFieldProps = {
  editable?: boolean;
  mode: 'date' | 'time';
  onChangeText: (value: string) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  style?: StyleProp<TextStyle>;
  value: string;
};

/**
 * An inline field holding a `YYYY-MM-DD` or `HH:mm` string.
 *
 * Native keeps the plain text box these fields have always been; the web
 * override turns it into the browser's own picker so nobody has to type a time
 * by hand into a form that silently rejects a typo.
 */
export function PlainDateTimeField({editable, onChangeText, placeholder, placeholderTextColor, style, value}: PlainDateTimeFieldProps) {
  return <TextInput
    autoCapitalize="none"
    editable={editable}
    onChangeText={onChangeText}
    placeholder={placeholder}
    placeholderTextColor={placeholderTextColor}
    style={style}
    value={value}
  />;
}
