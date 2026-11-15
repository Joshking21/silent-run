import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { isNativeAvailable } from '../../modules/smartspectra-bridge';
import type { SourceKind } from '../signals/types';
import { Body, Button, Check, Kicker, Panel, TOP_INSET, Title } from '../ui/components';
import { COLORS, FONT } from '../ui/theme';

interface Props {
  onAccept: (kind: SourceKind) => void;
  /** Hidden developer entry (long-press the title). */
  onOpenLab: () => void;
  error?: string | null;
}

const POINTS: { h: string; b: string }[] = [
  {
    h: 'What the camera reads',
    b: 'While a session is running, the front camera feeds the Presage SmartSpectra SDK. It estimates pulse, heart-rate variability and breathing, and detects blinking, talking and facial expression.',
  },
  {
    h: 'Where it is processed',
    b: 'Frames go straight to the SDK as they arrive. Silent Run never saves or uploads video, images or vitals. Your mission debrief stays in memory on this phone and is gone when you close the app. The SDK connects to Presage to authenticate this app, and we have switched off its optional usage telemetry.',
  },
  {
    h: 'When it is on',
    b: 'Only during calibration and missions, and only while the app is on screen. Leaving the app stops the camera straight away. You can quit at any time.',
  },
  {
    h: 'Not a medical device',
    b: 'Silent Run is a game for practising focus, breath pacing and composure. Its readings are estimates for play. They are not a diagnosis and should not be used for any health decision.',
  },
];

export function ConsentScreen({ onAccept, onOpenLab, error }: Props) {
  const [understand, setUnderstand] = useState(false);
  const [consent, setConsent] = useState(false);
  const ready = understand && consent;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onLongPress={onOpenLab} delayLongPress={1200}>
        <Kicker>BIOMETRIC STEALTH · COMPOSURE TRAINING</Kicker>
        <Title>SILENT RUN</Title>
      </Pressable>
      <Body muted>
        Your body is your stealth signature. A racing pulse runs hot, a blink can trip a scanner, and a whisper can
        give you away. Before you play, here is exactly how the camera is used.
      </Body>

      {POINTS.map((p, i) => (
        <Panel key={p.h}>
          <Text style={styles.num}>0{i + 1}</Text>
          <Text style={styles.h}>{p.h}</Text>
          <Body>{p.b}</Body>
        </Panel>
      ))}

      <View style={styles.checks}>
        <Check
          checked={understand}
          onToggle={() => setUnderstand(!understand)}
          label="I understand Silent Run is a game, not a medical or diagnostic tool."
        />
        <Check
          checked={consent}
          onToggle={() => setConsent(!consent)}
          label="I agree to let the front camera be processed on this device during sessions."
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={isNativeAvailable ? 'ENABLE CAMERA & CALIBRATE' : 'CAMERA NEEDS THE DEV BUILD'}
        onPress={() => onAccept('live')}
        disabled={!ready || !isNativeAvailable}
      />
      <Button
        label="PRACTISE WITH SIMULATED SIGNALS"
        variant="ghost"
        onPress={() => onAccept('mock')}
        disabled={!understand}
      />
      <Body muted style={styles.foot}>
        Simulated mode uses no camera. It generates practice signals so you can learn the missions.
      </Body>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 20, paddingTop: TOP_INSET + 12, gap: 14, paddingBottom: 40 },
  num: { color: COLORS.accent, fontFamily: FONT.mono, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  h: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  checks: { gap: 4, marginTop: 4 },
  error: { color: COLORS.danger, fontSize: 14 },
  foot: { fontSize: 12, textAlign: 'center' },
});
