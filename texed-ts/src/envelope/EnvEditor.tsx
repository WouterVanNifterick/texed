// Accurate, draggable envelope editor. Draws one envelope (an operator amp EG
// or the pitch EG) with realistic per-stage times and levels from env-sim, on
// the shared time scale. Nodes are draggable in 2D: horizontal sets the stage
// rate (inverted from the engine timing), vertical sets the stage level.

import { useId, useMemo, useRef } from 'react';
import { useStatus, type SynthStatus } from '../audio/useSynth';
import {
  simulateAmpEnv,
  simulatePitchEnv,
  rateForStageDuration,
  pitchRateForStageDuration,
  levelForTarget,
  pitchLevelForTarget,
  type AmpEnvParams,
  type EnvTrace,
} from '@texed/dx7-engine/env-sim';
import type { EnvTimeScale } from './env-time';
import {
  makeYMap,
  curveSegments,
  fillPoints,
  px,
  py,
  type YMode,
  type EnvKind,
  type DrawGeom,
} from './env-draw';

const W = 100;
const H = 100;
const PAD = 2;

const DEFAULT_COLOR: Record<EnvKind, string> = { amp: '#6ee7a0', pitch: '#7fc4ff' };

interface EnvEditorProps {
  kind: EnvKind;
  rates: number[];
  levels: number[];
  ampParams?: AmpEnvParams; // required when kind === 'amp'
  timeScale: EnvTimeScale;
  yMode: YMode;
  stage: number; // live active stage 0..4 (highlight)
  playLevel?: number; // live raw Q24 envelope level, for the playback dot
  onSetRate: (i: number, value: number) => void;
  onSetLevel: (i: number, value: number) => void;
  tall?: boolean;
  color?: string;
  className?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function EnvEditor(props: EnvEditorProps) {
  const {
    kind,
    rates,
    levels,
    ampParams,
    timeScale,
    yMode,
    stage,
    onSetRate,
    onSetLevel,
    tall,
    className,
  } = props;
  const color = props.color ?? DEFAULT_COLOR[kind];
  const gid = useId();
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ stage: number; levelOnly: boolean } | null>(null);

  // Deliberately not memoized. Callers rebuild ampParams/rates/levels on every
  // render, so a useMemo here could never hit - it only looked like caching. The
  // replay costs ~6us, which is far below the cost of pretending otherwise.
  const trace: EnvTrace =
    kind === 'amp'
      ? simulateAmpEnv(ampParams!, timeScale.gateSec)
      : simulatePitchEnv(rates, levels, timeScale.gateSec);

  const ymap = useMemo(() => makeYMap(kind, yMode), [kind, yMode]);
  const g: DrawGeom = { W, H, pad: PAD, ts: timeScale, ymap };

  const segs = curveSegments(trace, g);
  const fill = fillPoints(trace, g);

  // Active-stage highlight: the portion of the curve inside the playing stage.
  const [hlFrom, hlTo] = stageWindow(trace, stage);
  const activePts =
    stage >= 0 && stage <= 3
      ? trace.curve
          .filter((p) => p.timeSec >= hlFrom - 1e-6 && p.timeSec <= hlTo + 1e-6)
          .map((p) => `${px(g, p.timeSec).toFixed(2)},${py(g, p.levelQ24).toFixed(2)}`)
          .join(' ')
      : '';

  // Playback dot: sits on the curve at the live envelope level within the
  // active stage. Hidden when idle/finished (stage 4) or no live level.
  const playhead =
    stage >= 0 && stage <= 3 && props.playLevel != null
      ? playheadPoint(trace, stage, props.playLevel)
      : null;

  function prevNodeTime(s: number): number {
    if (s === 0) return 0;
    if (s === 3) return trace.gateSec;
    return trace.nodes[s - 1].timeSec;
  }

  function applyDrag(clientX: number, clientY: number) {
    const d = drag.current;
    if (!d || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    // Undo the viewBox padding to recover the plot-relative fraction.
    const x01 = clamp((fx * W - PAD) / (W - 2 * PAD), 0, 1);
    const y01 = clamp((fy * H - PAD) / (H - 2 * PAD), 0, 1);

    // The amp and pitch paths differ only in which inverse mapping applies.
    const ap = kind === 'amp' ? ampParams : undefined;
    const target = ymap.y01ToLevel(y01);
    const level = ap ? levelForTarget(target, ap.outlevel) : pitchLevelForTarget(target);

    if (!d.levelOnly) {
      const desiredSec = Math.max(0, timeScale.t(x01) - prevNodeTime(d.stage));
      const rate = ap
        ? rateForStageDuration(ap, d.stage, desiredSec, rates[d.stage])
        : pitchRateForStageDuration(levels, d.stage, desiredSec, rates[d.stage]);
      if (rate !== rates[d.stage]) onSetRate(d.stage, rate);
    }
    if (level !== levels[d.stage]) onSetLevel(d.stage, level);
  }

  const onNodeDown = (e: React.PointerEvent, s: number, levelOnly = false) => {
    (e.currentTarget as HTMLElement).focus();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointer ids
    }
    drag.current = { stage: s, levelOnly };
    e.stopPropagation();
  };

