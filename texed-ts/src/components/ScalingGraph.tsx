// Keyboard level scaling editor, laid out like the DX7 manual diagram:
// X = MIDI note, Y = level offset, curve computed with the engine's own
// scaleLevel() so what you see is what the synth applies.
//
// Gestures: drag the break point strip horizontally to move it; drag either
// side vertically to set that side's scaling as a signed depth (up = more
// level = +LIN/+EXP, down = less level = -LIN/-EXP, horizontal = off);
// click a corner label to toggle LIN/EXP for that side.

import { useRef } from 'react';
import { scaleLevel } from '@texed/dx7-engine/dx7note';
import { CURVES, noteName } from '@texed/dx7-format/voice';

const W = 127;
const H = 56;
// The engine clamps the scaled level to 0..127 (dx7note.ts), so ±127 is the
// largest offset that can ever take effect; raw curves beyond that peg.
const MAX_SCALE = 128;
const BP_HIT = 8; // half-width of the break point grab strip, viewBox units
// Break point 0..99 to the MIDI note of the engine's knee (dx7note.ts scaleLevel).
const KNEE_OFFSET = 17;

/** DX7-style break point label: 0 = A-1 ... 99 = C8. */
function bpLabel(bp: number): string {
  return noteName(bp + 9);
}

type ScalingField = 'breakPoint' | 'leftDepth' | 'rightDepth' | 'leftCurve' | 'rightCurve';

interface ScalingGraphProps {
  breakPoint: number;
  leftDepth: number;
  rightDepth: number;
  leftCurve: number;
  rightCurve: number;
  onChange: (field: ScalingField, value: number) => void;
  /** Operator color for the curve fill (stroke follows --op via CSS). */
  color?: string;
  /** Paint note, marked on the curve - X is MIDI note here, so it lands exactly. */
  note: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Curve indices: 0 = -LIN, 1 = -EXP, 2 = +EXP, 3 = +LIN.
const isPositive = (curve: number) => curve >= 2;
const isExp = (curve: number) => curve === 1 || curve === 2;
const signedDepth = (depth: number, curve: number) => (isPositive(curve) ? depth : -depth);
const curveFor = (sign: boolean, exp: boolean) => (sign ? (exp ? 2 : 3) : exp ? 1 : 0);

/** Graph X (MIDI note) under a pointer. */
const noteAtX = (rect: DOMRect, clientX: number) => ((clientX - rect.left) / rect.width) * W;

type Side = 'left' | 'right';

type DragState =
  | { mode: 'bp'; rect: DOMRect }
  | { mode: 'depth'; side: Side; startY: number; startDepth: number; rect: DOMRect };

export function ScalingGraph({
  breakPoint,
  leftDepth,
  rightDepth,
  leftCurve,
  rightCurve,
  onChange,
  color = '#ffb454',
  note,
}: ScalingGraphProps) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const bpNote = breakPoint + KNEE_OFFSET;
  const curves = { left: leftCurve, right: rightCurve };
  const signed = {
    left: signedDepth(leftDepth, leftCurve),
    right: signedDepth(rightDepth, rightCurve),
  };

