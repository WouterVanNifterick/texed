// App-level UI hooks: transient status message, QWERTY note input,
// part-select digit keys, window-wide file drag-and-drop, and the
// fixed-stage scale factor.

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
        // storage unavailable (private mode) — in-memory only
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

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Plays notes from the QWERTY row (A–K etc.) while `enabled`. */
export function useQwertyKeyboard(
  enabled: boolean,
  noteOn: (note: number, velocity: number) => void,
  noteOff: (note: number) => void,
): void {
  const heldKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      const semi = QWERTY_MAP[e.key.toLowerCase()];
      if (semi === undefined || heldKeys.current.has(e.key)) return;
      heldKeys.current.add(e.key);
      noteOn(OCTAVE_BASE + semi, 100);
    };
    const up = (e: KeyboardEvent) => {
      const semi = QWERTY_MAP[e.key.toLowerCase()];
      if (semi === undefined) return;
      heldKeys.current.delete(e.key);
      noteOff(OCTAVE_BASE + semi);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [enabled, noteOn, noteOff]);
}

/** Selects multi-timbral parts 1–8 with the digit keys. */
export function usePartSelectKeys(enabled: boolean, selectPart: (index: number) => void): void {
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      const n = Number(e.key);
      if (n < 1 || n > 8) return;
      e.preventDefault();
      selectPart(n - 1);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [enabled, selectPart]);
}

export function patchFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter((f) => /\.(syx|dx7voice)$/i.test(f.name));
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

/** Scales the fixed-size stage to fit the window, like a resizable plugin UI. */
export function useStageScale(stageWidth: number, stageHeight: number): void {
  useEffect(() => {
    const update = () =>
      document.documentElement.style.setProperty(
        '--stage-scale',
        String(Math.min(window.innerWidth / stageWidth, window.innerHeight / stageHeight)),
      );
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [stageWidth, stageHeight]);
}
