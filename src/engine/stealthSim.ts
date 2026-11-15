import type { Feature, MissionDef, SweepDef } from '../data/missions';
import type { Expression } from '../signals/types';
import type { BreathAnalysis } from './breathing';
import { Grid, centre, dist, tileOf, type Vec } from './grid';

// ---------------------------------------------------------------------------
// Tuning. Every biometric threshold is a *personal delta* from calibration.
// ---------------------------------------------------------------------------
export const TUNING = {
  playerSpeed: 1.5, // tiles/s: a quiet, deliberate operative
  guardSpeed: 1.4,
  guardInvestigateSpeed: 1.9,
  visionRange: 5, // tiles
  visionHalfAngle: (34 * Math.PI) / 180,
  coverSafeDistance: 1.3, // cover hides you beyond this distance
  /** Heat: pulse delta (BPM over baseline) that maps to full heat. */
  heatFullDelta: 18,
  /** Delta ignored as noise before heat starts building. */
  heatDeadband: 2,
  heatRiseTau: 2.5, // s
  heatDecayTau: 7, // s, before vent bonus
  /** Max fraction of heat bloom that good HRV composure suppresses. */
  composureDamping: 0.4,
  /** Vent with perfect cadence: decay this many times faster. */
  ventCoolingBoost: 3.5,
  /** Thermal aura radius around the player (tiles) at heat 0 → 1. */
  auraMin: 0.6,
  auraMax: 2.2,
  /** Thermal sensor detection radius at heat 0 → 1. */
  sensorMin: 0.9,
  sensorMax: 3.6,
  // Alarm (0..1, mission fails at 1)
  sightGain: 0.4, // per second in full view (~2.5 s of exposure to fail)
  thermalGain: 0.6,
  alarmDecay: 0.04,
  acousticTrip: 0.45,
  hearingRange: 4.5,
  hearingAlarm: 0.12,
  retinalTrip: 0.5,
  checkpointTrip: 0.4,
  checkpointScan: 1.8, // s of neutral face
  checkpointBadHold: 0.5, // s of non-neutral before a trip
  expressionTripConfidence: 50,
  decoyTalkTime: 0.8, // s of whispering on a console
  decoyDuration: 7,
  decoyCooldown: 10,
  investigateLook: 3, // s spent looking around at a noise
};

export interface BioInput {
  /** False while framing/lighting is bad: the sim freezes (no unfair fails). */
  signalValid: boolean;
  hrDelta: number;
  /** 0..1 from HRV vs baseline; 1 when HRV unavailable. */
  composure: number;
  isTalking: boolean;
  blinkCount: number;
  expression: Expression;
  expressionConfidence: number;
  breath: BreathAnalysis;
  /** False if the API key lacks face metrics: face hazards switch off. */
  faceAvailable: boolean;
}

export type GuardState = 'patrol' | 'investigate' | 'look' | 'return';

export interface Guard {
  id: number;
  pos: Vec;
  facing: number; // radians, 0 = +x (east)
  route: Vec[];
  routeIdx: number;
  speed: number;
  state: GuardState;
  path: Vec[];
  lookTimer: number;
  seesPlayer: boolean;
  /** Field of view polygon points (for rendering), updated each step. */
  cone: Vec[];
}

export type SweepPhase = 'idle' | 'warn' | 'active';

export interface SweepState {
  def: SweepDef;
  phase: SweepPhase;
  /** 0..1 progress of the beam across the rect during 'active'. */
  beam: number;
  /** Player was inside during this activation. */
  engaged: boolean;
  tripped: boolean;
}

export type SimEventKind =
  | 'guard_sighting'
  | 'close_call'
  | 'acoustic_trip'
  | 'heard'
  | 'decoy'
  | 'retinal_trip'
  | 'sweep_evaded'
  | 'thermal_ping'
  | 'vent_cooling'
  | 'checkpoint_trip'
  | 'checkpoint_cleared'
  | 'intel'
  | 'optic_jammed'
  | 'extracted'
  | 'compromised';

