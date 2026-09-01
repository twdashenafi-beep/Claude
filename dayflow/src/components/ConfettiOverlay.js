import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';

const COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#AF52DE', '#FF2D55'];
const PIECES = 40;
const { width: W, height: H } = Dimensions.get('window');

function Piece({ delay }) {
  const y = useRef(new Animated.Value(-20)).current;
  const x = useRef(new Animated.Value(Math.random() * W)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const size = 6 + Math.random() * 6;

  useEffect(() => {
    const dur = 2000 + Math.random() * 1500;
    Animated.parallel([
      Animated.timing(y, { toValue: H + 20, duration: dur, delay, useNativeDriver: true }),
      Animated.timing(x, { toValue: x.__getValue() + (Math.random() - 0.5) * 200, duration: dur, delay, useNativeDriver: true }),
      Animated.timing(rotate, { toValue: 720, duration: dur, delay, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: dur * 0.3, delay: delay + dur * 0.7, useNativeDriver: true }),
    ]).start();
  }, []);

  const spin = rotate.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: size,
        height: size * 0.6,
        backgroundColor: color,
        borderRadius: 2,
        transform: [{ translateX: x }, { translateY: y }, { rotate: spin }],
        opacity,
      }}
    />
  );
}

export default function ConfettiOverlay({ visible, onDone }) {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => onDone && onDone(), 3500);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: PIECES }).map((_, i) => (
        <Piece key={i} delay={i * 40} />
      ))}
      <View style={st.msgWrap}>
        <Text style={st.msg}>All done! 🎉</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  msgWrap: {
    position: 'absolute', top: '35%', left: 0, right: 0, alignItems: 'center',
  },
  msg: {
    fontSize: 28, fontWeight: '800', color: '#000', backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 16, overflow: 'hidden',
  },
});
