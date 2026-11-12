import { Pressable } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Drop-in replacement for Pressable: shrinks slightly while pressed, then springs back.
export default function PressableScale({ style, pressScale = 0.96, onPressIn, onPressOut, ...rest }) {
  const sc = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => { sc.value = withSpring(pressScale, { damping: 15, stiffness: 300 }); onPressIn && onPressIn(e); }}
      onPressOut={(e) => { sc.value = withSpring(1, { damping: 12, stiffness: 250 }); onPressOut && onPressOut(e); }}
      style={[style, anim]}
    />
  );
}