export interface SimEvent {
  t: number;
  kind: SimEventKind;
  label: string;
}

export type SimStatus = 'playing' | 'won' | 'lost';

export class StealthSim {
  readonly grid: Grid;
  readonly mission: MissionDef;
  readonly features: Set<Feature>;

  t = 0; // sim seconds (frozen while jammed)
  status: SimStatus = 'playing';
  jammed = false;

  player: Vec;
  playerPath: Vec[] = [];
  heat = 0;
  alarm = 0;
  alarmPeak = 0;
  intel = 0;
  intelTotal: number;
  guards: Guard[];
  sweeps: SweepState[];

  // Checkpoint scan
  scanning: { tile: Vec; progress: number; bad: number } | null = null;
  private clearedCheckpoints = new Set<string>();

  // Decoy
  decoy: { pos: Vec; until: number } | null = null;
  private decoyTalk = 0;
  private decoyReadyAt = 0;
  readonly decoyTargets: Vec[];
  readonly sensors: Vec[];
  /** Sensors currently detecting the player (for rendering). */
  sensorsHot = new Set<number>();

  // Edge detection
  private lastTalking = false;
  private lastBlinkCount: number | null = null;
  private acousticCooldown = 0;
  private wasSeen = false;
  private wasCloseCall = false;
  private wasThermal = false;
  private ventLogged = 0;

  // Debrief counters
  stats = {
    blinksDuringSweeps: 0,
    sweepsEvaded: 0,
    sweepsTripped: 0,
    decoysUsed: 0,
    acousticTrips: 0,
    thermalPings: 0,
    checkpointTrips: 0,
    ventSeconds: 0,
    /** Sum of cadence × dt while on vents, for an accuracy average. */
    ventCadenceSum: 0,
    jammedSeconds: 0,
  };

  private events: SimEvent[] = [];
  private onEvent?: (e: SimEvent) => void;

  constructor(mission: MissionDef, onEvent?: (e: SimEvent) => void) {
    this.mission = mission;
    this.grid = new Grid(mission.map);
    this.features = new Set(mission.features);
    this.onEvent = onEvent;
    this.player = centre(this.grid.find('P')[0]);
    this.intelTotal = this.grid.find('I').length;
    this.decoyTargets = this.grid.find('d').map(centre);
    this.sensors = this.grid.find('T').map(centre);
    this.guards = mission.guards.map((g, i) => {
      const start = centre(g.route[0]);
      const next = centre(g.route[1 % g.route.length]);
      return {
        id: i,
        pos: start,
        facing: Math.atan2(next.y - start.y, next.x - start.x),
        route: g.route,
        routeIdx: 1 % g.route.length,
        speed: g.speed ?? TUNING.guardSpeed,
        state: 'patrol',
        path: [],
        lookTimer: 0,
        seesPlayer: false,
        cone: [],
      };
    });
    this.sweeps = mission.sweeps.map((def) => ({
      def,
      phase: 'idle',
      beam: 0,
      engaged: false,
      tripped: false,
    }));
    this.guards.forEach((g) => this.updateCone(g));
  }

  getEvents() {
    return this.events;
  }

  // --- input ---------------------------------------------------------------

  /** Tap-to-move. Returns false if the tile is unreachable. */
  moveTo(tile: Vec): boolean {
    if (this.status !== 'playing' || this.scanning) return false;
    const target = this.grid.walkable(tile.x, tile.y) ? tile : this.grid.nearestWalkable(centre(tile));
    if (!target) return false;
    const here = tileOf(this.player);
    const path = this.grid.path(here, target);
    if (!path) return false;
    // Re-routing mid-step: settle back onto the current tile's centre first so
    // the operative never cuts diagonally across a wall corner.
    const c = centre(here);
    const offCentre = Math.hypot(this.player.x - c.x, this.player.y - c.y) > 0.05;
    this.playerPath = offCentre && (!path.length || dist(centre(path[0]), this.player) > 1.01) ? [here, ...path] : path;
    return true;
  }

