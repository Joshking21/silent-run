import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CALIBRATION_MS, Calibrator, type Baseline, type CalibrationProgress } from '../engine/calibration';
import { useSignals } from '../hooks/useSmartSpectra';
import { signalStore } from '../signals/signalStore';
import type { QualityCode, SourceKind } from '../signals/types';
import { DOCK_FULL, useDockSlot } from '../ui/CameraDock';
import { Body, Button, Kicker, Meter, Panel, Stat, TOP_INSET } from '../ui/components';
import { COLORS, FONT } from '../ui/theme';

interface Props {
  sourceKind: SourceKind | null;
  sourceError: string | null;
  onComplete: (b: Baseline) => void;
  onUseMock: () => void;
  onBack: () => void;
  /** Restart the live sensor after the SDK ended a session. */
  onRetry?: () => void;
}

function sdkErrorMessage(code: string, message: string): string {
  switch (code) {
    case 'SUSTAINED_LOW_FRAME_RATE':
      return 'The camera ran too slowly to read your pulse. Move to brighter light, close other apps, then try again.';
    case 'METRIC_NOT_AUTHORIZED':
      return 'Your Presage key is not authorised for one of the requested measurements.';
    default:
      return `${code}: ${message}`;
  }
}

/** Diegetic, actionable wording for each SDK quality code. */
export function qualityMessage(q: QualityCode, hint: string): string {
  switch (q) {
    case 'OK':
      return 'Signal locked';
    case 'TOO_DARK':
      return 'Too dark. Face a light source.';
    case 'TOO_BRIGHT':
      return 'Too bright. Move out of direct light.';
    case 'NO_FACE_FOUND':
      return 'No face found. Look at the screen.';
    case 'MULTIPLE_FACES_FOUND':
      return 'More than one face. Only one operative.';
    case 'FACE_TOO_FAR':
    case 'FACE_SIZE_OUT_OF_RANGE':
      return 'Move a little closer.';
    case 'FACE_TOO_CLOSE':
      return 'Move back a little.';
    case 'FACE_NOT_CENTERED':
    case 'FACE_TOO_HIGH':
    case 'FACE_TOO_LOW':
      return 'Centre your face in the frame.';
    case 'FACE_NOT_FORWARD':
      return 'Face the camera straight on.';
    case 'EXCESSIVE_MOTION':
      return 'Hold still. Prop the phone up if you can.';
    case 'CHEST_NOT_VISIBLE':
      return 'Tilt the phone so your upper chest is in view.';
    case 'FRAME_RATE_TOO_LOW':
      return 'Camera is struggling. Add light.';
    case 'CAMERA_TUNING':
      return 'Camera adjusting…';
    default:
      return hint || 'Acquiring signal…';
  }
}

