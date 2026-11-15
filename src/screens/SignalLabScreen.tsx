import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  SmartSpectraBridge,
  SmartSpectraPreview,
  isNativeAvailable,
} from '../../modules/smartspectra-bridge';
import { defaultSourceKind, useSmartSpectra } from '../hooks/useSmartSpectra';
import { Recorder, type Recording } from '../signals/replay';
import { signalStore } from '../signals/signalStore';
import type { SourceKind } from '../signals/types';

/**
 * Day-1 spike / debug tool. Proves every SmartSpectra signal arrives on the
 * device at a usable rate before any game code depends on it.
 */
export function SignalLabScreen({ onBack }: { onBack?: () => void }) {
  const ss = useSmartSpectra();
  const s = ss.state;
  const [kind, setKind] = useState<SourceKind>(defaultSourceKind);
  const [readiness, setReadiness] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const rates = useEventRates(ss.running);
  const trace = useTrace(ss.running);
  const [talking, setTalking] = useState(false);
  const [dark, setDark] = useState(false);

  const toggleRun = async () => {
    if (ss.running) await ss.stop();
    else await ss.start(kind, recording ?? undefined);
  };

  const toggleRecord = () => {
    const src = signalStore.getSource();
    if (!src) return;
    if (!isRecording) {
      recorder.current = new Recorder(src);
      recorder.current.begin();
      setIsRecording(true);
    } else {
      const rec = recorder.current?.end() ?? null;
      setRecording(rec);
      setIsRecording(false);
    }
  };

  const checkReadiness = async () => {
    try {
      const r = await SmartSpectraBridge?.checkDeviceReadiness();
      setReadiness(r ? `${r.verdict}: ${r.reason}` : 'native module missing');
    } catch (e) {
      setReadiness(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const fresh = (at: number) => (at ? `${((Date.now() - at) / 1000).toFixed(1)}s ago` : '—');

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
        <Text style={styles.title}>SIGNAL LAB</Text>
        {onBack && (
          <Btn
            label="BACK"
            onPress={async () => {
              await ss.stop();
              onBack();
            }}
          />
        )}
      </View>
      <Text style={styles.sub}>
        native module: {isNativeAvailable ? 'yes' : 'no (mock only)'}
        {isNativeAvailable && ` · sdk ${SmartSpectraBridge?.getSdkVersion()}`}
        {isNativeAvailable && ` · key ${SmartSpectraBridge?.isApiKeyConfigured() ? 'set' : 'MISSING'}`}
      </Text>

      <View style={styles.row}>
        {(['live', 'mock', 'replay'] as SourceKind[]).map((k) => {
          const disabled =
            ss.running || (k === 'live' && !isNativeAvailable) || (k === 'replay' && !recording);
          return (
            <Chip key={k} label={k} active={kind === k} disabled={disabled} onPress={() => setKind(k)} />
          );
        })}
      </View>

      {kind === 'live' && SmartSpectraPreview && (
        <View style={styles.preview}>
          <SmartSpectraPreview style={StyleSheet.absoluteFill} />
          {!s.signalValid && ss.running && (
            <View style={styles.jammed}>
              <Text style={styles.jammedText}>OPTIC JAMMED</Text>
              <Text style={styles.jammedHint}>{s.hint || s.quality}</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.row}>
        <Btn label={ss.running ? 'STOP' : 'START'} onPress={toggleRun} primary />
        <Btn label={isRecording ? 'END REC' : 'RECORD'} onPress={toggleRecord} disabled={!ss.running} />
        {isNativeAvailable && <Btn label="READINESS" onPress={checkReadiness} disabled={ss.running} />}
      </View>
      {ss.error && <Text style={styles.error}>{ss.error}</Text>}
      {s.lastError && (
        <Text style={styles.error}>
          SDK {s.lastError.code}: {s.lastError.message}
        </Text>
      )}
      {readiness && <Text style={styles.sub}>readiness → {readiness}</Text>}
      {recording && (
        <Text style={styles.sub}>
          recording: {(recording.durationMs / 1000).toFixed(0)}s, {recording.events.length} events
          (select "replay" to play)
        </Text>
      )}

      <Section title="STATUS">
        <Line k="processing" v={s.processing} />
        <Line k="quality" v={`${s.quality}${s.hint ? ` · ${s.hint}` : ''}`} warn={s.quality !== 'OK'} />
        <Line k="hazards live" v={s.signalValid ? 'YES' : 'PAUSED'} warn={!s.signalValid} />
      </Section>

      <Section title="VITALS (slow)">
        <Line k="pulse" v={s.pulseRate != null ? `${s.pulseRate.toFixed(0)} bpm` : '—'} note={fresh(s.pulseAt)} />
        <Line
          k="HRV rmssd"
          v={s.hrvRmssd != null ? `${s.hrvRmssd.toFixed(1)} ms${s.hrvStable ? '' : ' (unstable)'}` : '—'}
          note={fresh(s.hrvAt)}
        />
        <Line k="breathing" v={s.breathingRate != null ? `${s.breathingRate.toFixed(1)} /min` : '—'} note={fresh(s.breathingAt)} />
      </Section>

      <Section title="FACE (fast)">
        <Line k="blinking" v={s.isBlinking ? 'BLINK' : 'open'} warn={s.isBlinking} note={`count ${s.blinkCount}`} />
        <Line k="talking" v={s.isTalking ? 'TALKING' : 'silent'} warn={s.isTalking} />
        <Line k="expression" v={`${s.expression} ${s.expressionConfidence.toFixed(0)}%`} />
      </Section>

      <Section title="BREATHING TRACE (chest, ~10s)">
        <Sparkline values={trace} />
      </Section>

      <Section title="EVENT RATES (/s)">
        <Line k="fast" v={rates.fast.toFixed(1)} note="target ≈10" />
        <Line k="vitals" v={rates.vitals.toFixed(1)} note="target 0.5–2" />
        <Line k="trace samples" v={rates.trace.toFixed(1)} note="target ≈30" />
      </Section>

      {ss.mock && (
        <Section title="MOCK CONTROLS">
          <View style={styles.row}>
            <Btn label="SPIKE" onPress={() => ss.mock?.spike()} />
            <Btn label="CALM" onPress={() => ss.mock?.setStress(0)} />
            <Btn label="BLINK" onPress={() => ss.mock?.blinkNow()} />
          </View>
          <View style={styles.row}>
            <Btn
              label={talking ? 'STOP TALK' : 'TALK'}
              onPress={() => {
                ss.mock?.setTalking(!talking);
                setTalking(!talking);
              }}
            />
            <Btn
              label={dark ? 'FIX LIGHT' : 'TOO DARK'}
              onPress={() => {
                ss.mock?.setQuality(dark ? 'OK' : 'TOO_DARK');
                setDark(!dark);
              }}
            />
          </View>
          <Pressable
            style={styles.hold}
            onPressIn={() => {
              ss.mock?.setManualBreathing(true);
              ss.mock?.setInhaling(true);
            }}
            onPressOut={() => ss.mock?.setInhaling(false)}
          >
            <Text style={styles.btnText}>HOLD TO INHALE · RELEASE TO EXHALE</Text>
          </Pressable>
        </Section>
      )}
    </ScrollView>
  );
}

// --- hooks -----------------------------------------------------------------

function useEventRates(running: boolean) {
  const [rates, setRates] = useState({ fast: 0, vitals: 0, trace: 0 });
  useEffect(() => {
    if (!running) return;
    const src = signalStore.getSource();
    if (!src) return;
    let fast = 0;
    let vitals = 0;
    let trace = 0;
    const unsub = src.subscribe({
      onFastSignals: () => fast++,
      onVitals: () => vitals++,
      onTrace: (e) => (trace += e.chest.length),
    });
    const WINDOW = 3;
    const id = setInterval(() => {
      setRates({ fast: fast / WINDOW, vitals: vitals / WINDOW, trace: trace / WINDOW });
      fast = vitals = trace = 0;
    }, WINDOW * 1000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [running]);
  return rates;
}

function useTrace(running: boolean) {
  const [values, setValues] = useState<number[]>([]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const { values: v } = signalStore.getTrace(300);
      // Downsample to ~75 bars.
      const step = Math.max(1, Math.floor(v.length / 75));
      const out: number[] = [];
      for (let i = 0; i < v.length; i += step) out.push(v[i]);
      setValues(out);
    }, 150);
    return () => clearInterval(id);
  }, [running]);
  return values;
}

// --- tiny UI kit -------------------------------------------------------------

function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return <Text style={styles.sub}>waiting for trace…</Text>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return (
    <View style={styles.spark}>
      {values.map((v, i) => (
        <View key={i} style={[styles.bar, { height: `${8 + ((v - min) / span) * 92}%` }]} />
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Line({ k, v, note, warn }: { k: string; v: string; note?: string; warn?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.key}>{k}</Text>
      <Text style={[styles.val, warn && styles.warn]}>{v}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

function Btn(p: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      style={[styles.btn, p.primary && styles.btnPrimary, p.disabled && styles.disabled]}
    >
      <Text style={styles.btnText}>{p.label}</Text>
    </Pressable>
  );
}

function Chip(p: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      style={[styles.chip, p.active && styles.chipActive, p.disabled && !p.active && styles.disabled]}
    >
      <Text style={[styles.chipText, p.active && styles.chipTextActive]}>{p.label.toUpperCase()}</Text>
    </Pressable>
  );
}

const C = {
  bg: '#05080d',
  panel: '#0d141d',
  line: '#1b2633',
  text: '#d7e3ee',
  muted: '#6f8294',
  accent: '#38e1a8',
  warn: '#ff6b5e',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingTop: 48, gap: 12 },
  title: { color: C.accent, fontSize: 22, fontWeight: '800', letterSpacing: 4 },
  sub: { color: C.muted, fontSize: 12 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  preview: {
    height: 260,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: C.line,
  },
  jammed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5,8,13,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  jammedText: { color: C.warn, fontWeight: '800', letterSpacing: 3, fontSize: 18 },
  jammedHint: { color: C.text, marginTop: 4 },
  error: { color: C.warn, fontSize: 13 },
  section: { backgroundColor: C.panel, borderRadius: 10, padding: 12, gap: 6, borderWidth: 1, borderColor: C.line },
  sectionTitle: { color: C.muted, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  key: { color: C.muted, width: 92, fontSize: 13 },
  val: { color: C.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  warn: { color: C.warn },
  note: { color: C.muted, fontSize: 11, marginLeft: 'auto' },
  spark: { height: 70, flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  bar: { flex: 1, backgroundColor: C.accent, borderRadius: 1, opacity: 0.85 },
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: C.line },
  btnPrimary: { backgroundColor: '#11624a' },
  btnText: { color: C.text, fontWeight: '700', letterSpacing: 1, fontSize: 12, textAlign: 'center' },
  disabled: { opacity: 0.35 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.line },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  chipTextActive: { color: C.bg },
  hold: { paddingVertical: 16, borderRadius: 8, backgroundColor: '#14324a', marginTop: 4 },
});
