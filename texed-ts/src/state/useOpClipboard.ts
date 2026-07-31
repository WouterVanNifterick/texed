// The operator clipboard wired to the synth, plus the drag-and-drop handlers
// the panels hang off.
//
// Pastes go through setParam one changed byte at a time rather than loading a
// whole voice: setParam is the path that also reaches a real DX7 over MIDI
// (live mode and the ?hw editor), and undo folds the burst into a single step
// anyway, since useHistory coalesces for 350 ms.

import { useEffect, useMemo, useRef, useState, type DragEvent, type DragEventHandler } from 'react';
import type { Synth } from '../audio/synth-types';
import type { EnvSelection } from '../envelope/env-draw';
import {
  doneLabel,
  effectiveMode,
  getOpClip,
  getOpDrag,
  hasEdits,
  planPaste,
  planSwap,
  readClip,
  resolveDrop,
  selName,
  setOpClip,
  setOpDrag,
  useOpDrag,
  type ActionKind,
  type DropAction,
  type OpClip,
  type PasteMode,
} from './op-clipboard';

export interface OpClipboard {
  /** Copy the operator (or the pitch EG) at `sel`. */
  copy: (sel: EnvSelection) => void;
  /** Paste the clipboard onto `sel`. */
  paste: (sel: EnvSelection, mode: PasteMode) => void;
  /** Carry out a drop, using the clip the drag was carrying. */
  drop: (clip: OpClip, action: DropAction) => void;
  /** Spread onto the element that should start a drag of `sel`. */
  dragProps: (sel: EnvSelection) => {
    draggable: true;
    onDragStart: DragEventHandler;
    onDragEnd: DragEventHandler;
  };
}

export function useOpClipboard(synth: Synth, showMsg: (text: string) => void): OpClipboard {
  const { voice, supplement, setParam, setSupplementParam } = synth;
  // The panels this is handed to are memoized, so the object has to keep its
  // identity; the live buffers reach the callbacks through a ref instead.
  const buffers = useRef({ voice, supplement });
  buffers.current = { voice, supplement };

  return useMemo(() => {
    const run = (clip: OpClip, target: EnvSelection, requested: ActionKind) => {
      // A pitch EG at either end has only an envelope to give or to receive.
      const kind: ActionKind =
        requested === 'swap' ? 'swap' : effectiveMode(clip, target, requested);
      const { voice: v, supplement: s } = buffers.current;
      const edits =
        kind === 'swap'
          ? planSwap(v, s, clip.source as number, target as number)
          : planPaste(v, s, clip, target, kind);
      if (!hasEdits(edits)) {
        showMsg(`${selName(target)} already matches ${selName(clip.source)}`);
        return;
      }
      for (const e of edits.voice) setParam(e.offset, e.value);
      for (const e of edits.supplement) setSupplementParam(e.offset, e.value);
      showMsg(doneLabel(clip, target, kind));
    };

    return {
      copy: (sel) => {
        const { voice: v, supplement: s } = buffers.current;
        setOpClip(readClip(v, s, sel));
        showMsg(`Copied ${selName(sel)}`);
      },

      paste: (sel, mode) => {
        const clip = getOpClip();
        if (!clip) {
          showMsg('Nothing copied yet (Ctrl+C)');
          return;
        }
        run(clip, sel, mode);
      },

      drop: (clip, action) => run(clip, action.target, action.kind),

      dragProps: (sel) => ({
        draggable: true,
        onDragStart: (e) => {
          // The power button sitting in the header is a click target, not a grab
          // handle - a 4px wobble while toggling an operator should not become a
          // drag that swallows the click.
          if ((e.target as Element | null)?.closest('.op-power')) {
            e.preventDefault();
            return;
          }
          const { voice: v, supplement: s } = buffers.current;
          setOpDrag(readClip(v, s, sel));
          e.dataTransfer.effectAllowed = 'copyMove';
          // Firefox refuses to start a drag with an empty data transfer. The
          // real payload is the module-level drag slot, not this.
          e.dataTransfer.setData('text/plain', selName(sel));
        },
        onDragEnd: () => setOpDrag(null),
      }),
    };
  }, [setParam, setSupplementParam, showMsg]);
}

export interface DropTarget {
  /** A drag is in flight and this target could receive it. */
  armed: boolean;
  /** What dropping right here would do, while the drag is over it. */
  hint: DropAction | null;
  dropProps: {
    onDragOver: DragEventHandler;
    onDragLeave: DragEventHandler;
    onDrop: DragEventHandler;
  };
}

/**
 * Makes one element a drop target for operator drags.
 *
 * `envOnly` forces the envelope reading where there is nothing else to receive
 * (the pitch EG panel, the combined view's legend chips). Everywhere else the
 * cursor picks: over the target's envelope graph copies the EG, anywhere else
 * on the panel copies the whole operator.
 */
export function useOpDropTarget(
  target: EnvSelection,
  clipboard: OpClipboard,
  envOnly = false,
): DropTarget {
  const drag = useOpDrag();
  const [hint, setHint] = useState<DropAction | null>(null);

  // A drag released over something else never delivers a leave here, so the
  // hint is retired from the drag ending rather than from an event.
  useEffect(() => {
    if (!drag) setHint(null);
  }, [drag]);

  const actionFor = (e: DragEvent): DropAction | null => {
    const overEnv = envOnly || !!(e.target as Element | null)?.closest('.env-editor');
    return resolveDrop(getOpDrag(), target, overEnv, e.altKey);
  };

  return {
    armed: !!drag && drag.source !== target,
    hint: drag ? hint : null,
    dropProps: {
      onDragOver: (e) => {
        const next = actionFor(e);
        // Without preventDefault the browser shows its own "no drop" cursor,
        // which is exactly right for a file drag or a drop onto the source.
        if (!next) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = next.kind === 'swap' ? 'move' : 'copy';
        // dragover repeats for as long as the pointer is here; only re-render
        // when the verdict actually changes.
        setHint((prev) => (prev && prev.label === next.label ? prev : next));
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHint(null);
      },
      onDrop: (e) => {
        const action = actionFor(e);
        const clip = getOpDrag();
        setHint(null);
        if (!action || !clip) return;
        e.preventDefault();
        clipboard.drop(clip, action);
      },
    },
  };
}
