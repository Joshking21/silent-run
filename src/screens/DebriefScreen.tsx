import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { MissionDef } from '../data/missions';
import { formatClock, type DebriefReport } from '../engine/debrief';
import type { SimEvent } from '../engine/stealthSim';
import { Body, Button, Kicker, Panel, Stat, TOP_INSET } from '../ui/components';
import { TimelineChart, momentColor } from '../ui/TimelineChart';
import { COLORS, FONT } from '../ui/theme';

interface Props {
  report: DebriefReport;
  mission: MissionDef;
  hasNext: boolean;
  onRetry: () => void;
  onNext: () => void;
  onRecalibrate: () => void;
  onExit: () => void;
}

/** Collapse bursts of the same moment (e.g. repeated sightings) for legibility. */
function condense(moments: SimEvent[], max = 12): SimEvent[] {
  const out: SimEvent[] = [];
  for (const m of moments) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === m.kind && m.t - prev.t < 4) continue;
    out.push(m);
  }
  return out.slice(0, max);
}

function rankColor(r: DebriefReport['rank']) {
  return r === 'S' ? COLORS.accent : r === 'A' ? COLORS.breath : r === 'B' ? COLORS.text : r === 'C' ? COLORS.warn : COLORS.danger;
}

export function DebriefScreen({ report: r, mission, hasNext, onRetry, onNext, onRecalibrate, onExit }: Props) {
  const { width } = useWindowDimensions();
  const moments = condense(r.moments);
  const c = r.composure;
  const won = r.outcome === 'won';
  const f = new Set(mission.features);

  const recoveryLine =
    r.spikes.length === 0
      ? 'No pulse spikes over +8 BPM. Ice cold.'
      : r.avgRecovery != null
        ? `${r.spikes.length} spike${r.spikes.length > 1 ? 's' : ''}. You got back within +3 BPM of rest in ${r.avgRecovery.toFixed(0)}s on average (best ${r.bestRecovery!.toFixed(0)}s).`
        : `${r.spikes.length} spike${r.spikes.length > 1 ? 's' : ''}, and your pulse hadn't settled by the end of the mission.`;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Kicker color={won ? COLORS.accent : COLORS.danger}>
        {mission.codename} · {won ? 'EXTRACTED' : 'COMPROMISED'}
      </Kicker>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>After-Action Debrief</Text>
          <Body muted>
            {mission.title} · {formatClock(r.duration)} · score {r.score}
          </Body>
        </View>
        <View style={[styles.rank, { borderColor: rankColor(r.rank) }]}>
          <Text style={[styles.rankText, { color: rankColor(r.rank) }]}>{r.rank}</Text>
        </View>
      </View>

      <Panel>
        <Text style={styles.h}>Pressure timeline</Text>
        <TimelineChart width={width - 32 - 30} height={170} samples={r.timeline} moments={moments} duration={r.duration} />
        <View style={styles.legend}>
          <Legend color={COLORS.heat} label="pulse vs rest" />
          <Legend color={COLORS.breath} label="breaths/min" />
          <Legend color={COLORS.accent} label="HRV" />
          <Legend color={COLORS.danger} label="detection" />
        </View>
        {moments.length > 0 && (
          <View style={styles.moments}>
            {moments.map((m, i) => (
              <View key={`${m.t}-${i}`} style={styles.moment}>
                <View style={[styles.dot, { backgroundColor: momentColor(m.kind) }]} />
                <Text style={styles.mTime}>{formatClock(m.t)}</Text>
                <Text style={styles.mLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
        )}
        {r.timeline.every((s) => s.hrDelta == null) && (
          <Body muted style={{ fontSize: 12 }}>No pulse readings came through this run. Check framing and lighting.</Body>
        )}
      </Panel>

      <Panel>
        <Text style={styles.h}>Recovery</Text>
        <View style={styles.row}>
          <Stat
            label="AVG RECOVERY"
            value={r.avgRecovery != null ? `${r.avgRecovery.toFixed(0)}s` : r.spikes.length ? '—' : '0s'}
            color={COLORS.accent}
          />
          <Stat label="PEAK" value={`+${r.peakHrDelta.toFixed(0)}`} sub="bpm over rest" color={COLORS.heat} />
          <Stat label="BASELINE" value={`${r.baseline.hr.toFixed(0)}`} sub="bpm" />
        </View>
        <Body style={{ fontSize: 14 }}>{recoveryLine}</Body>
      </Panel>

      <Panel>
        <Text style={styles.h}>Composure breakdown</Text>
        {f.has('blink') && (
          <Row k="Retinal sweeps held" v={`${c.sweepsEvaded}`} bad={`${c.blinksDuringSweeps} blink${c.blinksDuringSweeps === 1 ? '' : 's'} in a beam`} badOn={c.blinksDuringSweeps > 0} />
        )}
        {f.has('acoustic') && (
          <Row k="Vocal decoys used" v={`${c.decoysUsed}`} bad={`${c.acousticTrips} acoustic trip${c.acousticTrips === 1 ? '' : 's'}`} badOn={c.acousticTrips > 0} />
        )}
        {f.has('breathing') && (
          <Row
            k="Breathing cadence"
            v={c.cadenceAccuracy != null ? `${Math.round(c.cadenceAccuracy * 100)}%` : 'no vent used'}
            bad={c.ventSeconds > 0 ? `${c.ventSeconds.toFixed(0)}s on vents` : ''}
            badOn={false}
          />
        )}
        {f.has('thermal') && <Row k="Thermal pings" v={`${c.thermalPings}`} badOn={c.thermalPings > 0} />}
        {f.has('expression') && <Row k="ID mismatches" v={`${c.checkpointTrips}`} badOn={c.checkpointTrips > 0} />}
        {r.intelTotal > 0 && <Row k="Intel recovered" v={`${r.intel}/${r.intelTotal}`} badOn={false} />}
        <Row k="Peak detection" v={`${Math.round(r.alarmPeak * 100)}%`} badOn={r.alarmPeak > 0.7} />
        {r.jammedSeconds > 1 && <Row k="Optic jammed (paused)" v={`${r.jammedSeconds.toFixed(0)}s`} badOn={false} />}
      </Panel>

      <Body muted style={styles.note}>
        Composure training only. These are estimates from the camera, not medical measurements. This debrief stays on
        your phone and is cleared when you close the app.
      </Body>

      {won && hasNext && <Button label="NEXT OPERATION" onPress={onNext} />}
      <Button label="RETRY MISSION" variant={won && hasNext ? 'ghost' : 'primary'} onPress={onRetry} />
      <View style={styles.row}>
        <Button label="RECALIBRATE" variant="ghost" onPress={onRecalibrate} style={{ flex: 1 }} />
        <Button label="END SESSION" variant="ghost" onPress={onExit} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Row({ k, v, bad, badOn }: { k: string; v: string; bad?: string; badOn: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.k}>{k}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.v, badOn && !bad && { color: COLORS.danger }]}>{v}</Text>
        {bad ? <Text style={[styles.badText, { color: badOn ? COLORS.danger : COLORS.muted }]}>{bad}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingTop: TOP_INSET, gap: 12, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '900' },
  rank: { width: 68, height: 68, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 38, fontWeight: '900', fontFamily: FONT.mono },
  h: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 10, height: 3, borderRadius: 2 },
  legendText: { color: COLORS.muted, fontSize: 11 },
  moments: { gap: 4, marginTop: 4 },
  moment: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  mTime: { color: COLORS.muted, fontFamily: FONT.mono, fontSize: 12, width: 38 },
  mLabel: { color: COLORS.text, fontSize: 13 },
  row: { flexDirection: 'row', gap: 10 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: COLORS.panelEdge },
  k: { color: COLORS.muted, fontSize: 14 },
  v: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  badText: { fontSize: 11 },
  note: { fontSize: 12, textAlign: 'center' },
});
