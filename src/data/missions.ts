import type { Vec } from '../engine/grid';

/**
 * Map legend (see engine/grid.ts):
 *  #  wall          .  floor        P  start        E  extraction
 *  H  cover crate   V  thermal vent S  acoustic floor
 *  D  relay console d  decoy speaker C  ID checkpoint
 *  T  thermal sensor (solid)        I  intel
 */

export interface GuardDef {
  /** Patrol loop, tile coordinates. Straight lines between consecutive points. */
  route: Vec[];
  speed?: number; // tiles/s
}

export interface SweepDef {
  /** Tile rectangle the retinal scanner covers. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Full cycle length (s), last `active` seconds of which are the scan. */
  period: number;
  active: number;
  /** Seconds of warning before the scan. */
  warn: number;
  offset: number;
}

export type Feature = 'acoustic' | 'blink' | 'thermal' | 'breathing' | 'expression';

export interface MissionDef {
  id: string;
  index: number;
  codename: string;
  title: string;
  briefing: string[];
  features: Feature[];
  map: string[];
  guards: GuardDef[];
  sweeps: SweepDef[];
  /** Par time in seconds, for ranking. */
  par: number;
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'dead-air',
    index: 0,
    codename: 'OP 01',
    title: 'Dead Air',
    briefing: [
      'Stay silent near patrols. Red floor is wired for sound.',
      'Whisper at a relay console (◆) to throw your voice and pull a guard away.',
      'Retinal scanners lock on for 2 seconds. Do not blink inside the beam.',
      'Tap a tile to move. Keep the phone steady.',
    ],
    features: ['acoustic', 'blink'],
    map: [
      '############',
      '#E...#.....#',
      '#....#..I..#',
      '#....D.....#',
      '##.###...H.#',
      '#SSS.....H.#',
      '#SSS..####.#',
      '#..........#',
      '#.H..#.....#',
      '#.H..#..d..#',
      '####.#.....#',
      '#....####..#',
      '#..I.......#',
      '#.......H..#',
      '#..######..#',
      '#..........#',
      '#.....P....#',
      '############',
    ],
    guards: [
      {
        route: [
          { x: 1, y: 12 },
          { x: 10, y: 12 },
          { x: 10, y: 13 },
          { x: 1, y: 13 },
        ],
      },
      {
        route: [
          { x: 6, y: 1 },
          { x: 10, y: 1 },
          { x: 10, y: 5 },
          { x: 6, y: 5 },
        ],
      },
      {
        route: [
          { x: 6, y: 8 },
          { x: 10, y: 8 },
        ],
        speed: 1.1,
      },
    ],
    sweeps: [
      { x: 1, y: 7, w: 10, h: 1, period: 7, active: 2, warn: 1.5, offset: 0 },
      { x: 1, y: 2, w: 4, h: 2, period: 8, active: 2, warn: 1.5, offset: 3 },
    ],
    par: 120,
  },
  {
    id: 'thermal-grid',
    index: 1,
    codename: 'OP 02',
    title: 'Thermal Grid',
    briefing: [
      'Thermal sensors (▲) read your heat. Your heat is your pulse above your resting baseline.',
      'A spike takes seconds to fade, just like real adrenaline. Plan around it.',
      'On a vent (≋), follow the pacer: breathe in for 4 s and out for 6 s to cool down fast.',
      'Sensors see further the hotter you run.',
    ],
    features: ['acoustic', 'thermal', 'breathing'],
    map: [
      '############',
      '#..E.......#',
      '#..........#',
      '#.T#####T..#',
      '#...V......#',
      '#####..#####',
      '#..........#',
      '#T...VV...T#',
      '#..........#',
      '###.####.###',
      '#..........#',
      '#.H..T...H.#',
      '#..........#',
      '#####.V#####',
      '#..........#',
      '#.H......H.#',
      '#.....P....#',
      '############',
    ],
    guards: [
      {
        route: [
          { x: 1, y: 10 },
          { x: 10, y: 10 },
        ],
      },
      {
        route: [
          { x: 1, y: 14 },
          { x: 10, y: 14 },
        ],
        speed: 1.2,
      },
      {
        route: [
          { x: 1, y: 2 },
          { x: 10, y: 2 },
          { x: 10, y: 1 },
          { x: 1, y: 1 },
        ],
      },
    ],
    sweeps: [],
    par: 150,
  },
  {
    id: 'the-vault',
    index: 2,
    codename: 'OP 03',
    title: 'The Vault',
    briefing: [
      'Every system is live: sound, eyes, heat, breath and face.',
      'ID checkpoints (▣) hold you while they scan. Keep a neutral face until the scan clears.',
      'Grab the vault intel at the centre, then extract north.',
      'Your pulse will climb. Use the vents.',
    ],
    features: ['acoustic', 'blink', 'thermal', 'breathing', 'expression'],
    map: [
      '############',
      '#....E.....#',
      '#..........#',
      '#####C######',
      '#..........#',
      '#..........#',
      '#T..####..T#',
      '#...#..#...#',
      '#.V.#.I#.V.#',
      '#...#..#...#',
      '#S..##.##..#',
      '#S.........#',
      '#S..D......#',
      '######C#####',
      '#..........#',
      '#.H..d...H.#',
      '#.....P....#',
      '############',
    ],
    guards: [
      {
        route: [
          { x: 1, y: 14 },
          { x: 10, y: 14 },
        ],
      },
      {
        route: [
          { x: 2, y: 11 },
          { x: 10, y: 11 },
          { x: 10, y: 12 },
          { x: 2, y: 12 },
        ],
      },
      {
        route: [
          { x: 1, y: 5 },
          { x: 10, y: 5 },
        ],
        speed: 1.3,
      },
      {
        route: [
          { x: 1, y: 2 },
          { x: 10, y: 2 },
        ],
        speed: 1.0,
      },
    ],
    sweeps: [
      { x: 1, y: 4, w: 10, h: 2, period: 8, active: 2, warn: 1.5, offset: 0 },
      { x: 5, y: 7, w: 2, h: 3, period: 6, active: 2, warn: 1.2, offset: 2 },
    ],
    par: 180,
  },
];
