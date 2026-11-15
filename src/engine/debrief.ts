import type { MissionDef } from '../data/missions';
import type { Baseline } from './calibration';
import type { SimEvent, StealthSim } from './stealthSim';

/** One biometric sample per second of mission time. */
export interface TimelineSample {
  t: number;
  hrDelta: number | null;
  rmssd: number | null;
  breathRate: number | null;
  heat: number;
  alarm: number;
}

export interface Spike {
  peakT: number;
  peakDelta: number;
  /** Seconds from peak back to within +3 BPM of baseline, null if never. */
  recovery: number | null;
}

export interface DebriefReport {
  missionId: string;
  outcome: 'won' | 'lost';
  duration: number;
  rank: 'S' | 'A' | 'B' | 'C' | 'D';
  score: number;
  timeline: TimelineSample[];
  /** Mission moments worth plotting (filtered from all sim events). */
  moments: SimEvent[];
  spikes: Spike[];
  avgRecovery: number | null;
  bestRecovery: number | null;
  peakHrDelta: number;
  composure: {
    blinksDuringSweeps: number;
    sweepsEvaded: number;
    decoysUsed: number;
    acousticTrips: number;
    thermalPings: number;
    checkpointTrips: number;
    /** 0..1 average breathing cadence accuracy while on vents, null if never on one. */
    cadenceAccuracy: number | null;
    ventSeconds: number;
  };
  intel: number;
  intelTotal: number;
  alarmPeak: number;
  jammedSeconds: number;
  baseline: Baseline;
}

const SPIKE_THRESHOLD = 8; // BPM over baseline counts as a spike
const RECOVERED_WITHIN = 3; // spec: back within +3 BPM

/** Samples the sim + signals once per mission second. */
export class TimelineRecorder {
  readonly samples: TimelineSample[] = [];
  private nextT = 0;

  sample(sim: StealthSim, s: { hrDelta: number | null; rmssd: number | null; breathRate: number | null }) {
    if (sim.t < this.nextT) return;
    this.nextT = Math.floor(sim.t) + 1;
    this.samples.push({
      t: sim.t,
      hrDelta: s.hrDelta,
      rmssd: s.rmssd,
      breathRate: s.breathRate,
      heat: sim.heat,
      alarm: sim.alarm,
    });
  }
}

const MOMENT_KINDS = new Set<SimEvent['kind']>([
  'guard_sighting',
  'close_call',
  'acoustic_trip',
  'heard',
  'decoy',
  'retinal_trip',
  'sweep_evaded',
  'thermal_ping',
  'vent_cooling',
  'checkpoint_trip',
  'checkpoint_cleared',
  'intel',
  'extracted',
  'compromised',
]);

export function findSpikes(timeline: TimelineSample[]): Spike[] {
  const spikes: Spike[] = [];
  let i = 0;
  while (i < timeline.length) {
    const d = timeline[i].hrDelta;
    if (d == null || d < SPIKE_THRESHOLD) {
      i++;
      continue;
    }
    // Climb to the local peak.
    let peak = i;
    while (
      peak + 1 < timeline.length &&
      (timeline[peak + 1].hrDelta ?? -Infinity) >= (timeline[peak].hrDelta ?? -Infinity)
    )
      peak++;
    // Walk forward until recovered.
    let j = peak;
    while (j < timeline.length && (timeline[j].hrDelta ?? Infinity) > RECOVERED_WITHIN) j++;
    spikes.push({
      peakT: timeline[peak].t,
      peakDelta: timeline[peak].hrDelta!,
      recovery: j < timeline.length ? timeline[j].t - timeline[peak].t : null,
    });
    i = j + 1;
  }
  return spikes;
}

export function buildReport(
  sim: StealthSim,
  mission: MissionDef,
  timeline: TimelineSample[],
  baseline: Baseline,
): DebriefReport {
  const spikes = findSpikes(timeline);
  const recovered = spikes.map((s) => s.recovery).filter((r): r is number => r != null);
  const avgRecovery = recovered.length ? recovered.reduce((a, b) => a + b, 0) / recovered.length : null;
  const bestRecovery = recovered.length ? Math.min(...recovered) : null;
  const peakHrDelta = Math.max(0, ...timeline.map((s) => s.hrDelta ?? 0));
  const st = sim.stats;
  const cadenceAccuracy = st.ventSeconds > 1 ? st.ventCadenceSum / st.ventSeconds : null;
  const outcome = sim.status === 'won' ? 'won' : 'lost';

  // Score: stealth first, composure second, speed third.
  let score = outcome === 'won' ? 600 : 150;
  score -= Math.round(sim.alarmPeak * 200);
  score -= (st.acousticTrips + st.sweepsTripped + st.checkpointTrips) * 60;
  score += st.sweepsEvaded * 25 + st.decoysUsed * 20;
  score += sim.intel * 80;
  if (cadenceAccuracy != null) score += Math.round(cadenceAccuracy * 100);
  if (avgRecovery != null) score += Math.max(0, Math.round(60 - avgRecovery * 3));
  else if (outcome === 'won') score += 60; // never spiked: ice cold
  if (outcome === 'won') score += Math.max(0, Math.round((mission.par - sim.t) * 1.5));
  score = Math.max(0, score);

  const rank = outcome === 'lost' ? 'D' : score >= 850 ? 'S' : score >= 700 ? 'A' : score >= 520 ? 'B' : 'C';

  return {
    missionId: mission.id,
    outcome,
    duration: sim.t,
    rank,
    score,
    timeline,
    moments: sim.getEvents().filter((e) => MOMENT_KINDS.has(e.kind)),
    spikes,
    avgRecovery,
    bestRecovery,
    peakHrDelta,
    composure: {
      blinksDuringSweeps: st.blinksDuringSweeps,
      sweepsEvaded: st.sweepsEvaded,
      decoysUsed: st.decoysUsed,
      acousticTrips: st.acousticTrips,
      thermalPings: st.thermalPings,
      checkpointTrips: st.checkpointTrips,
      cadenceAccuracy,
      ventSeconds: st.ventSeconds,
    },
    intel: sim.intel,
    intelTotal: sim.intelTotal,
    alarmPeak: sim.alarmPeak,
    jammedSeconds: st.jammedSeconds,
    baseline,
  };
}

export function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