  // --- simulation ----------------------------------------------------------

  step(dtRaw: number, bio: BioInput) {
    if (this.status !== 'playing') return;
    const dt = Math.min(dtRaw, 0.1); // clamp after hitches

    // Signal-quality gate: freeze everything rather than fail the player.
    if (!bio.signalValid) {
      if (!this.jammed) this.emit('optic_jammed', 'Optic jammed');
      this.jammed = true;
      this.stats.jammedSeconds += dt;
      return;
    }
    this.jammed = false;
    this.t += dt;

    const face = bio.faceAvailable;
    const blinked = this.consumeBlink(bio.blinkCount);
    const talkOnset = bio.isTalking && !this.lastTalking;
    this.lastTalking = bio.isTalking;
    this.acousticCooldown = Math.max(0, this.acousticCooldown - dt);

    this.stepHeat(dt, bio);
    this.stepPlayer(dt, bio);
    if (this.features.has('acoustic') && face) this.stepAcoustic(dt, bio.isTalking, talkOnset);
    if (this.features.has('blink') && face) this.stepSweeps(blinked);
    this.stepGuards(dt);
    const seen = this.detectByGuards(dt);
    const thermal = this.features.has('thermal') ? this.detectBySensors(dt) : false;

    if (!seen && !thermal) this.alarm = Math.max(0, this.alarm - TUNING.alarmDecay * dt);
    this.alarm = Math.min(1, this.alarm);
    this.alarmPeak = Math.max(this.alarmPeak, this.alarm);

    if (this.alarm >= 0.5 && !this.wasCloseCall) this.emit('close_call', 'Close call');
    if (this.alarm < 0.3) this.wasCloseCall = false;
    else if (this.alarm >= 0.5) this.wasCloseCall = true;

    if (this.alarm >= 1) {
      this.status = 'lost';
      this.emit('compromised', 'Compromised');
      return;
    }
    if (this.grid.at(Math.floor(this.player.x), Math.floor(this.player.y)) === 'E') {
      this.status = 'won';
      this.emit('extracted', 'Extracted');
    }
  }

  // --- heat (pulse delta → thermal signature) -------------------------------

  /** Thermal aura radius in tiles. */
  get aura() {
    return TUNING.auraMin + this.heat * (TUNING.auraMax - TUNING.auraMin);
  }

  onVent() {
    return this.tileAtPlayer() === 'V';
  }

  private stepHeat(dt: number, bio: BioInput) {
    if (!this.features.has('thermal')) {
      this.heat = 0;
      return;
    }
    const over = Math.max(0, bio.hrDelta - TUNING.heatDeadband);
    let target = Math.min(1, over / (TUNING.heatFullDelta - TUNING.heatDeadband));
    target *= 1 - TUNING.composureDamping * bio.composure;

    let decayTau = TUNING.heatDecayTau;
    if (this.features.has('breathing') && this.onVent()) {
      const c = bio.breath.cadence;
      decayTau /= 1 + TUNING.ventCoolingBoost * c;
      target *= 1 - 0.6 * c;
      this.stats.ventSeconds += dt;
      this.stats.ventCadenceSum += c * dt;
      if (c > 0.6 && this.t - this.ventLogged > 8) {
        this.ventLogged = this.t;
        this.emit('vent_cooling', 'Vent cooling');
      }
    }
    // Lagged response: blooms in seconds, lingers longer (adrenaline-like).
    const tau = target > this.heat ? TUNING.heatRiseTau : decayTau;
    this.heat += (target - this.heat) * (1 - Math.exp(-dt / tau));
  }

  // --- player ---------------------------------------------------------------

