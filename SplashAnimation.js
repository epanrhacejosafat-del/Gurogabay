import { useEffect } from 'react';
import { View, Image, Text, Modal, Dimensions, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

const { width: W, height: H } = Dimensions.get('window');
const SIZE = H * 1.6; // big circle = curved "liquid" edge
const BLUE = '#0C2762'; // navy from the GG logo
const LOGO = require('./assets/components/logo.png');
const LOGO_WHITE = require('./assets/components/logo-white.png');

export default function SplashAnimation({ onDone }) {
  const wave = useSharedValue(0);
  const blueLogo = useSharedValue(0);
  const whiteContent = useSharedValue(0);
  const ease = Easing.inOut(Easing.cubic);

  useEffect(() => {
    // 1. blue logo fades in, then out as the wave arrives
    blueLogo.value = withSequence(
      withTiming(1, { duration: 600 }),
      withDelay(500, withTiming(0, { duration: 300 }))
    );
    // 2. wave rises, holds, then drops away and finishes
    wave.value = withDelay(
      1100,
      withSequence(
        withTiming(-1.3 * H, { duration: 800, easing: ease }),
        withDelay(
          1800,
          withTiming(0, { duration: 800, easing: ease }, (done) => {
            if (done) runOnJS(onDone)();
          })
        )
      )
    );
    // 3. white logo + app name appear on the blue, then fade out
    whiteContent.value = withDelay(
      1700,
      withSequence(
        withTiming(1, { duration: 500 }),
        withDelay(1000, withTiming(0, { duration: 300 }))
      )
    );
  }, []);

  const blueStyle = useAnimatedStyle(() => ({
    opacity: blueLogo.value,
    transform: [{ scale: 0.85 + 0.15 * blueLogo.value }],
  }));
  const waveStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: wave.value }],
  }));
  const whiteStyle = useAnimatedStyle(() => ({
    opacity: whiteContent.value,
    transform: [{ scale: 0.9 + 0.1 * whiteContent.value }],
  }));

  return (
    <Modal visible transparent={false} animationType="none" statusBarTranslucent onRequestClose={() => {}}>
    <View style={styles.root}>
      <Animated.Image source={LOGO} style={[styles.logo, blueStyle]} resizeMode="contain" />
      <Animated.View style={[styles.circle, waveStyle]} />
      <Animated.View style={[styles.center, whiteStyle]}>
        <Image source={LOGO_WHITE} style={styles.small} resizeMode="contain" />
        <Text style={styles.word}>GuroGabay</Text>
      </Animated.View>
    </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logo: { width: 150, height: 131 },
  circle: {
    position: 'absolute',
    top: H, // starts just below the screen
    left: (W - SIZE) / 2,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: BLUE,
  },
  center: { position: 'absolute', alignItems: 'center' },
  small: { width: 90, height: 79, marginBottom: 14 },
  word: { color: '#fff', fontSize: 28, fontWeight: '700', letterSpacing: 0.5 },
});

/* Usage in App.js:
   const [showSplash, setShowSplash] = useState(true);
   return (
     <>
       <YourNavigation />
       {showSplash && <SplashAnimation onDone={() => setShowSplash(false)} />}
     </>
   );
*/