import { useCallback, useRef } from 'react';
import { noteName } from '@texed/dx7-format/voice';

const MIDI_MAX = 127;

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

  const onThumbPointerDown = useCallback(
    (bound: 'low' | 'high', e: React.PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      drag.current = bound;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.focus();
    },
    [],
  );

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
    // The two handlers only stop the containing part row from selecting while
    // the range is being dragged. The real controls are the labelled slider
    // buttons inside, so this group needs no keyboard handling of its own.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
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
        {(['low', 'high'] as const).map((bound) => {
          const value = bound === 'low' ? low : high;
          return (
            <button
              key={bound}
              type="button"
              className="note-range-thumb"
              style={{ left: `${notePct(value)}%` }}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={MIDI_MAX}
              aria-valuenow={value}
              aria-valuetext={noteName(value)}
              aria-label={bound === 'low' ? 'Low note' : 'High note'}
              onPointerDown={(e) => onThumbPointerDown(bound, e)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onKeyDown={(e) => onThumbKeyDown(bound, e)}
            />
          );
        })}
      </div>
    </div>
  );
}
