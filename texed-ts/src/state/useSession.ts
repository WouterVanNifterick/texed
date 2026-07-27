// Session persistence wiring: restore on start, then snapshot the rack to
// IndexedDB whenever it changes.

import { useCallback, useEffect } from 'react';
import type { Synth } from '../audio/useSynth';
import { loadSession, saveSession, SESSION_SCHEMA } from './persistence';

/** How long the rack must settle before a snapshot is written. */
const SAVE_DEBOUNCE_MS = 1500;

/** How long to wait for the synth to acknowledge a restore before moving on. */
const ACK_TIMEOUT_MS = 1000;

export interface Session {
  /** Restore the saved rack, if any. Resolves to whether one was applied. */
  restore: () => Promise<boolean>;
}

export function useSession(synth: Synth, started: boolean): Session {
  const restore = useCallback(async () => {
    const saved = await loadSession();
    if (!saved) return false;
    // setFullState restores parts, edit buffers and global settings together.
    synth.setFullState(saved.rack);
    // The worklet handles messages in order, so a round trip issued now can only
    // reply after the events SetFullState emits have been applied to the mirror.
    // That makes "restore has finished" observable instead of a guessed delay,
    // which is what undo history needs to pick the right baseline.
    //
    // Bounded, because everything after this in startup - MIDI connection
    // included - waits on it. A synth that never answers should degrade to a
    // slightly wrong undo baseline, not a dead keyboard.
    await Promise.race([
      new Promise<void>((resolve) => synth.getFullState(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, ACK_TIMEOUT_MS)),
    ]);
    return true;
  }, [synth]);

  // Every rack mutation (including global settings) flows through the synth's
  // mirrored state, so the synth object identity is the change signal.
  useEffect(() => {
    if (!started) return;
    const t = window.setTimeout(() => {
      synth.getFullState((rack) => {
        void saveSession({ schema: SESSION_SCHEMA, savedAt: Date.now(), rack });
      });
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [started, synth]);

  return { restore };
}
