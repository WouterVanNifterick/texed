// Keyboard level scaling editor, laid out like the DX7 manual diagram:
// X = MIDI note, Y = level offset, curve computed with the engine's own
// scaleLevel() so what you see is what the synth applies.
//
// Gestures: drag the break point strip horizontally to move it; drag either
// side vertically to set that side's scaling as a signed depth (up = more
// level = +LIN/+EXP, down = less level = -LIN/-EXP, horizontal = off);
// click a corner label to toggle LIN/EXP for that side.

import { useCallback, useRef } from 'react';
import { scaleLevel } from '@texed/dx7-engine/dx7note';
import { CURVES } from '@texed/dx7-format/params';

const W = 127;
const H = 56;
// The engine clamps the scaled level to 0..127 (dx7note.ts), so ±127 is the
// largest offset that can ever take effect; raw curves beyond that peg.
const MAX_SCALE = 128;
const BP_HIT = 8; // half-width of the break point grab strip, viewBox units

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** DX7-style break point label: 0 = A-1 ... 99 = C8. */
function bpLabel(bp: number): string {
  const n = bp + 9;
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

export type ScalingField = 'breakPoint' | 'leftDepth' | 'rightDepth' | 'leftCurve' | 'rightCurve';

interface ScalingGraphProps {
  breakPoint: number;
  leftDepth: number;
  rightDepth: number;
  leftCurve: number;
  rightCurve: number;
  onChange: (field: ScalingField, value: number) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Curve indices: 0 = -LIN, 1 = -EXP, 2 = +EXP, 3 = +LIN.
const isPositive = (curve: number) => curve >= 2;
const isExp = (curve: number) => curve === 1 || curve === 2;
const signedDepth = (depth: number, curve: number) => (isPositive(curve) ? depth : -depth);
const curveFor = (sign: boolean, exp: boolean) => (sign ? (exp ? 2 : 3) : exp ? 1 : 0);

interface DragState {
  mode: 'bp' | 'depth';
  side: 'left' | 'right';
  startY: number;
  startVal: number; // signed depth for 'depth' mode
  rect: DOMRect;
}

export function ScalingGraph({
  breakPoint,
  leftDepth,
  rightDepth,
  leftCurve,
  rightCurve,
  onChange,
}: ScalingGraphProps) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const bpNote = breakPoint + 17; // engine knee position (dx7note.ts scaleLevel)

  const setSigned = useCallback(
    (side: 'left' | 'right', signed: number) => {
      const curve = side === 'left' ? leftCurve : rightCurve;
      const next = curveFor(signed >= 0, isExp(curve));
      onChange(side === 'left' ? 'leftDepth' : 'rightDepth', Math.abs(signed));
      if (next !== curve && signed !== 0) {
        onChange(side === 'left' ? 'leftCurve' : 'rightCurve', next);
      }
    },
    [leftCurve, rightCurve, onChange],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!root.current) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // synthetic/stale pointer ids - dragging still works while inside
      }
      const rect = root.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * W;
      if (Math.abs(x - bpNote) < BP_HIT) {
        drag.current = { mode: 'bp', side: 'left', startY: e.clientY, startVal: 0, rect };
        return;
      }
      const side = x < bpNote ? 'left' : 'right';
      drag.current = {
        mode: 'depth',
        side,
        startY: e.clientY,
        startVal:
          side === 'left' ? signedDepth(leftDepth, leftCurve) : signedDepth(rightDepth, rightCurve),
        rect,
      };
    },
    [bpNote, leftDepth, rightDepth, leftCurve, rightCurve],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (d.mode === 'bp') {
        const note = ((e.clientX - d.rect.left) / d.rect.width) * W;
        onChange('breakPoint', clamp(Math.round(note - 17), 0, 99));
        return;
      }
      const fine = e.shiftKey ? 0.2 : 1;
      const dv = ((d.startY - e.clientY) / d.rect.height) * 200 * fine;
      setSigned(d.side, clamp(Math.round(d.startVal + dv), -99, 99));
    },
    [onChange, setSigned],
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!root.current) return;
      const rect = root.current.getBoundingClientRect();
      const step = e.deltaY < 0 ? 1 : -1;
      if (e.shiftKey) {
        onChange('breakPoint', clamp(breakPoint + step, 0, 99));
      } else if (((e.clientX - rect.left) / rect.width) * W < bpNote) {
        setSigned('left', clamp(signedDepth(leftDepth, leftCurve) + step, -99, 99));
      } else {
        setSigned('right', clamp(signedDepth(rightDepth, rightCurve) + step, -99, 99));
      }
    },
    [bpNote, breakPoint, leftDepth, rightDepth, leftCurve, rightCurve, onChange, setSigned],
  );

  // Sample every note: the engine steps the scaling in 3-semitone groups, so
  // coarser sampling would alias the staircase.
  const y = (scale: number) => clamp(H / 2 - (scale / MAX_SCALE) * (H / 2 - 4), 3, H - 3);
  const points: string[] = [];
  for (let n = 0; n <= W; n += 1) {
    points.push(
      `${n},${y(scaleLevel(n, breakPoint, leftDepth, rightDepth, leftCurve, rightCurve)).toFixed(1)}`,
    );
  }

  const toggleExp = (side: 'left' | 'right') => {
    const cur = side === 'left' ? leftCurve : rightCurve;
    onChange(side === 'left' ? 'leftCurve' : 'rightCurve', curveFor(isPositive(cur), !isExp(cur)));
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
            <stop offset="0%" stopColor="#ffb454" stopOpacity={0.45} />
            <stop offset="50%" stopColor="#ffb454" stopOpacity={0.04} />
            <stop offset="100%" stopColor="#ffb454" stopOpacity={0.45} />
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
        <rect x={bpNote - BP_HIT} y={0} width={BP_HIT * 2} height={H} className="scale-bp-hit" />
        <line x1={bpNote} y1={0} x2={bpNote} y2={H} className="scale-bp-line" />
        <circle cx={bpNote} cy={H / 2} r={2.4} className="scale-bp-dot" />
      </svg>
      <span className="scale-bp-label" style={{ left: `${(bpNote / W) * 100}%` }}>
        {bpLabel(breakPoint)}
      </span>
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
