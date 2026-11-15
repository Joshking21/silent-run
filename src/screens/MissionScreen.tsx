import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { MISSIONS, type MissionDef } from '../data/missions';
import { pacerAt } from '../engine/breathing';
import type { Baseline } from '../engine/calibration';
import { TimelineRecorder, buildReport, formatClock, type DebriefReport } from '../engine/debrief';
import { StealthSim, type BioInput, type SimEvent } from '../engine/stealthSim';
import { BioReader } from '../game/bioReader';
import { GameCanvas } from '../game/GameCanvas';
import type { MockSource } from '../signals/mockSource';
import { signalStore } from '../signals/signalStore';
import { DOCK_THUMB } from '../ui/CameraDock';
import { Button, Meter, TOP_INSET } from '../ui/components';
import { COLORS, FONT } from '../ui/theme';
import { qualityMessage } from './CalibrationScreen';

interface Props {
  mission: MissionDef;
  baseline: Baseline;
  live: boolean;
  mock: MockSource | null;
  onEnd: (report: DebriefReport) => void;
  /** Abort: parent remounts the screen back at the briefing. */
  onQuit: () => void;
  onSelectMission: (index: number) => void;
  onEndSession: () => void;
}

interface Hud {
  t: number;
  alarm: number;
  heat: number;
  hrDelta: number;
  talking: boolean;
  blinking: boolean;
  expression: string;
  breathPhase: 'in' | 'out' | null;
  cadence: number;
  onVent: boolean;
  jammed: boolean;
  intel: number;
  decoyReadyIn: number;
  scan: number | null;
  sweepArmed: 'warn' | 'active' | null;
}

const BAD_EVENTS: Partial<Record<SimEvent['kind'], number>> = {
  guard_sighting: 0.5,
  close_call: 0.7,
  acoustic_trip: 0.6,
  retinal_trip: 0.6,
  thermal_ping: 0.4,
  checkpoint_trip: 0.6,
  heard: 0.3,
};

const TOP_BAR = 64;
const BOTTOM_HUD = 178;
const DEV_BAR = 46;