  const setSigned = (side: Side, value: number) => {
    const next = curveFor(value >= 0, isExp(curves[side]));
    onChange(`${side}Depth`, Math.abs(value));
    if (next !== curves[side] && value !== 0) onChange(`${side}Curve`, next);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!root.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic/stale pointer ids - dragging still works while inside
    }
    const rect = root.current.getBoundingClientRect();
    const x = noteAtX(rect, e.clientX);
    if (Math.abs(x - bpNote) < BP_HIT) {
      drag.current = { mode: 'bp', rect };
      return;
    }
    const side = x < bpNote ? 'left' : 'right';
    drag.current = { mode: 'depth', side, startY: e.clientY, startDepth: signed[side], rect };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'bp') {
      const knee = noteAtX(d.rect, e.clientX);
      onChange('breakPoint', clamp(Math.round(knee - KNEE_OFFSET), 0, 99));
      return;
    }
    const fine = e.shiftKey ? 0.2 : 1;
    const dv = ((d.startY - e.clientY) / d.rect.height) * 200 * fine;
    setSigned(d.side, clamp(Math.round(d.startDepth + dv), -99, 99));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!root.current) return;
    const step = e.deltaY < 0 ? 1 : -1;
    if (e.shiftKey) {
      onChange('breakPoint', clamp(breakPoint + step, 0, 99));
      return;
    }
    const x = noteAtX(root.current.getBoundingClientRect(), e.clientX);
    const side = x < bpNote ? 'left' : 'right';
    setSigned(side, clamp(signed[side] + step, -99, 99));
  };

  // Sample every note: the engine steps the scaling in 3-semitone groups, so
  // coarser sampling would alias the staircase.
  const y = (scale: number) => clamp(H / 2 - (scale / MAX_SCALE) * (H / 2 - 4), 3, H - 3);
  const points: string[] = [];
  for (let n = 0; n <= W; n += 1) {
    points.push(
      `${n},${y(scaleLevel(n, breakPoint, leftDepth, rightDepth, leftCurve, rightCurve)).toFixed(1)}`,
    );
  }

  const markNote = clamp(note, 0, W);
  const markY = y(scaleLevel(markNote, breakPoint, leftDepth, rightDepth, leftCurve, rightCurve));

  const toggleExp = (side: Side) => {
    const curve = curves[side];
    onChange(`${side}Curve`, curveFor(isPositive(curve), !isExp(curve)));
  };

  return (
    <div
      ref={root}
      className="scale-graph"
      title={
        'Keyboard level scaling - drag break point ←→ · drag sides ↑↓ (up = more level, down = less) · click label: LIN/EXP'
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient
            id="scale-fill"
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={0}
            x2={0}
            y2={H}
          >
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="50%" stopColor={color} stopOpacity={0.04} />
            <stop offset="100%" stopColor={color} stopOpacity={0.45} />
          </linearGradient>
        </defs>
        {[12, 36, 60, 84, 108].map((n) => (
          <line key={n} x1={n} y1={0} x2={n} y2={H} className="scale-grid" />
        ))}
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} className="scale-baseline" />
        <polygon
          className="graph-fill"
          fill="url(#scale-fill)"
          points={`0,${H / 2} ${points.join(' ')} ${W},${H / 2}`}
        />
        <polyline className="scale-curve" points={points.join(' ')} />
        <line className="scale-note-line" x1={markNote} y1={0} x2={markNote} y2={H} />
        <rect x={bpNote - BP_HIT} y={0} width={BP_HIT * 2} height={H} className="scale-bp-hit" />
        <line x1={bpNote} y1={0} x2={bpNote} y2={H} className="scale-bp-line" />
        <circle cx={bpNote} cy={H / 2} r={2.4} className="scale-bp-dot" />
      </svg>
      <span className="scale-bp-label" style={{ left: `${(bpNote / W) * 100}%` }}>
        {bpLabel(breakPoint)}
      </span>
      {/* HTML, not an SVG circle: the graph scales without keeping its aspect
          ratio, which would flatten a circle into an ellipse. */}
      <span
        className="scale-note-dot"
        style={{ left: `${(markNote / W) * 100}%`, top: `${(markY / H) * 100}%` }}
        aria-hidden
      />
      <button
        type="button"
        className="scale-crv left"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => toggleExp('left')}
        title="Left curve - click to toggle LIN/EXP (drag the graph up/down for ±depth)"
      >
        {CURVES[leftCurve]} {leftDepth}
      </button>
      <button
        type="button"
        className="scale-crv right"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => toggleExp('right')}
        title="Right curve - click to toggle LIN/EXP (drag the graph up/down for ±depth)"
      >
        {rightDepth} {CURVES[rightCurve]}
      </button>
    </div>
  );
}
