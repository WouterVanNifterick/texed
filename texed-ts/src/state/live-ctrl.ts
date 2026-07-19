// Last-received MIDI value per DX7II physical controller, for UI display.
// Fed from the MIDI input router in App; read by the controllers popup.

import { useSyncExternalStore } from 'react';
import type { CtrlName } from '@texed/dx7-format/supplement';

// Defaults mirror engine/controllers.ts: an unplugged FC2/MC pedal reads max.
const values: Record<CtrlName, number> = {
  wheel: 0,
  foot: 0,
  breath: 0,
  at: 0,
  foot2: 127,
  midiCtrl: 127,
};

// Same CC routing as engine/part.ts controlChange().
const CC_TO_CTRL: Record<number, CtrlName> = {
  1: 'wheel',
  2: 'breath',
  4: 'foot',
  11: 'foot2',
  13: 'midiCtrl',
};

const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

function set(name: CtrlName, value: number): void {
  if (values[name] === value) return;
  values[name] = value;
  subs.forEach((cb) => cb());
}

export function trackCc(controller: number, value: number): void {
  const name = CC_TO_CTRL[controller];
  if (name) set(name, value);
}

export function trackAftertouch(value: number): void {
  set('at', value);
}

export function useLiveCtrl(name: CtrlName): number {
  return useSyncExternalStore(subscribe, () => values[name]);
}
