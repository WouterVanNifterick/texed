// Tiny external store for the shared envelope time axis, in the same shape as
// state/help.ts. It holds two things: whether the axis is frozen, and the
// zoom/pan window the user has scrolled to.
//
// The axis is derived from the envelope parameters themselves - the gate sits
// past the slowest time-to-sustain and the span reaches the slowest release - so
// while a node is being dragged the axis would rescale under the cursor and slide
// every node sideways. Freezing it for the length of the gesture makes the drag
// track the pointer. A store rather than props because all seven envelopes plus
// the overlay's gridlines share one axis: freezing only the edited envelope would
// let the background traces drift out from under it, and zooming one of them
// would break the shared time scale that makes the overlay readable.

import { useEffect, useSyncExternalStore, type RefObject } from 'react';

/** Visible window of the axis: `pan` is the unzoomed 0..1 position of its left edge. */
export interface EnvView {
  zoom: number;
  pan: number;
}

export const FULL_VIEW: EnvView = { zoom: 1, pan: 0 };
const MAX_ZOOM = 200;

let frozen = false;
let view: EnvView = FULL_VIEW;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

function emit(): void {
  subs.forEach((cb) => cb());
}

export function setEnvAxisFrozen(next: boolean): void {
  if (frozen === next) return;
  frozen = next;
  emit();
}

export function useEnvAxisFrozen(): boolean {
  return useSyncExternalStore(subscribe, () => frozen);
}

export function useEnvView(): EnvView {
  return useSyncExternalStore(subscribe, getEnvView);
}

function setView(zoom: number, pan: number): void {
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const p = Math.min(1 - 1 / z, Math.max(0, pan));
  if (z === view.zoom && p === view.pan) return;
  view = { zoom: z, pan: p };
  emit();
}

/** Scale the window by `factor` around `anchor01`, a fraction of the visible width. */
export function zoomEnvView(factor: number, anchor01: number): void {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * factor));
  // Keep whatever time sits under the anchor pinned there.
  const fixed = view.pan + anchor01 / view.zoom;
  setView(zoom, fixed - anchor01 / zoom);
}

/** Shift the window right by a fraction of the visible width. */
export function panEnvView(dx01: number): void {
  setView(view.zoom, view.pan + dx01 / view.zoom);
}

export function resetEnvView(): void {
  setView(1, 0);
}

export function getEnvView(): EnvView {
  return view;
}

/**
 * Wheel / drag / pinch zoom and pan on an envelope plot, driving the shared
 * view above. Only the time axis zooms; levels always span the full height.
 *
 * `inset` is the fraction of the element each side of the plot leaves blank.
 * Without it the cursor's fraction of the element is not its fraction of the
 * axis, and since every notch re-anchors on that slightly wrong point, the
 * error compounds and the zoom visibly walks away from the pointer.
 *
 * Native listeners rather than React props: the wheel handler has to call
 * preventDefault to stop the page scrolling, and React attaches wheel passively.
 * Node drags are left alone by skipping events that start on a node.
 */
export function useEnvZoomPan(ref: RefObject<HTMLElement | null>, inset = 0): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const width = () => (el.getBoundingClientRect().width || 1) * (1 - 2 * inset);
    const anchor = (clientX: number) => {
      const r = el.getBoundingClientRect();
      const f = (clientX - r.left) / (r.width || 1);
      return Math.min(1, Math.max(0, (f - inset) / (1 - 2 * inset)));
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        panEnvView((e.deltaX || e.deltaY) / width());
      } else {
        // A trackpad pinch arrives as ctrl+wheel with much smaller deltas.
        zoomEnvView(Math.exp(-e.deltaY / (e.ctrlKey ? 60 : 300)), anchor(e.clientX));
      }
    };

    // One pointer pans, two pinch: the spread sets the zoom and the midpoint
    // keeps panning, which is what makes a pinch feel anchored to the fingers.
    const pts = new Map<number, number>();
    let last: { center: number; spread: number } | null = null;

    const measure = () => {
      const xs = [...pts.values()];
      const center = xs.reduce((a, b) => a + b, 0) / xs.length;
      return { center, spread: xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0 };
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if ((e.target as Element | null)?.closest('.env-node')) return;
      pts.set(e.pointerId, e.clientX);
      last = measure();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic pointer ids
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, e.clientX);
      const now = measure();
      if (last) {
        if (now.spread > 20 && last.spread > 20)
          zoomEnvView(now.spread / last.spread, anchor(now.center));
        panEnvView(-(now.center - last.center) / width());
      }
      last = now;
    };

    const onUp = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      // Re-measure from the fingers still down so lifting one does not jump.
      last = pts.size ? measure() : null;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', resetEnvView);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('dblclick', resetEnvView);
    };
  }, [ref, inset]);
}
