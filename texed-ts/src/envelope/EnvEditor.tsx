// Accurate, draggable envelope editor. Draws one envelope (an operator amp EG
// or the pitch EG) with realistic per-stage times and levels from env-sim, on
// the shared time scale. Nodes are draggable in 2D: horizontal sets the stage
// rate (inverted from the engine timing), vertical sets the stage level.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStatus } from '../audio/useSynth';
import type { StatusSubscribe } from '../audio/synth-types';
import {
  simulateAmpEnv,
  simulatePitchEnv,
  solveAmpNodeDrag,
  solvePitchNodeDrag,
  type AmpEnvParams,
  type EnvDragSolution,
  type EnvTrace,
} from '@texed/dx7-engine/env-sim';
import { setEnvAxisFrozen, useEnvZoomPan } from '../state/env-axis';
import type { EnvTimeScale } from './env-time';
import {
  makeYMap,
  curveSegments,
  fillPoints,
  playheadPoint,
  px,
  py,
  stageWindow,
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

/**
 * Everything a drag needs, captured on pointer-down.
 *
 * The gesture is solved from this snapshot rather than from the live props, so
 * the node position is a pure function of the cursor: no dependence on a value
 * a previous pointer event has already changed, and no way for the per-stage
 * block rounding to ratchet over the course of a drag. `sent` tracks what has
 * actually been emitted so an unchanged param does not re-render the editor.
 */
interface DragState {
  stage: number;
  levelOnly: boolean;
  rates: number[];
  levels: number[];
  ampParams?: AmpEnvParams;
  /** Time the dragged stage starts at - fixed, since earlier stages are untouched. */
  prevNodeSec: number;
  sent: { rates: number[]; levels: number[] };
}

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
  const drag = useRef<DragState | null>(null);
  useEnvZoomPan(root, PAD / W);

  // The last solved drag, unrounded.
  //
  // A DX7 parameter is a whole number, and its tables are coarse and uneven -
  // 42 of the 99 EG level steps produce no change at all, and the ones that do
  // jump by up to 3 dB. Solving the drag in between them is what keeps the node
  // under the cursor instead of snapping from one reachable value to the next.
  // Only the drawing uses it: the voice, and so everything that is heard or
  // saved, still only ever holds the rounded value.
  //
  // It is used only while it still rounds to what the voice reports, so a patch
  // load, an undo or a knob edit retires it without any bookkeeping.
  const [fine, setFine] = useState<EnvDragSolution | null>(null);
  const live =
    fine &&
    fine.rates.every((v, i) => Math.round(v) === rates[i]) &&
    fine.levels.every((v, i) => Math.round(v) === levels[i])
      ? fine
      : null;
  const eRates = live ? live.rates : rates;
  const eLevels = live ? live.levels : levels;
  const eAmpParams =
    live && ampParams ? { ...ampParams, rates: eRates, levels: eLevels } : ampParams;

  // Deliberately not memoized. Callers rebuild ampParams/rates/levels on every
  // render, so a useMemo here could never hit - it only looked like caching. The
  // replay costs ~6us, which is far below the cost of pretending otherwise.
  const trace: EnvTrace =
    kind === 'amp'
      ? simulateAmpEnv(eAmpParams!, timeScale.gateSec)
      : simulatePitchEnv(eRates, eLevels, timeScale.gateSec);

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
  const playhead = props.playLevel != null ? playheadPoint(trace, stage, props.playLevel) : null;

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

    // Horizontal position is the stage's *duration*, not an absolute time.
    const desiredSec = d.levelOnly ? null : Math.max(0, timeScale.t(x01) - d.prevNodeSec);
    const target = ymap.y01ToLevel(y01);
    // The amp and pitch paths differ only in which inverse mapping applies.
    const next = d.ampParams
      ? solveAmpNodeDrag(d.ampParams, d.stage, desiredSec, target)
      : solvePitchNodeDrag(d.rates, d.levels, d.stage, desiredSec, target);

    // Keep the fractional solution for the drawing, and re-render on it: when a
    // move does not cross a whole step nothing is emitted, so this is the only
    // thing that moves the node. React batches it with the emissions below, so
    // a render never sees one without the other.
    setFine(next);

    // Round only here. The solver deliberately works in fractions - it solves
    // the rate against the *new* level and re-solves the follower from it - and
    // rounding any earlier would put the cursor lag straight back.
    for (let i = 0; i < 4; i++) {
      const r = Math.round(next.rates[i]);
      if (r !== d.sent.rates[i]) {
        d.sent.rates[i] = r;
        onSetRate(i, r);
      }
      const l = Math.round(next.levels[i]);
      if (l !== d.sent.levels[i]) {
        d.sent.levels[i] = l;
        onSetLevel(i, l);
      }
    }
  }

  const onNodeDown = (e: React.PointerEvent, s: number, levelOnly = false) => {
    (e.currentTarget as HTMLElement).focus();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointer ids
    }
    // Snapshot the *effective* params, so grabbing a node again continues from
    // where it is drawn rather than from the rounded value behind it.
    const r = [eRates[0], eRates[1], eRates[2], eRates[3]];
    const l = [eLevels[0], eLevels[1], eLevels[2], eLevels[3]];
    drag.current = {
      stage: s,
      levelOnly,
      rates: r,
      levels: l,
      ampParams:
        kind === 'amp'
          ? { ...eAmpParams!, rates: [...r], levels: [...l] } // copies: the props are rebuilt per render
          : undefined,
      prevNodeSec: prevNodeTime(s),
      // What the voice already holds - `live` guarantees these are the rounded r/l.
      sent: { rates: [...rates], levels: [...levels] },
    };
    setEnvAxisFrozen(true);
    e.stopPropagation();
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setEnvAxisFrozen(false);
  };

  // Selecting another envelope mid-drag unmounts this editor; without this the
  // axis would stay frozen with no gesture left to end it.
  useEffect(
    () => () => {
      endDrag();
    },
    [],
  );

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
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
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
      </svg>
      {playhead && (
        <span
          className="env-playhead"
          style={{
            left: `${(px(g, playhead.timeSec) / W) * 100}%`,
            top: `${(py(g, playhead.levelQ24) / H) * 100}%`,
            background: color,
          }}
          aria-hidden
        />
      )}
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
      {timeScale.clippedLeft && (
        <span className="env-overflow left" title="Scrolled past the start of the envelope">
          ‹
        </span>
      )}
      {timeScale.clamped && (
        <span className="env-overflow" title="Envelope extends past the visible time range">
          ›
        </span>
      )}
    </div>
  );
}

/** EnvEditor wired to the live status stream for the active-stage highlight. */
export function LiveEnvEditor(
  props: Omit<EnvEditorProps, 'stage'> & { subscribe: StatusSubscribe; opIdx?: number },
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
