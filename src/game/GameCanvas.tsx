import { Canvas, Picture } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable } from 'react-native';

import type { StealthSim } from '../engine/stealthSim';
import type { BioInput } from '../engine/stealthSim';
import { drawDynamic, drawMap } from './render';

interface Props {
  sim: StealthSim;
  tile: number;
  running: boolean;
  readBio: () => BioInput;
  /** Called every frame after the sim steps (for timeline sampling). */
  onFrame: (sim: StealthSim, bio: BioInput) => void;
  /** Called at most every 100 ms with the latest bio input. */
  onHud: (sim: StealthSim, bio: BioInput) => void;
  onFinished: (sim: StealthSim) => void;
}

/** Owns the frame loop so only the canvas redraws at display rate. */
export function GameCanvas({ sim, tile, running, readBio, onFrame, onHud, onFinished }: Props) {
  const [now, setNow] = useState(0);
  const finished = useRef(false);
  const cb = useRef({ readBio, onFrame, onHud, onFinished });
  cb.current = { readBio, onFrame, onHud, onFinished };

  useEffect(() => {
    finished.current = false;
  }, [sim]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    const loop = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      const bio = cb.current.readBio();
      sim.step(dt, bio);
      cb.current.onFrame(sim, bio);
      if (t - hudAt >= 100) {
        hudAt = t;
        cb.current.onHud(sim, bio);
      }
      setNow(t);
      if (sim.status !== 'playing') {
        if (!finished.current) {
          finished.current = true;
          cb.current.onHud(sim, bio);
          cb.current.onFinished(sim);
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim, running]);

  // Static layer: rebuilt only when intel is picked up (tiles change).
  const mapPic = useMemo(() => drawMap(sim.grid, tile), [sim, tile, sim.intel]);
  const dynPic = drawDynamic(sim, tile, now);

  const W = sim.grid.w * tile;
  const H = sim.grid.h * tile;

  return (
    <Pressable
      style={{ width: W, height: H }}
      onPress={(e) => {
        const { locationX, locationY } = e.nativeEvent;
        sim.moveTo({ x: Math.floor(locationX / tile), y: Math.floor(locationY / tile) });
      }}
      accessibilityLabel="Mission map. Tap a tile to move there."
    >
      <Canvas style={{ width: W, height: H }} pointerEvents="none">
        <Picture picture={mapPic} />
        <Picture picture={dynPic} />
      </Canvas>
    </Pressable>
  );
}
