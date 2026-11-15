import type { ReactNode } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { COLORS, FONT } from './theme';

export const TOP_INSET = (StatusBar.currentHeight ?? 24) + 8;

export function Kicker({ children, color = COLORS.accent }: { children: ReactNode; color?: string }) {
  return <Text style={[styles.kicker, { color }]}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[styles.body, muted && { color: COLORS.muted }, style]}>{children}</Text>;
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function Button(p: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onLongPress?: () => void;
}) {
  const v = p.variant ?? 'primary';
  return (
    <Pressable
      onPress={p.onPress}
      onLongPress={p.onLongPress}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!p.disabled }}
      style={({ pressed }) => [
        styles.btn,
        v === 'primary' && styles.btnPrimary,
        v === 'ghost' && styles.btnGhost,
        v === 'danger' && styles.btnDanger,
        pressed && { opacity: 0.75 },
        p.disabled && { opacity: 0.35 },
        p.style,
      ]}
    >
      <Text style={[styles.btnText, v === 'primary' && { color: COLORS.bg }]}>{p.label}</Text>
    </Pressable>
  );
}

/** Horizontal meter, 0..1. */
export function Meter({ value, color, height = 8 }: { value: number; color: string; height?: number }) {
  return (
    <View style={[styles.meter, { height }]}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: '100%', backgroundColor: color }} />
    </View>
  );
}

export function Check({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable
      onPress={onToggle}
      style={styles.checkRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.box, checked && styles.boxOn]}>{checked && <Text style={styles.tick}>✓</Text>}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export function Stat({ label, value, color = COLORS.text, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  kicker: { fontFamily: FONT.mono, fontSize: 12, letterSpacing: 3, fontWeight: '700' },
  title: { color: COLORS.text, fontSize: 30, fontWeight: '800', letterSpacing: 1 },
  body: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  panel: {
    backgroundColor: COLORS.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.panelEdge,
    padding: 14,
    gap: 8,
  },
  btn: { paddingVertical: 15, paddingHorizontal: 18, borderRadius: 10, alignItems: 'center' },
  btnPrimary: { backgroundColor: COLORS.accent },
  btnGhost: { borderWidth: 1, borderColor: COLORS.panelEdge, backgroundColor: COLORS.panel },
  btnDanger: { backgroundColor: COLORS.danger },
  btnText: { color: COLORS.text, fontWeight: '800', letterSpacing: 2, fontSize: 13, fontFamily: FONT.mono },
  meter: { backgroundColor: COLORS.panelEdge, borderRadius: 99, overflow: 'hidden', width: '100%' },
  checkRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 6 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: COLORS.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  tick: { color: COLORS.bg, fontWeight: '900', fontSize: 14 },
  checkLabel: { color: COLORS.text, fontSize: 14, lineHeight: 20, flex: 1 },
  stat: { flex: 1, gap: 2 },
  statLabel: { color: COLORS.muted, fontSize: 10, letterSpacing: 2, fontFamily: FONT.mono, fontWeight: '700' },
  statValue: { fontSize: 22, fontWeight: '800' },
  statSub: { color: COLORS.muted, fontSize: 11 },
});
