// Tiny external store for the help bar: controls publish a description while
// hovered, the fixed bar at the bottom of the rack renders it. A store (rather
// than context/state in App) keeps hover traffic from re-rendering the editor.

import { useSyncExternalStore } from 'react';

export interface HelpEntry {
  title: string;
  text: string;
}

let current: HelpEntry | null = null;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function setHelp(entry: HelpEntry | null): void {
  current = entry;
  subs.forEach((cb) => cb());
}

export function useHelpEntry(): HelpEntry | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** Spread onto any element to publish help text while the pointer is over it. */
export function helpProps(title: string, text: string) {
  return {
    onPointerEnter: () => setHelp({ title, text }),
    onPointerLeave: () => setHelp(null),
  };
}
