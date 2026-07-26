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

export function Knob({
  label,
  value,
  max,
  min = 0,
  onChange,
  format,
  size = 34,
  accent,
  layout = 'stacked',
  help,
  helpLabel,
  center,
  className,
}: KnobProps) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startValue: number; scale: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      root.current?.focus();
      e.currentTarget.setPointerCapture(e.pointerId);
      const scale =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stage-scale')) ||
        1;
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
        {centerAngle !== null &&
          (() => {
            const [tx1, ty1] = polar(c, c, r - 2.5, centerAngle);
            const [tx2, ty2] = polar(c, c, r + 2.5, centerAngle);
            return <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} className="knob-center-tick" />;
          })()}
        {showFill && (
          <path
            d={arcPath(c, c, r, fillFrom, fillTo)}
            className="knob-fill"
            style={accent ? { stroke: accent } : undefined}
          />
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
