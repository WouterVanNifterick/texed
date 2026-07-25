import { useCallback, useRef } from 'react';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MIDI_MAX = 127;

export function noteLabel(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

function notePct(n: number): number {
  return (n / MIDI_MAX) * 100;
}

function noteFromClientX(track: HTMLElement, clientX: number): number {
  const rect = track.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.round(frac * MIDI_MAX);
}

function rangeFills(low: number, high: number): { left: string; width: string }[] {
  if (low <= high) {
    return [{ left: `${notePct(low)}%`, width: `${notePct(high) - notePct(low)}%` }];
  }
  return [
    { left: '0%', width: `${notePct(high)}%` },
    { left: `${notePct(low)}%`, width: `${100 - notePct(low)}%` },
  ];
}

interface NoteRangeProps {
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  label?: string;
}

/** Dual-thumb MIDI note range (0–127), accent fill shows active range. */
export function NoteRange({ low, high, onChange, label }: NoteRangeProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<'low' | 'high' | null>(null);

  const setBound = useCallback(
    (bound: 'low' | 'high', value: number) => {
      const next = Math.min(MIDI_MAX, Math.max(0, value));
      if (bound === 'low') {
        if (next !== low) onChange(next, high);
      } else if (next !== high) {
        onChange(low, next);
      }
    },
    [low, high, onChange],
  );

  const onTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!trackRef.current || (e.target as HTMLElement).closest('.note-range-thumb')) return;
      e.stopPropagation();
      const note = noteFromClientX(trackRef.current, e.clientX);
      const bound = Math.abs(note - low) <= Math.abs(note - high) ? 'low' : 'high';
      drag.current = bound;
      e.currentTarget.setPointerCapture(e.pointerId);
      setBound(bound, note);
    },
    [low, high, setBound],
  );

  const onThumbPointerDown = useCallback((bound: 'low' | 'high', e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = bound;
    e.currentTarget.setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).focus();
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current || !trackRef.current) return;
      setBound(drag.current, noteFromClientX(trackRef.current, e.clientX));
    },
    [setBound],
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const onThumbKeyDown = useCallback(
    (bound: 'low' | 'high', e: React.KeyboardEvent) => {
      const value = bound === 'low' ? low : high;
      let next: number | null = null;

      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowRight':
          next = value + 1;
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          next = value - 1;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = MIDI_MAX;
          break;
        default:
          return;
      }

      e.preventDefault();
      e.stopPropagation();
      setBound(bound, next);
    },
    [low, high, setBound],
  );

  const fills = rangeFills(low, high);

  return (
    <div
      className="note-range"
      role="group"
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={trackRef}
        className="note-range-track"
        onPointerDown={onTrackPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {fills.map((style, i) => (
          <div key={i} className="note-range-fill" aria-hidden style={style} />
        ))}
        <button
          type="button"
          className="note-range-thumb"
          style={{ left: `${notePct(low)}%` }}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={MIDI_MAX}
          aria-valuenow={low}
          aria-valuetext={noteLabel(low)}
          aria-label="Low note"
          onPointerDown={(e) => onThumbPointerDown('low', e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(e) => onThumbKeyDown('low', e)}
        />
        <button
          type="button"
          className="note-range-thumb"
          style={{ left: `${notePct(high)}%` }}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={MIDI_MAX}
          aria-valuenow={high}
          aria-valuetext={noteLabel(high)}
          aria-label="High note"
          onPointerDown={(e) => onThumbPointerDown('high', e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(e) => onThumbKeyDown('high', e)}
        />
      </div>
    </div>
  );
}