export function MissionScreen({ mission, baseline, live, mock, onEnd, onQuit, onSelectMission, onEndSession }: Props) {
  const { width, height } = useWindowDimensions();
  const [phase, setPhase] = useState<'briefing' | 'playing' | 'ending'>('briefing');
  const [hud, setHud] = useState<Hud | null>(null);
  const [toast, setToast] = useState<{ text: string; bad: boolean; at: number } | null>(null);
  const [outcome, setOutcome] = useState<'won' | 'lost' | null>(null);
  const mockRef = useRef(mock);
  mockRef.current = mock;

  const onEvent = useCallback((e: SimEvent) => {
    const bad = e.kind in BAD_EVENTS;
    if (e.kind !== 'optic_jammed') setToast({ text: e.label.toUpperCase(), bad, at: Date.now() });
    // Simulated mode: the fake body reacts to danger like a real one would.
    const spike = BAD_EVENTS[e.kind];
    if (spike) mockRef.current?.spike(spike);
  }, []);

  // The parent remounts this screen (via key) for each attempt.
  const sim = useMemo(() => new StealthSim(mission, onEvent), [mission, onEvent]);
  const reader = useMemo(() => new BioReader(baseline), [baseline]);
  const timeline = useMemo(() => new TimelineRecorder(), [sim]);

  const reserved = TOP_INSET + TOP_BAR + BOTTOM_HUD + (mock ? DEV_BAR : 0);
  const tile = Math.max(18, Math.floor(Math.min(width / sim.grid.w, (height - reserved) / sim.grid.h)));

  const readBio = useCallback(() => reader.read(), [reader]);
  const onFrame = useCallback(
    (s: StealthSim) => timeline.sample(s, reader.timelineValues()),
    [timeline, reader],
  );
  const onHud = useCallback((s: StealthSim, bio: BioInput) => {
    const p = s.player;
    const sweep = s.sweeps.find(
      (w) =>
        w.phase !== 'idle' &&
        p.x >= w.def.x && p.x < w.def.x + w.def.w && p.y >= w.def.y && p.y < w.def.y + w.def.h,
    );
    setHud({
      t: s.t,
      alarm: s.alarm,
      heat: s.heat,
      hrDelta: bio.hrDelta,
      talking: bio.isTalking,
      blinking: signalStore.get().isBlinking,
      expression: bio.expression,
      breathPhase: bio.breath.phase,
      cadence: bio.breath.cadence,
      onVent: s.onVent(),
      jammed: s.jammed,
      intel: s.intel,
      decoyReadyIn: s.decoyReadyIn(),
      scan: s.scanning ? s.scanning.progress : null,
      sweepArmed: sweep ? (sweep.phase as 'warn' | 'active') : null,
    });
  }, []);
  const onFinished = useCallback(
    (s: StealthSim) => {
      setOutcome(s.status === 'won' ? 'won' : 'lost');
      setPhase('ending');
      const report = buildReport(s, mission, timeline.samples, baseline);
      setTimeout(() => onEnd(report), 1600);
    },
    [mission, timeline, baseline, onEnd],
  );

  const f = new Set(mission.features);
  const q = signalStore.get();
  const toastVisible = toast && Date.now() - toast.at < 2200;

  return (
    <View style={styles.root}>
      {/* Top bar */}
      <View style={[styles.top, { paddingTop: TOP_INSET }]}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.code}>{mission.codename}</Text>
            <Text style={styles.mTitle}>{mission.title}</Text>
          </View>
          <Text style={styles.clock}>{formatClock(hud?.t ?? 0)}</Text>
          {sim.intelTotal > 0 && (
            <Text style={styles.intel}>
              ■ {hud?.intel ?? 0}/{sim.intelTotal}
            </Text>
          )}
          <Pressable onPress={onQuit} hitSlop={12} style={styles.abort}>
            <Text style={styles.abortText}>ABORT</Text>
          </Pressable>
        </View>
        <View style={styles.alarmRow}>
          <Text style={[styles.label, { color: (hud?.alarm ?? 0) > 0.5 ? COLORS.danger : COLORS.muted }]}>DETECTION</Text>
          <View style={{ flex: 1 }}>
            <Meter value={hud?.alarm ?? 0} color={(hud?.alarm ?? 0) > 0.5 ? COLORS.danger : COLORS.warn} height={7} />
          </View>
        </View>
      </View>

      {/* Map */}
      <View style={styles.mapWrap}>
        <GameCanvas
          sim={sim}
          tile={tile}
          running={phase === 'playing'}
          readBio={readBio}
          onFrame={onFrame}
          onHud={onHud}
          onFinished={onFinished}
        />
        {toastVisible && (
          <View style={[styles.toast, { borderColor: toast.bad ? COLORS.danger : COLORS.accent }]} pointerEvents="none">
            <Text style={[styles.toastText, { color: toast.bad ? COLORS.danger : COLORS.accent }]}>{toast.text}</Text>
          </View>
        )}
        {hud?.sweepArmed && (
          <View style={[styles.callout, { backgroundColor: hud.sweepArmed === 'active' ? COLORS.danger : COLORS.warn }]} pointerEvents="none">
            <Text style={styles.calloutText}>{hud.sweepArmed === 'active' ? "RETINAL LOCK · DON'T BLINK" : 'SCANNER ARMING'}</Text>
          </View>
        )}
        {hud?.scan != null && (
          <View style={[styles.callout, { backgroundColor: COLORS.checkpoint }]} pointerEvents="none">
            <Text style={styles.calloutText}>ID SCAN · HOLD A NEUTRAL FACE · {Math.round(hud.scan * 100)}%</Text>
          </View>
        )}
        {hud?.jammed && phase === 'playing' && (
          <View style={styles.jam} pointerEvents="none">
            <Text style={styles.jamTitle}>OPTIC JAMMED</Text>
            <Text style={styles.jamSub}>{qualityMessage(q.quality, q.hint)}</Text>
            <Text style={styles.jamNote}>Hazards paused. Nothing counts against you.</Text>
          </View>
        )}
        {phase === 'briefing' && (
          <Briefing
            mission={mission}
            onBegin={() => setPhase('playing')}
            onSelectMission={onSelectMission}
            onEndSession={onEndSession}
          />
        )}
        {phase === 'ending' && outcome && (
          <View style={styles.endBanner} pointerEvents="none">
            <Text style={[styles.endText, { color: outcome === 'won' ? COLORS.accent : COLORS.danger }]}>
              {outcome === 'won' ? 'EXTRACTED' : 'COMPROMISED'}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom biometric HUD */}
      <View style={[styles.bottom, live && { paddingRight: DOCK_THUMB.width + DOCK_THUMB.right + 8 }]}>
        <View style={styles.cards}>
          {f.has('thermal') && (
            <Card title="HEAT" color={COLORS.heat}>
              <Text style={[styles.big, { color: heatColor(hud?.heat ?? 0) }]}>{Math.round((hud?.heat ?? 0) * 100)}%</Text>
              <Text style={styles.sub}>
                {(hud?.hrDelta ?? 0) >= 0 ? '+' : ''}
                {(hud?.hrDelta ?? 0).toFixed(0)} bpm vs rest
              </Text>
              <Meter value={hud?.heat ?? 0} color={COLORS.heat} height={5} />
            </Card>
          )}
          {f.has('breathing') && <BreathCard hud={hud} />}
          <Card title="SENSORS" color={COLORS.accent}>
            {(f.has('blink') || f.has('expression')) && (
              <Badge on={!!hud?.blinking} label={hud?.blinking ? 'BLINK' : 'EYES OPEN'} />
            )}
            {f.has('acoustic') && <Badge on={!!hud?.talking} label={hud?.talking ? 'VOICE' : 'SILENT'} />}
            {f.has('expression') && (
              <Badge on={hud?.expression !== 'NEUTRAL'} label={(hud?.expression ?? '—').slice(0, 9)} />
            )}
            {f.has('acoustic') && (hud?.decoyReadyIn ?? 0) > 0 && (
              <Text style={styles.sub}>decoy {Math.ceil(hud!.decoyReadyIn)}s</Text>
            )}
          </Card>
        </View>
        <Text style={styles.hint} numberOfLines={1}>
          Tap a tile to move · {f.has('acoustic') ? 'whisper at ◆ to decoy · ' : ''}
          {f.has('breathing') ? 'breathe slowly on ≋ to cool' : 'keep the phone steady'}
        </Text>
      </View>

      {mock && phase === 'playing' && <MockBar mock={mock} />}
    </View>
  );
}