  private tileAtPlayer() {
    return this.grid.at(Math.floor(this.player.x), Math.floor(this.player.y));
  }

  playerInCover() {
    return this.tileAtPlayer() === 'H';
  }

  private stepPlayer(dt: number, bio: BioInput) {
    if (this.scanning) {
      this.stepCheckpoint(dt, bio);
      return;
    }
    let budget = TUNING.playerSpeed * dt;
    while (budget > 0 && this.playerPath.length) {
      const target = centre(this.playerPath[0]);
      const d = dist(this.player, target);
      if (d <= budget) {
        this.player = target;
        budget -= d;
        this.playerPath.shift();
        if (this.onArriveTile(bio)) break;
      } else {
        this.player = {
          x: this.player.x + ((target.x - this.player.x) / d) * budget,
          y: this.player.y + ((target.y - this.player.y) / d) * budget,
        };
        budget = 0;
      }
    }
  }

  /** Returns true if movement should halt (checkpoint scan). */
  private onArriveTile(bio: BioInput): boolean {
    const t = tileOf(this.player);
    const tile = this.grid.at(t.x, t.y);
    if (tile === 'I') {
      this.intel++;
      this.grid.set(t.x, t.y, '.');
      this.emit('intel', `Intel ${this.intel}/${this.intelTotal}`);
    }
    if (tile === 'C') {
      const key = `${t.x},${t.y}`;
      if (this.clearedCheckpoints.has(key)) return false;
      if (!this.features.has('expression') || !bio.faceAvailable) {
        this.clearedCheckpoints.add(key);
        return false;
      }
      this.scanning = { tile: t, progress: 0, bad: 0 };
      return true;
    }
    return false;
  }

  private stepCheckpoint(dt: number, bio: BioInput) {
    const s = this.scanning!;
    const nonNeutral =
      bio.expression !== 'NEUTRAL' &&
      bio.expression !== 'UNKNOWN' &&
      bio.expressionConfidence >= TUNING.expressionTripConfidence;
    if (nonNeutral) {
      s.bad += dt;
      if (s.bad >= TUNING.checkpointBadHold) {
        this.alarm += TUNING.checkpointTrip;
        this.stats.checkpointTrips++;
        this.emit('checkpoint_trip', `ID mismatch (${bio.expression.toLowerCase()})`);
        s.bad = 0;
        s.progress = 0;
      }
    } else {
      s.bad = Math.max(0, s.bad - dt);
      s.progress += dt / TUNING.checkpointScan;
      if (s.progress >= 1) {
        this.clearedCheckpoints.add(`${s.tile.x},${s.tile.y}`);
        this.scanning = null;
        this.emit('checkpoint_cleared', 'Checkpoint cleared');
      }
    }
  }

  // --- acoustic: silence zones, hearing, decoys -----------------------------

  private stepAcoustic(dt: number, talking: boolean, onset: boolean) {
    const tile = this.tileAtPlayer();
    if (!talking) {
      this.decoyTalk = 0;
      return;
    }
    if (tile === 'D') {
      // Intentional whisper at a relay console throws a decoy.
      this.decoyTalk += dt;
      if (this.decoyTalk >= TUNING.decoyTalkTime && this.t >= this.decoyReadyAt) {
        this.throwDecoy();
        this.decoyTalk = 0;
      }
      return;
    }
    if (tile === 'S' && this.acousticCooldown === 0) {
      this.alarm += TUNING.acousticTrip;
      this.acousticCooldown = 2;
      this.stats.acousticTrips++;
      this.emit('acoustic_trip', 'Acoustic sensor tripped');
      return;
    }
    if (onset) {
      // Guards in earshot come to check your position.
      let heard = false;
      for (const g of this.guards) {
        if (dist(g.pos, this.player) <= TUNING.hearingRange) {
          this.investigate(g, this.player);
          heard = true;
        }
      }
      if (heard) {
        this.alarm += TUNING.hearingAlarm;
        this.emit('heard', 'Guard heard you');
      }
    }
  }

