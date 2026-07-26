// Tiny external store for the shared envelope time axis, in the same shape as
// state/help.ts.
//
// The axis is derived from the envelope parameters themselves - the gate sits
// past the slowest time-to-sustain and the span reaches the slowest release - so
// while a node is being dragged the axis would rescale under the cursor and slide
// every node sideways. Freezing it for the length of the gesture makes the drag
// track the pointer. A store rather than props because all seven envelopes plus
// the overlay's gridlines share one axis: freezing only the edited envelope would
// let the background traces drift out from under it.

import { useSyncExternalStore } from 'react';

let frozen = false;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function setEnvAxisFrozen(next: boolean): void {
  if (frozen === next) return;
  frozen = next;
  subs.forEach((cb) => cb());
}

export function useEnvAxisFrozen(): boolean {
  return useSyncExternalStore(subscribe, () => frozen);
}