function heatColor(h: number) {
  return h > 0.66 ? COLORS.danger : h > 0.33 ? COLORS.heat : COLORS.text;
}

function Card({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={[styles.label, { color }]}>{title}</Text>
      {children}
    </View>
  );
}

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <View style={[styles.badge, on && { backgroundColor: COLORS.danger }]}>
      <Text style={[styles.badgeText, on && { color: COLORS.bg }]}>{label}</Text>
    </View>
  );
}

function BreathCard({ hud }: { hud: Hud | null }) {
  const pacer = pacerAt(hud?.t ?? 0);
  const onVent = !!hud?.onVent;
  return (
    <Card title={onVent ? 'VENT · PACE' : 'BREATH'} color={COLORS.breath}>
      {onVent ? (
        <>
          <Text style={[styles.big, { color: COLORS.breath, fontSize: 17 }]}>{pacer.phase === 'in' ? 'BREATHE IN' : 'BREATHE OUT'}</Text>
          <Meter value={pacer.phase === 'in' ? pacer.progress : 1 - pacer.progress} color={COLORS.breath} height={8} />
        </>
      ) : (
        <Text style={[styles.big, { color: COLORS.breath }]}>{hud?.breathPhase === 'in' ? 'IN' : hud?.breathPhase === 'out' ? 'OUT' : '—'}</Text>
      )}
      <Text style={styles.sub}>
        you: {hud?.breathPhase ?? '—'} · rhythm {Math.round((hud?.cadence ?? 0) * 100)}%
      </Text>
    </Card>
  );
}

function Briefing({
  mission,
  onBegin,
  onSelectMission,
  onEndSession,
}: {
  mission: MissionDef;
  onBegin: () => void;
  onSelectMission: (index: number) => void;
  onEndSession: () => void;
}) {
  return (
    <View style={styles.brief}>
      <View style={styles.picker}>
        {MISSIONS.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => onSelectMission(m.index)}
            style={[styles.pick, m.id === mission.id && styles.pickOn]}
          >
            <Text style={[styles.pickText, m.id === mission.id && { color: COLORS.bg }]}>{m.codename}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.code}>{mission.codename} · BRIEFING</Text>
      <Text style={styles.briefTitle}>{mission.title}</Text>
      {mission.briefing.map((b) => (
        <Text key={b} style={styles.briefLine}>
          ▸ {b}
        </Text>
      ))}
      <Button label="BEGIN MISSION" onPress={onBegin} style={{ marginTop: 10 }} />
      <Button label="END SESSION" variant="ghost" onPress={onEndSession} />
    </View>
  );
}

