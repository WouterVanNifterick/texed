// Small reusable VST-style controls: rotary knob, cycle button, LED toggle,
// plus the useStatus hook that feeds realtime visualizations.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SynthStatus } from '../audio/useDexedSynth';

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

export function Knob({ label, value, max, min = 0, onChange, format, size = 34, accent }: KnobProps) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startY: e.clientY, startValue: value };
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const range = max - min;
      const fine = e.shiftKey ? 0.15 : 1;
      const dv = ((drag.current.startY - e.clientY) / 130) * range * fine;
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

  const c = size / 2;
  const r = c - 3;
  const start = -ARC / 2;
  const frac = (value - min) / (max - min || 1);
  const angle = start + frac * ARC;
  const [px, py] = polar(c, c, r - 3, angle);

  return (
    <div className="knob" style={{ width: size + 8 }}>
      <svg
        width={size}
        height={size}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <circle cx={c} cy={c} r={r} className="knob-body" />
        <path d={arcPath(c, c, r, start, start + ARC)} className="knob-track" />
        {frac > 0.004 && (
          <path d={arcPath(c, c, r, start, angle)} className="knob-fill" style={accent ? { stroke: accent } : undefined} />
        )}
        <line x1={c} y1={c} x2={px} y2={py} className="knob-pointer" />
      </svg>
      <div className="knob-value">{format ? format(value) : value}</div>
      <div className="ctl-label">{label}</div>
    </div>
  );
}

interface CycleProps {
  label: string;
  value: number;
  options: string[];
  onChange: (value: number) => void;
}

/** Compact enumerated selector: click cycles forward, wheel steps both ways. */
export function Cycle({ label, value, options, onChange }: CycleProps) {
  return (
    <div className="cycle">
      <button
        type="button"
        onClick={() => onChange((value + 1) % options.length)}
        onWheel={(e) => onChange((value + (e.deltaY < 0 ? 1 : options.length - 1)) % options.length)}
      >
        {options[value] ?? '?'}
      </button>
      <div className="ctl-label">{label}</div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}

export function Toggle({ label, on, onChange }: ToggleProps) {
  return (
    <div className="cycle">
      <button type="button" className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <span className="led" />
        {label}
      </button>
    </div>
  );
}

/**
 * Subscribe to the synth status stream and re-render only when the selected
 * slice changes. Keeps 30 Hz updates confined to small meter components.
 */
export function useStatus<T>(
  subscribe: (cb: (s: SynthStatus) => void) => () => void,
  selector: (s: SynthStatus) => T,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  const sel = useRef(selector);
  sel.current = selector;
  useEffect(() => subscribe((s) => setValue(sel.current(s))), [subscribe]);
  return value;
}