  private throwDecoy() {
    if (!this.decoyTargets.length) return;
    // Nearest decoy speaker to the console, nearest guard to that speaker.
    const target = this.decoyTargets.reduce((a, b) =>
      dist(a, this.player) < dist(b, this.player) ? a : b,
    );
    const guard = this.guards.reduce((a, b) => (dist(a.pos, target) < dist(b.pos, target) ? a : b));
    this.investigate(guard, target, TUNING.decoyDuration);
    this.decoy = { pos: target, until: this.t + 2.5 };
    this.decoyReadyAt = this.t + TUNING.decoyCooldown;
    this.stats.decoysUsed++;
    this.emit('decoy', 'Vocal decoy thrown');
  }

  decoyReadyIn() {
    return Math.max(0, this.decoyReadyAt - this.t);
  }

  // --- retinal sweeps --------------------------------------------------------

  private consumeBlink(count: number): boolean {
    if (this.lastBlinkCount == null) {
      this.lastBlinkCount = count;
      return false;
    }
    const blinked = count > this.lastBlinkCount;
    this.lastBlinkCount = count;
    return blinked;
  }

  private inRect(p: Vec, s: SweepDef) {
    return p.x >= s.x && p.x < s.x + s.w && p.y >= s.y && p.y < s.y + s.h;
  }

  private stepSweeps(blinked: boolean) {
    for (const s of this.sweeps) {
      const { period, active, warn, offset } = s.def;
      const p = (((this.t + offset) % period) + period) % period;
      const prev = s.phase;
      s.phase = p >= period - active ? 'active' : p >= period - active - warn ? 'warn' : 'idle';
      s.beam = s.phase === 'active' ? (p - (period - active)) / active : 0;

      if (s.phase === 'active') {
        if (prev !== 'active') {
          s.engaged = false;
          s.tripped = false;
        }
        if (this.inRect(this.player, s.def)) {
          s.engaged = true;
          if (blinked && !s.tripped) {
            s.tripped = true;
            this.alarm += TUNING.retinalTrip;
            this.stats.blinksDuringSweeps++;
            this.stats.sweepsTripped++;
            this.emit('retinal_trip', 'Retinal sweep: blink detected');
          }
        }
      } else if (prev === 'active' && s.engaged && !s.tripped) {
        this.stats.sweepsEvaded++;
        this.emit('sweep_evaded', 'Retinal sweep held');
      }
    }
  }

  // --- guards ---------------------------------------------------------------

  private investigate(g: Guard, at: Vec, look = TUNING.investigateLook) {
    const path = this.grid.path(tileOf(g.pos), tileOf(at));
    if (!path) return;
    g.state = 'investigate';
    g.path = path;
    g.lookTimer = look;
  }

  private stepGuards(dt: number) {
    for (const g of this.guards) {
      switch (g.state) {
        case 'patrol': {
          const target = centre(g.route[g.routeIdx]);
          if (this.moveGuard(g, target, g.speed * dt)) g.routeIdx = (g.routeIdx + 1) % g.route.length;
          break;
        }
        case 'investigate':
        case 'return': {
          if (!g.path.length) {
            if (g.state === 'investigate') g.state = 'look';
            else g.state = 'patrol';
            break;
          }
          const speed = g.state === 'investigate' ? TUNING.guardInvestigateSpeed : g.speed;
          if (this.moveGuard(g, centre(g.path[0]), speed * dt)) g.path.shift();
          break;
        }
        case 'look': {
          g.lookTimer -= dt;
          g.facing += dt * 1.6; // sweep around
          if (g.lookTimer <= 0) {
            // Head back to the nearest point on the patrol route.
            let best = 0;
            g.route.forEach((r, i) => {
              if (dist(centre(r), g.pos) < dist(centre(g.route[best]), g.pos)) best = i;
            });
            g.routeIdx = best;
            g.path = this.grid.path(tileOf(g.pos), g.route[best]) ?? [];
            g.state = 'return';
          }
          break;
        }
      }
      this.updateCone(g);
    }
  }

