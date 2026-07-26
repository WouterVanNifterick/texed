// Undo/redo for the edited patch.
//
// Scope is the selected part's edit buffer - the 156-byte voice plus its 35-byte
// AMEM supplement - because that is what "undo" means while designing a sound.
// Part routing, program selection and global settings are deliberately outside
// it: undoing a knob tweak should not also move you to a different part.
//
// History observes the mirror rather than wrapping every action, so any edit path
// (knob, envelope drag, program load, dropped file) is covered without each one
// having to remember to record itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Synth } from '../audio/synth-types';

/** A knob drag posts a value per pointer event; one undo should span the drag. */
const COALESCE_MS = 350;

const MAX_DEPTH = 100;

interface Snapshot {
  voice: Uint8Array;
  supplement: Uint8Array;
}

export interface History {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return sameBytes(a.voice, b.voice) && sameBytes(a.supplement, b.supplement);
}

export function useHistory(synth: Synth, enabled: boolean): History {
  const { voice, supplement, setVoice } = synth;

  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  /** The newest state that has been folded into history. */
  const committed = useRef<Snapshot | null>(null);
  /**
   * The snapshot an undo/redo is pushing into the synth. Compared by value, not
   * a boolean flag, because applying one produces both an optimistic local
   * update and a later echo from the worklet, and neither should be recorded.
   */
  const applying = useRef<Snapshot | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [{ canUndo, canRedo }, setFlags] = useState({ canUndo: false, canRedo: false });
  const publish = useCallback(() => {
    setFlags({ canUndo: past.current.length > 0, canRedo: future.current.length > 0 });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const latest: Snapshot = { voice, supplement };

    if (committed.current === null) {
      committed.current = latest;
      return;
    }
    if (applying.current && sameSnapshot(latest, applying.current)) {
      applying.current = null;
      committed.current = latest;
      return;
    }
    if (sameSnapshot(latest, committed.current)) return;

    // Fold the whole burst into one entry: the timer restarts on every change,
    // so `committed` still holds the state from before the drag began.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const before = committed.current;
      if (!before || sameSnapshot(latest, before)) return;
      past.current.push(before);
      if (past.current.length > MAX_DEPTH) past.current.shift();
      future.current = [];
      committed.current = latest;
      publish();
    }, COALESCE_MS);
  }, [voice, supplement, enabled, publish]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const apply = useCallback(
    (s: Snapshot) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      applying.current = s;
      committed.current = s;
      setVoice(s.voice, { supplement: s.supplement });
      publish();
    },
    [setVoice, publish],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    // The state being left behind becomes the redo target. Take it from the live
    // mirror, not from `committed`, so a drag still inside its coalesce window is
    // not silently dropped.
    future.current.unshift({ voice, supplement });
    apply(prev);
  }, [voice, supplement, apply]);

  const redo = useCallback(() => {
    const next = future.current.shift();
    if (!next) return;
    past.current.push({ voice, supplement });
    apply(next);
  }, [voice, supplement, apply]);

  return { undo, redo, canUndo, canRedo };
}