/** Simulated-mode controls so every mechanic can be exercised without a camera. */
function MockBar({ mock }: { mock: MockSource }) {
  return (
    <View style={styles.mockBar}>
      <MockBtn label="SPIKE" onPress={() => mock.spike(0.8)} />
      <MockBtn label="CALM" onPress={() => mock.setStress(0)} />
      <MockBtn label="BLINK" onPress={() => mock.blinkNow()} />
      <MockBtn label="TALK" onPressIn={() => mock.setTalking(true)} onPressOut={() => mock.setTalking(false)} />
      <MockBtn label="SMILE" onPressIn={() => mock.setExpression('HAPPY')} onPressOut={() => mock.setExpression('NEUTRAL')} />
      <MockBtn
        label="INHALE"
        onPressIn={() => {
          mock.setManualBreathing(true);
          mock.setInhaling(true);
        }}
        onPressOut={() => mock.setInhaling(false)}
      />
    </View>
  );
}

function MockBtn(p: { label: string; onPress?: () => void; onPressIn?: () => void; onPressOut?: () => void }) {
  return (
    <Pressable
      onPress={p.onPress}
      onPressIn={p.onPressIn}
      onPressOut={p.onPressOut}
      style={({ pressed }) => [styles.mockBtn, pressed && { backgroundColor: COLORS.panelEdge }]}
    >
      <Text style={styles.mockText}>{p.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  top: { paddingHorizontal: 12, gap: 6, height: TOP_INSET + TOP_BAR, justifyContent: 'flex-end', paddingBottom: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  code: { color: COLORS.accent, fontFamily: FONT.mono, fontSize: 10, letterSpacing: 2, fontWeight: '700' },
  mTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  clock: { color: COLORS.text, fontFamily: FONT.mono, fontSize: 15 },
  intel: { color: COLORS.intel, fontFamily: FONT.mono, fontSize: 13 },
  abort: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: COLORS.panelEdge, borderRadius: 6 },
  abortText: { color: COLORS.muted, fontFamily: FONT.mono, fontSize: 10, letterSpacing: 1 },
  alarmRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: FONT.mono, fontSize: 10, letterSpacing: 2, fontWeight: '700', color: COLORS.muted },
  mapWrap: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  toast: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    backgroundColor: 'rgba(5,8,13,0.88)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  toastText: { fontFamily: FONT.mono, fontWeight: '800', letterSpacing: 2, fontSize: 12 },
  callout: { position: 'absolute', bottom: 8, alignSelf: 'center', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  calloutText: { color: COLORS.bg, fontFamily: FONT.mono, fontWeight: '800', letterSpacing: 1, fontSize: 12 },
  jam: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5,8,13,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 24,
  },
  jamTitle: { color: COLORS.danger, fontFamily: FONT.mono, fontSize: 22, fontWeight: '900', letterSpacing: 4 },
  jamSub: { color: COLORS.text, fontSize: 16, textAlign: 'center' },
  jamNote: { color: COLORS.muted, fontSize: 12 },
  brief: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5,8,13,0.93)',
    padding: 22,
    justifyContent: 'center',
    gap: 10,
  },
  briefTitle: { color: COLORS.text, fontSize: 28, fontWeight: '900' },
  picker: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  pick: { borderWidth: 1, borderColor: COLORS.panelEdge, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  pickOn: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  pickText: { color: COLORS.muted, fontFamily: FONT.mono, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  briefLine: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  endBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,8,13,0.6)',
  },
  endText: { fontFamily: FONT.mono, fontSize: 30, fontWeight: '900', letterSpacing: 6 },
  bottom: { height: BOTTOM_HUD, paddingHorizontal: 10, paddingTop: 8, gap: 6 },
  cards: { flexDirection: 'row', gap: 8, flex: 1 },
  card: {
    flex: 1,
    backgroundColor: COLORS.panel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.panelEdge,
    padding: 9,
    gap: 4,
  },
  big: { fontSize: 22, fontWeight: '900' },
  sub: { color: COLORS.muted, fontSize: 11 },
  badge: { backgroundColor: COLORS.panelEdge, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { color: COLORS.text, fontFamily: FONT.mono, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  hint: { color: COLORS.dim, fontSize: 11, paddingBottom: 6 },
  mockBar: {
    height: DEV_BAR,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.panelEdge,
    paddingTop: 6,
  },
  mockBtn: { flex: 1, borderRadius: 6, backgroundColor: COLORS.panel, alignItems: 'center', justifyContent: 'center' },
  mockText: { color: COLORS.muted, fontFamily: FONT.mono, fontSize: 9, fontWeight: '700' },
});