  const onNodeKey = (e: React.KeyboardEvent, s: number) => {
    let dr = 0;
    let dl = 0;
    switch (e.key) {
      case 'ArrowRight':
        dr = -1;
        break; // longer stage = lower rate
      case 'ArrowLeft':
        dr = 1;
        break;
      case 'ArrowUp':
        dl = 1;
        break;
      case 'ArrowDown':
        dl = -1;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (dr) onSetRate(s, clamp(rates[s] + dr, 0, 99));
    if (dl) onSetLevel(s, clamp(levels[s] + dl, 0, 99));
  };

  const nodeLabel = (s: number) =>
    s === 3 ? `Release: rate R4 / level L4` : `Stage ${s + 1}: rate R${s + 1} / level L${s + 1}`;

  return (
    <div
      ref={root}
      className={`env-editor${tall ? ' tall' : ''}${className ? ' ' + className : ''}`}
      style={{ ['--curve' as string]: color }}
      onPointerMove={(e) => drag.current && applyDrag(e.clientX, e.clientY)}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient
            id={`eg-fill-${gid}`}
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={0}
            x2={0}
            y2={H}
          >
            {kind === 'pitch' ? (
              <>
                <stop offset="0%" stopColor={color} stopOpacity={0.34} />
                <stop offset="50%" stopColor={color} stopOpacity={0.03} />
                <stop offset="100%" stopColor={color} stopOpacity={0.34} />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor={color} stopOpacity={0.38} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </>
            )}
          </linearGradient>
        </defs>
        {timeScale.gridlines.map((gl, i) => (
          <line
            key={i}
            x1={PAD + gl.x01 * (W - 2 * PAD)}
            y1={0}
            x2={PAD + gl.x01 * (W - 2 * PAD)}
            y2={H}
            className="env-grid"
          />
        ))}
        {kind === 'pitch' && <line x1={0} y1={H / 2} x2={W} y2={H / 2} className="env-midline" />}
        {/* key-off marker */}
        <line
          x1={PAD + timeScale.x(trace.gateSec) * (W - 2 * PAD)}
          y1={0}
          x2={PAD + timeScale.x(trace.gateSec) * (W - 2 * PAD)}
          y2={H}
          className="env-gate"
        />
        <polygon className="graph-fill" fill={`url(#eg-fill-${gid})`} points={fill} />
        {segs.map((s, i) => (
          <polyline
            key={i}
            className={`env-shape${s.held ? ' held' : ''}`}
            points={s.points}
            style={{ stroke: color }}
          />
        ))}
        {activePts && <polyline className="env-active" points={activePts} />}
        {playhead && (
          <circle
            className="env-playhead"
            cx={px(g, playhead.timeSec)}
            cy={py(g, playhead.levelQ24)}
            r={2.4}
            style={{ fill: color }}
          />
        )}
      </svg>
      {trace.nodes.map((n) => {
        const leftPct = (px(g, n.timeSec) / W) * 100;
        const topPct = (py(g, n.levelQ24) / H) * 100;
        return (
          <button
            key={n.stage}
            type="button"
            className={`env-node${n.reached ? '' : ' unreached'}`}
            style={{ left: `${leftPct}%`, top: `${topPct}%`, borderColor: color }}
            aria-label={nodeLabel(n.stage)}
            title={nodeLabel(n.stage)}
            onPointerDown={(e) => onNodeDown(e, n.stage)}
            onKeyDown={(e) => onNodeKey(e, n.stage)}
          />
        );
      })}
      {kind === 'pitch' && (
        <button
          type="button"
          className="env-node level-only"
          style={{
            left: `${(px(g, 0) / W) * 100}%`,
            top: `${(py(g, trace.startLevelQ24) / H) * 100}%`,
            borderColor: color,
          }}
          aria-label="Start level L4"
          title="Start level L4"
          onPointerDown={(e) => onNodeDown(e, 3, true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') onNodeKey(e, 3);
          }}
        />
      )}
      {timeScale.clamped && (
        <span className="env-overflow" title="Envelope extends past the visible time range">
          ›
        </span>
      )}
    </div>
  );
}

type Subscribe = (cb: (s: SynthStatus) => void) => () => void;

/** EnvEditor wired to the live status stream for the active-stage highlight. */
export function LiveEnvEditor(
  props: Omit<EnvEditorProps, 'stage'> & { subscribe: Subscribe; opIdx?: number },
) {
  const { subscribe, opIdx, ...rest } = props;
  const stage = useStatus(
    subscribe,
    (s) => (rest.kind === 'pitch' ? s.pitchStep : s.steps[opIdx ?? 0]),
    4,
  );
  const playLevel = useStatus(
    subscribe,
    (s) => (rest.kind === 'pitch' ? s.pitchLevel : s.levels[opIdx ?? 0]),
    0,
  );
  return <EnvEditor {...rest} stage={stage} playLevel={playLevel} />;
}

/** [startSec, endSec] of the given stage for the active-segment highlight. */
function stageWindow(trace: EnvTrace, stage: number): [number, number] {
  if (stage <= 0) return [0, trace.nodes[0].timeSec];
  if (stage === 1) return [trace.nodes[0].timeSec, trace.nodes[1].timeSec];
  if (stage === 2) return [trace.nodes[1].timeSec, trace.nodes[2].timeSec];
  return [trace.gateSec, trace.releaseEndSec];
}

/**
 * The curve point within the active stage's time window whose level is closest
 * to the live envelope level — where the playback dot sits. Level is monotonic
 * within a stage, so the nearest-level point is unambiguous; during a constant
 * sustain/hold it parks at the sustain node.
 */
function playheadPoint(
  trace: EnvTrace,
  stage: number,
  levelQ24: number,
): { timeSec: number; levelQ24: number } | null {
  const [from, to] = stageWindow(trace, stage);
  let best: { timeSec: number; levelQ24: number } | null = null;
  let bestErr = Infinity;
  for (const p of trace.curve) {
    if (p.timeSec < from - 1e-6 || p.timeSec > to + 1e-6) continue;
    const err = Math.abs(p.levelQ24 - levelQ24);
    if (err < bestErr) {
      bestErr = err;
      best = p;
    }
  }
  return best;
}