  /** Moves toward target; returns true on arrival. Turns to face travel. */
  private moveGuard(g: Guard, target: Vec, budget: number): boolean {
    const d = dist(g.pos, target);
    if (d < 1e-3) return true;
    const want = Math.atan2(target.y - g.pos.y, target.x - g.pos.x);
    g.facing = turnToward(g.facing, want, budget * 3);
    if (d <= budget) {
      g.pos = target;
      return true;
    }
    g.pos = { x: g.pos.x + ((target.x - g.pos.x) / d) * budget, y: g.pos.y + ((target.y - g.pos.y) / d) * budget };
    return false;
  }

  private updateCone(g: Guard) {
    const rays = 14;
    const pts: Vec[] = [g.pos];
    for (let i = 0; i <= rays; i++) {
      const a = g.facing - TUNING.visionHalfAngle + (2 * TUNING.visionHalfAngle * i) / rays;
      const len = this.grid.rayLength(g.pos, a, TUNING.visionRange);
      pts.push({ x: g.pos.x + Math.cos(a) * len, y: g.pos.y + Math.sin(a) * len });
    }
    g.cone = pts;
  }

  private detectByGuards(dt: number): boolean {
    let anySeen = false;
    const inCover = this.playerInCover();
    for (const g of this.guards) {
      const d = dist(g.pos, this.player);
      let sees = false;
      if (d <= TUNING.visionRange && this.grid.lineOfSight(g.pos, this.player)) {
        const ang = Math.atan2(this.player.y - g.pos.y, this.player.x - g.pos.x);
        const inCone = Math.abs(angleDiff(ang, g.facing)) <= TUNING.visionHalfAngle;
        const hiddenByCover = inCover && d > TUNING.coverSafeDistance;
        // Thermal aura: guards sense you up close, from any direction.
        const sensed = this.features.has('thermal') && d <= this.aura;
        sees = (inCone && !hiddenByCover) || sensed;
      }
      g.seesPlayer = sees;
      if (sees) {
        anySeen = true;
        const closeness = 1 - (d / TUNING.visionRange) * 0.5;
        this.alarm += TUNING.sightGain * closeness * dt;
        if (g.state === 'patrol' || g.state === 'return') this.investigate(g, this.player, 2);
      }
    }
    if (anySeen && !this.wasSeen) this.emit('guard_sighting', 'Guard sighting');
    this.wasSeen = anySeen;
    return anySeen;
  }

  /** Thermal sensor detection radius (tiles) at current heat. */
  get sensorRadius() {
    return TUNING.sensorMin + this.heat * (TUNING.sensorMax - TUNING.sensorMin);
  }

  private detectBySensors(dt: number): boolean {
    this.sensorsHot.clear();
    const r = this.sensorRadius;
    this.sensors.forEach((s, i) => {
      if (dist(s, this.player) <= r && this.grid.lineOfSight(s, this.player)) this.sensorsHot.add(i);
    });
    const hot = this.sensorsHot.size > 0;
    if (hot) {
      this.alarm += TUNING.thermalGain * dt;
      if (!this.wasThermal) {
        this.stats.thermalPings++;
        this.emit('thermal_ping', 'Thermal sensor ping');
      }
    }
    this.wasThermal = hot;
    return hot;
  }

  private emit(kind: SimEventKind, label: string) {
    const e = { t: this.t, kind, label };
    this.events.push(e);
    this.onEvent?.(e);
  }
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function turnToward(cur: number, want: number, maxStep: number) {
  const d = angleDiff(want, cur);
  if (Math.abs(d) <= maxStep) return want;
  return cur + Math.sign(d) * maxStep;
}
