import {Platform} from 'react-native';
import {Pressable, type PressableProps, type PressableStateCallbackType, StyleSheet} from 'react-native';

/**
 * A drop-in replacement for `Pressable` that always gives some visible
 * feedback on tap (mobile) or mouse interaction (web/desktop), so a screen
 * with no bespoke `pressed &&` styling of its own still tells the user "this
 * is tappable" instead of looking identical whether it responds to touch or
 * not.
 *
 * Web and mobile feel deliberately different: a mouse has a hover state a
 * touchscreen never does, so desktop gets a hover "lift" that grows further
 * while the mouse is actually held down, matching how buttons behave on
 * desktop apps. Touch has no hover, so mobile keeps the shrink-and-dim tap
 * feedback that reads as a physical press instead.
 *
 * Swap the import and the JSX tag; `style` keeps working whether it was a
 * plain object or already a `({pressed}) => [...]` function, since this
 * layers the default feedback on top rather than replacing what is there.
 */
export function Touchable({style, ...props}: PressableProps) {
  return (
    <Pressable
      {...props}
      style={(state: PressableStateCallbackType) => {
        // react-native-web adds `hovered` to this callback at runtime; core
        // RN's type only declares `pressed`, so it has to be read via a cast.
        const hovered = Boolean((state as PressableStateCallbackType & {hovered?: boolean}).hovered);
        const web = Platform.OS === 'web';
        return [
          webTransition,
          typeof style === 'function' ? style(state) : style,
          web && state.pressed && touchableStyles.pressZoom,
          web && hovered && !state.pressed && touchableStyles.hoverZoom,
          !web && state.pressed && touchableStyles.pressed,
        ];
      }}
    />
  );
}

// Smooth the hover/press scale on web so it eases instead of snapping; react-native-web
// forwards these CSS transition props, and native ignores them.
const webTransition = Platform.OS === 'web' ? ({transitionDuration: '140ms', transitionProperty: 'transform, opacity', transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)'} as object) : {};

const touchableStyles = StyleSheet.create({
  hoverZoom: Platform.OS === 'web' ? {cursor: 'pointer', transform: [{scale: 1.03}]} as object : {},
  pressed: {opacity: 0.82, transform: [{scale: 0.985}]},
  pressZoom: Platform.OS === 'web' ? {cursor: 'pointer', transform: [{scale: 1.08}]} as object : {},
});