export function CalibrationScreen({ sourceKind, sourceError, onComplete, onUseMock, onBack, onRetry }: Props) {
  const s = useSignals();
  const calibrator = useRef(new Calibrator());
  const [progress, setProgress] = useState<CalibrationProgress>(calibrator.current.progress());
  const [result, setResult] = useState<Baseline | null>(null);
  const live = sourceKind === 'live';
  const slot = useDockSlot();

  useEffect(() => {
    calibrator.current = new Calibrator();
    setResult(null);
    const id = setInterval(() => {
      const p = calibrator.current.update(signalStore.get());
      setProgress(p);
      if (calibrator.current.isComplete()) {
        clearInterval(id);
        setResult(calibrator.current.result());
      }
    }, 100);
    return () => clearInterval(id);
  }, [sourceKind]);

  const secondsLeft = Math.ceil((CALIBRATION_MS - progress.validMs) / 1000);
  const locked = s.signalValid;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      onScroll={slot.sync}
      scrollEventThrottle={16}
    >
      <Kicker>STEP 2 · BASELINE</Kicker>
      <Text style={styles.title}>Find your resting signature</Text>

      {/* Slot the CameraDock pins itself to (live), or a stand-in for simulated mode. */}
      <View ref={slot.ref} onLayout={slot.sync} style={[styles.feed, { height: DOCK_FULL.height }]}>
        {!live && (
          <View style={styles.mockFeed}>
            <Text style={styles.mockLabel}>SIMULATED SENSOR FEED</Text>
            <Text style={styles.mockSub}>No camera in use</Text>
          </View>
        )}
        {/* In live mode the preview sits on top of this slot; status shows below. */}
        {!live && (
          <View style={[styles.lockBadge, { backgroundColor: locked ? COLORS.accent : COLORS.warn }]}>
            <Text style={styles.lockText}>{locked ? 'LOCKED' : 'ADJUST'}</Text>
          </View>
        )}
      </View>

      {sourceError ? (
        <Panel style={{ borderColor: COLORS.danger }}>
          <Text style={[styles.status, { color: COLORS.danger }]}>Camera could not start</Text>
          <Body muted>{sourceError}</Body>
          <Button label="USE SIMULATED SIGNALS" variant="ghost" onPress={onUseMock} />
        </Panel>
      ) : s.lastError && s.processing !== 'RUNNING' ? (
        // The SDK ended the session itself (e.g. sustained low frame rate).
        <Panel style={{ borderColor: COLORS.danger }}>
          <Text style={[styles.status, { color: COLORS.danger }]}>Sensor stopped</Text>
          <Body muted>{sdkErrorMessage(s.lastError.code, s.lastError.message)}</Body>
          {onRetry ? <Button label="TRY AGAIN" onPress={onRetry} /> : null}
          <Button label="USE SIMULATED SIGNALS" variant="ghost" onPress={onUseMock} />
        </Panel>
      ) : (
        <Panel>
          <Text style={[styles.status, { color: locked ? COLORS.accent : COLORS.warn }]}>
            {s.processing !== 'RUNNING' ? 'Starting sensor…' : qualityMessage(s.quality, s.hint)}
          </Text>
          <Meter value={progress.progress} color={COLORS.accent} height={10} />
          <Text style={styles.small}>
            {result
              ? 'Baseline captured'
              : progress.waitingFor
                ? `Holding for a steady ${progress.waitingFor} reading…`
                : locked
                  ? `Sit still and breathe normally · ${Math.max(0, secondsLeft)}s`
                  : 'Paused until your face is clearly in frame'}
          </Text>
        </Panel>
      )}

      <Panel>
        <View style={styles.stats}>
          <Stat label="PULSE" value={s.pulseRate != null ? `${s.pulseRate.toFixed(0)}` : '—'} sub="bpm" color={COLORS.heat} />
          <Stat label="BREATH" value={s.breathingRate != null ? `${s.breathingRate.toFixed(0)}` : '—'} sub="/min" color={COLORS.breath} />
          <Stat label="HRV" value={s.hrvRmssd != null ? `${s.hrvRmssd.toFixed(0)}` : '—'} sub="ms rmssd" color={COLORS.accent} />
          <Stat label="BLINKS" value={`${progress.blinks}`} sub="counted" />
        </View>
      </Panel>

      {result ? (
        <>
          <Panel style={{ borderColor: COLORS.accent }}>
            <Text style={styles.small}>YOUR BASELINE. Every threshold in the game is measured against these numbers.</Text>
            <Text style={styles.baseline}>
              {result.hr.toFixed(0)} bpm · {result.breathRate != null ? `${result.breathRate.toFixed(0)} breaths/min` : 'breathing n/a'} ·{' '}
              {result.rmssd != null ? `${result.rmssd.toFixed(0)} ms HRV` : 'HRV n/a'}
            </Text>
          </Panel>
          <Button label="PROCEED TO BRIEFING" onPress={() => onComplete(result)} />
        </>
      ) : (
        <Body muted style={{ fontSize: 13 }}>
          Prop the phone up at arm's length with your face and shoulders in view, in even light. You only need to
          do this once per session.
        </Body>
      )}
      {sourceKind === 'mock' && !result && (
        <Button
          label="SKIP (SIMULATED ONLY)"
          variant="ghost"
          onPress={() => onComplete({ hr: 72, rmssd: 42, breathRate: 13, blinkRate: 15, capturedAt: Date.now() })}
        />
      )}
      <Button label="BACK" variant="ghost" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingTop: TOP_INSET, gap: 12, paddingBottom: 40 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '800', marginBottom: 2 },
  feed: { borderRadius: 14, overflow: 'hidden' },
  mockFeed: {
    flex: 1,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.panelEdge,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  mockLabel: { color: COLORS.accent, fontFamily: FONT.mono, letterSpacing: 3, fontWeight: '700' },
  mockSub: { color: COLORS.muted, fontSize: 12 },
  lockBadge: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, zIndex: 60 },
  lockText: { color: COLORS.bg, fontFamily: FONT.mono, fontWeight: '800', fontSize: 11, letterSpacing: 2 },
  status: { fontSize: 17, fontWeight: '700' },
  small: { color: COLORS.muted, fontSize: 13 },
  stats: { flexDirection: 'row', gap: 8 },
  baseline: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
});
