// Small reusable VST-style controls: rotary knob, cycle button, LED toggle.

import { useCallback, useRef } from 'react';
import { helpProps } from '../state/help';

interface KnobProps {
  label: string;
  value: number;
  max: number;
  min?: number;
  onChange: (value: number) => void;
  /** Optional display override (e.g. detune "-7..+7", transpose "C3"). */
  format?: (value: number) => string;
  size?: number;
  accent?: string;
  /** `stacked` (default): label above dial, value below. `inline`: value beside dial. */
  layout?: 'stacked' | 'inline';
  /** Description shown in the help bar while hovered. */
  help?: string;
  /** Help-bar title when the visible label is empty (matrix cells). */
  helpLabel?: string;
  /** Neutral value on the arc; fill grows from here to the current value. */
  center?: number;
  className?: string;
}

const ARC = 270; // degrees of travel, gap at the bottom

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function Knob({ label, value, max, min = 0, onChange, format, size = 34, accent, layout = 'stacked', help, helpLabel, center, className }: KnobProps) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startValue: number; scale: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      root.current?.focus();
      e.currentTarget.setPointerCapture(e.pointerId);
      const scale =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stage-scale')) || 1;
      drag.current = { startY: e.clientY, startValue: value, scale };
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const range = max - min;
      const fine = e.shiftKey ? 0.15 : 1;
      const dv = ((drag.current.startY - e.clientY) / (130 * drag.current.scale)) * range * fine;
      const next = Math.round(Math.min(max, Math.max(min, drag.current.startValue + dv)));
      if (next !== value) onChange(next);
    },
    [value, min, max, onChange],
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const next = Math.min(max, Math.max(min, value + (e.deltaY < 0 ? 1 : -1)));
      if (next !== value) onChange(next);
    },
    [value, min, max, onChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const range = max - min;
      const pageStep = Math.max(1, Math.round(range / 10));
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
        case 'PageUp':
          next = value + pageStep;
          break;
        case 'PageDown':
          next = value - pageStep;
          break;
        case 'Home':
          next = min;
          break;
        case 'End':
          next = max;
          break;
        default:
          return;
      }

      e.preventDefault();
      const clamped = Math.min(max, Math.max(min, next));
      if (clamped !== value) onChange(clamped);
    },
    [value, min, max, onChange],
  );

  const c = size / 2;
  const r = c - 3;
  const start = -ARC / 2;
  const span = max - min || 1;
  const valueFrac = (value - min) / span;
  const angle = start + valueFrac * ARC;
  const [px, py] = polar(c, c, r - 3, angle);

  let fillFrom = start;
  let fillTo = angle;
  let showFill = valueFrac > 0.004;
  let centerAngle: number | null = null;
  if (center !== undefined) {
    centerAngle = start + ((center - min) / span) * ARC;
    if (Math.abs(value - center) / span > 0.004) {
      fillFrom = Math.min(centerAngle, angle);
      fillTo = Math.max(centerAngle, angle);
      showFill = true;
    } else {
      showFill = false;
    }
  }

  const display = format ? format(value) : String(value);

  return (
    <div
      ref={root}
      className={`knob${layout === 'inline' ? ' knob-inline' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: layout === 'inline' ? undefined : size + 8 }}
      tabIndex={0}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={display}
      aria-label={helpLabel || label || undefined}
      onKeyDown={onKeyDown}
      {...(help ? helpProps(helpLabel || label || 'Value', help) : undefined)}
    >
      {layout === 'stacked' && label ? <div className="ctl-label">{label}</div> : null}
      <svg
        width={size}
        height={size}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        aria-hidden
      >
        <circle cx={c} cy={c} r={r} className="knob-body" />
        <path d={arcPath(c, c, r, start, start + ARC)} className="knob-track" />
        {centerAngle !== null && (() => {
          const [tx1, ty1] = polar(c, c, r - 2.5, centerAngle);
          const [tx2, ty2] = polar(c, c, r + 2.5, centerAngle);
          return <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} className="knob-center-tick" />;
        })()}
        {showFill && (
          <path d={arcPath(c, c, r, fillFrom, fillTo)} className="knob-fill" style={accent ? { stroke: accent } : undefined} />
        )}
        <line x1={c} y1={c} x2={px} y2={py} className="knob-pointer" />
      </svg>
      <div className="knob-value" style={accent ? { color: accent } : undefined}>
        {display}
      </div>
      {layout === 'inline' && label ? <div className="ctl-label">{label}</div> : null}
    </div>
  );
}

interface PartSliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
  /** Fill grows from center (for pan); default fills from the left (volume). */
  center?: boolean;
  label?: string;
}

/** Compact rack fader styled to match knobs. */
export function PartSlider({ value, min, max, onChange, onClick, center = false, label }: PartSliderProps) {
  const span = max - min || 1;
  const pct = ((value - min) / span) * 100;
  const fillStyle = center
    ? { left: `${Math.min(pct, 50)}%`, width: `${Math.abs(pct - 50)}%` }
    : { left: '0%', width: `${pct}%` };

  return (
    <div className={`part-slider${center ? ' part-slider--center' : ''}`}>
      <div className="part-slider-track" aria-hidden />
      {center ? <div className="part-slider-center" aria-hidden /> : null}
      <div className="part-slider-fill" aria-hidden style={fillStyle} />
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onClick={onClick}
      />
    </div>
  );
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MIDI_MAX = 127;

function noteLabel(n: number): string {
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

interface CycleProps {
  label: string;
  value: number;
  options: string[];
  onChange: (value: number) => void;
  /** Description shown in the help bar while hovered. */
  help?: string;
}

/** Compact enumerated selector: click cycles forward, wheel steps both ways. */
export function Cycle({ label, value, options, onChange, help }: CycleProps) {
  return (
    <div className="cycle" {...(help ? helpProps(label, help) : undefined)}>
      <div className="ctl-label">{label}</div>
      <button
        type="button"
        onClick={() => onChange((value + 1) % options.length)}
        onWheel={(e) => onChange((value + (e.deltaY < 0 ? 1 : options.length - 1)) % options.length)}
      >
        {options[value] ?? '?'}
      </button>
    </div>
  );
}

interface ToggleProps {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  /** Description shown in the help bar while hovered. */
  help?: string;
}

export function Toggle({ label, on, onChange, help }: ToggleProps) {
  return (
    <div className="cycle" {...(help ? helpProps(label, help) : undefined)}>
      <button type="button" className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <span className="led" />
        {label}
      </button>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label?: string;
  value: T;
  options: { value: T; label: string; help?: string }[];
  onChange: (value: T) => void;
}

/** Two-or-more-segment button group (mutually exclusive), tab-strip styled. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented">
      {label && <span className="segmented-label">{label}</span>}
      <div className="segmented-group">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`seg${value === o.value ? ' on' : ''}`}
            onClick={() => onChange(o.value)}
            {...(o.help ? helpProps(o.label, o.help) : undefined)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
