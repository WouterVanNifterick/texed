// App-level UI hooks: transient status message, localStorage-backed view
// preferences, keyboard shortcuts (QWERTY notes, part/operator select, undo,
// clipboard, Escape), window-wide file drag-and-drop, and the fixed-stage
// scale factor.

import { useCallback, useEffect, useRef, useState } from 'react';

/** A message that clears itself after `ms`. Re-showing resets the timer. */
export function useTransientMessage(ms = 6000): [string | null, (text: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback(
    (text: string) => {
      clearTimeout(timer.current);
      setMsg(text);
      timer.current = setTimeout(() => setMsg(null), ms);
    },
    [ms],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return [msg, show];
}

/** useState backed by localStorage, so view preferences survive reloads. */
export function usePersistentState<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        // storage unavailable (private mode) - in-memory only
      }
    },
    [key],
  );
  return [value, set];
}

/** Numeric variant of usePersistentState (stored as a string under the hood). */
export function usePersistentNumber(key: string, initial: number): [number, (v: number) => void] {
  const [str, setStr] = usePersistentState(key, String(initial));
  const num = Number(str);
  const set = useCallback((v: number) => setStr(String(v)), [setStr]);
  return [Number.isFinite(num) ? num : initial, set];
}

/** Boolean variant of usePersistentState (stored as 'on'/'off' under the hood). */
export function usePersistentFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [str, setStr] = usePersistentState<'on' | 'off'>(key, initial ? 'on' : 'off');
  const set = useCallback((v: boolean) => setStr(v ? 'on' : 'off'), [setStr]);
  return [str === 'on', set];
}

const QWERTY_MAP: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ';': 16,
};

const OCTAVE_BASE = 60;

/** Shift limits that keep every mapped key (base .. base+16) inside MIDI 0-127. */
const MIN_OCTAVE_SHIFT = -5;
const MAX_OCTAVE_SHIFT = 4;

/** Note name for the lowest QWERTY key, used in the octave-shift readout. */
function noteLabel(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Window keydown while `enabled`, skipping editable targets. */
function useWindowKeydown(
  enabled: boolean,
  handler: (e: KeyboardEvent) => void,
  deps: unknown[],
): void {
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      handler(e);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
    // Caller passes the handler's reactive deps explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}

/** Close a modal/overlay when Escape is pressed (even while typing in a field). */
export function useEscapeClose(onClose: () => void): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [onClose]);
}

/**
 * Plays notes from the QWERTY row (A–K etc.) while `enabled`; `[` and `]`
 * transpose the whole mapping down and up an octave.
 */
export function useQwertyKeyboard(
  enabled: boolean,
  noteOn: (note: number, velocity: number) => void,
  noteOff: (note: number) => void,
  onOctaveChange?: (label: string) => void,
): void {
  // Key -> the note it actually started, so a note held across an octave shift
  // still releases the note that is sounding rather than a stuck one.
  const heldKeys = useRef<Map<string, number>>(new Map());
  const octave = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === '[' || e.key === ']') {
        const next = octave.current + (e.key === '[' ? -1 : 1);
        if (next < MIN_OCTAVE_SHIFT || next > MAX_OCTAVE_SHIFT) return;
        octave.current = next;
        onOctaveChange?.(noteLabel(OCTAVE_BASE + next * 12));
        return;
      }
      const key = e.key.toLowerCase();
      const semi = QWERTY_MAP[key];
      if (semi === undefined || heldKeys.current.has(key)) return;
      const note = OCTAVE_BASE + semi + octave.current * 12;
      heldKeys.current.set(key, note);
      noteOn(note, 100);
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const note = heldKeys.current.get(key);
      if (note === undefined) return;
      heldKeys.current.delete(key);
      noteOff(note);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [enabled, noteOn, noteOff, onOctaveChange]);
}

/** F1–F8 select multi-timbral parts 1–8; digits 1–6 select the edited operator. */
export function useSelectKeys(
  enabled: boolean,
  selectPart: (index: number) => void,
  selectOp: (op: number) => void,
): void {
  useWindowKeydown(
    enabled,
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const part = /^F([1-8])$/.exec(e.key);
      if (part) {
        e.preventDefault();
        selectPart(Number(part[1]) - 1);
        return;
      }
      if (!/^[1-6]$/.test(e.key)) return;
      e.preventDefault();
      selectOp(Number(e.key));
    },
    [selectPart, selectOp],
  );
}

/** Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo. */
export function useUndoKeys(enabled: boolean, undo: () => void, redo: () => void): void {
  useWindowKeydown(
    enabled,
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
    },
    [undo, redo],
  );
}

/**
 * Ctrl/Cmd+C copies the selected operator, Ctrl/Cmd+V pastes it back onto the
 * selection; holding Shift pastes only the envelope.
 *
 * Copy is left alone when there is a real text selection, so selecting a patch
 * name and pressing Ctrl+C still copies the text. Ctrl+Shift+C is not claimed
 * either - preventDefault would not stop the browser opening its inspector.
 */
export function useClipboardKeys(
  enabled: boolean,
  copy: () => void,
  paste: (envOnly: boolean) => void,
): void {
  useWindowKeydown(
    enabled,
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'v') {
        e.preventDefault();
        paste(e.shiftKey);
        return;
      }
      if (key !== 'c' || e.shiftKey) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      e.preventDefault();
      copy();
    },
    [copy, paste],
  );
}

function patchFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter((f) => /\.(syx|mx|dx7voice|ini)$/i.test(f.name));
}

function isFileDrag(dt: DataTransfer | null): boolean {
  return (
    !!dt && (dt.types.includes('Files') || Array.from(dt.items).some((i) => i.kind === 'file'))
  );
}

function patchFilesFromDrop(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const fromList = patchFiles(dt.files);
  if (fromList.length) return fromList;
  const fromItems: File[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  return patchFiles(fromItems);
}

/**
 * Window-wide drag-and-drop for patch files. Calls `onDrop` with the matching
 * files (empty if the drop contained none). Returns whether a drag is active.
 */
export function useFileDrop(onDrop: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      depth.current += 1;
      if (depth.current === 1) setDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };

    const onDragLeave = () => {
      depth.current -= 1;
      if (depth.current <= 0) {
        depth.current = 0;
        setDragging(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      onDrop(patchFilesFromDrop(e.dataTransfer));
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [onDrop]);

  return dragging;
}

/**
 * Scales the fixed-size stage to fit the window, like a resizable plugin UI.
 *
 * Shrinking without a floor makes the controls unusable (a phone lands near
 * 0.27, which is a 10px knob), so the scale stops at `minScale` and the stage
 * scrolls instead. Returns whether that floor is in effect, so the caller can
 * say why the layout no longer fits.
 */
export function useStageScale(stageWidth: number, stageHeight: number, minScale = 0): boolean {
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const update = () => {
      const fit = Math.min(window.innerWidth / stageWidth, window.innerHeight / stageHeight);
      const scale = Math.max(fit, minScale);
      const floored = scale > fit;
      document.documentElement.style.setProperty('--stage-scale', String(scale));
      // Drives the scrollable layout in App.css.
      document.documentElement.classList.toggle('stage-clamped', floored);
      setClamped(floored);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [stageWidth, stageHeight, minScale]);

  return clamped;
}
