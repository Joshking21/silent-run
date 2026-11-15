import { createContext, useCallback, useContext, useRef, useState, type ReactNode, type RefObject } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { SmartSpectraPreview } from '../../modules/smartspectra-bridge';
import { TOP_INSET } from './components';
import { COLORS } from './theme';

export type DockMode = 'full' | 'thumb' | 'hidden';

export interface DockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Default full-size slot height; CalibrationScreen leaves this much space. */
export const DOCK_FULL = { top: TOP_INSET + 86, height: 300, side: 16 };
export const DOCK_THUMB = { width: 66, height: 88, right: 10, bottom: 10 };

const DockCtx = createContext<(r: DockRect | null) => void>(() => {});

export function DockProvider({ children, mode, alert }: { children: ReactNode; mode: DockMode; alert?: boolean }) {
  const [rect, setRect] = useState<DockRect | null>(null);
  return (
    <DockCtx.Provider value={setRect}>
      {children}
      <CameraDock mode={mode} alert={alert} rect={rect} />
    </DockCtx.Provider>
  );
}

/**
 * Pins the full-size preview to a placeholder view. Call `sync` from the
 * placeholder's onLayout and the parent ScrollView's onScroll.
 */
type ViewRef = React.ComponentRef<typeof View>;

export function useDockSlot(): { ref: RefObject<ViewRef | null>; sync: () => void } {
  const setRect = useContext(DockCtx);
  const ref = useRef<ViewRef>(null);
  const sync = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => setRect({ x, y, width, height }));
  }, [setRect]);
  return { ref, sync };
}

/**
 * One camera preview mounted for the whole session. SmartSpectra binds the
 * preview surface when processing starts, so remounting per screen would
 * kill the feed; instead this view stays mounted and moves/resizes.
 */
function CameraDock({ mode, alert, rect }: { mode: DockMode; alert?: boolean; rect: DockRect | null }) {
  const { width } = useWindowDimensions();
  if (!SmartSpectraPreview) return null;
  const Preview = SmartSpectraPreview;

  const frame =
    mode === 'full'
      ? rect
        ? { top: rect.y, left: rect.x, width: rect.width, height: rect.height, borderRadius: 14 }
        : { top: DOCK_FULL.top, left: DOCK_FULL.side, width: width - DOCK_FULL.side * 2, height: DOCK_FULL.height, borderRadius: 14 }
      : mode === 'thumb'
        ? { bottom: DOCK_THUMB.bottom, right: DOCK_THUMB.right, width: DOCK_THUMB.width, height: DOCK_THUMB.height, borderRadius: 10 }
        : // Hidden but mounted: 1px, fully transparent, out of the way.
          { top: 0, left: 0, width: 1, height: 1, borderRadius: 0, opacity: 0 };

  return (
    <View
      pointerEvents="none"
      style={[styles.dock, frame, { borderColor: alert ? COLORS.danger : COLORS.panelEdge }]}
    >
      <Preview style={StyleSheet.absoluteFill} />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', overflow: 'hidden', backgroundColor: '#000', borderWidth: 1.5, zIndex: 50 },
});
