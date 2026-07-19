// Combined envelope view: all six operator amp EGs plus the pitch EG on one
// shared plot. Non-selected traces are dimmed background context; the selected
// one is drawn on top and is fully editable. Click a trace or a legend chip to
// select it.

import { useMemo } from 'react';
import type { SynthStatus } from '../audio/useDexedSynth';
import { OP, G, opBase } from '@texed/dx7-format/params';
import { helpProps, setHelp } from '../state/help';
import { simulateAmpEnv, simulatePitchEnv } from '@texed/dx7-engine/env-sim';
import { computeAmpParams, pitchEgParams, type EnvTimeScale } from './env-time';
import {
  makeYMap,
  curvePoints,
  OP_COLORS,
  PITCH_COLOR,
  type YMode,
  type DrawGeom,
} from './env-draw';
import { LiveEnvEditor } from './EnvEditor';
import { noteLabel } from './ui';

const W = 100;
const H = 100;
const PAD = 2;

// The crosshair maps the paint note across the on-screen keyboard span
// (C2–C7) and the velocity 1..127 over the plot height. It is a loose visual
// tie between "note ↔ horizontal, velocity ↔ vertical", not a data axis.
const XHAIR_NOTE_LO = 36;
const XHAIR_NOTE_HI = 96;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Subscribe = (cb: (s: SynthStatus) => void) => () => void;
export type EnvSelection = number | 'pitch'; // op number 1..6, or the pitch EG

interface EnvOverlayProps {
  voice: Uint8Array;
  timeScale: EnvTimeScale;
  yMode: YMode;
  selected: EnvSelection;
  onSelect: (sel: EnvSelection) => void;
  setParam: (offset: number, value: number) => void;
  subscribeStatus: Subscribe;
  hoverOp: number | null;
  onHoverOp: (opNum: number | null) => void;
  note: number;
  velocity: number;
}

export function EnvOverlay({
  voice,
  timeScale,
  yMode,
  selected,
  onSelect,
  setParam,
  subscribeStatus,
  hoverOp,
  onHoverOp,
  note,
  velocity,
}: EnvOverlayProps) {
  // Background polylines for every envelope (the selected one is redrawn on top
  // by the editor). Recomputed when any EG byte or the scale changes.
  const bg = useMemo(() => {
    const ampYmap = makeYMap('amp', yMode);
    const pitchYmap = makeYMap('pitch', yMode);
    const out: {
      key: string;
      sel: EnvSelection;
      color: string;
      points: string;
      kind: 'amp' | 'pitch';
    }[] = [];
    for (let opNum = 1; opNum <= 6; opNum++) {
      const trace = simulateAmpEnv(
        computeAmpParams(voice, opNum, true, note, velocity),
        timeScale.gateSec,
      );
      const g: DrawGeom = { W, H, pad: PAD, ts: timeScale, ymap: ampYmap };
      out.push({
        key: `op${opNum}`,
        sel: opNum,
        color: OP_COLORS[opNum - 1],
        points: curvePoints(trace, g),
        kind: 'amp',
      });
    }
    const peg = pitchEgParams(voice);
    const pt = simulatePitchEnv(peg.rates, peg.levels, timeScale.gateSec);
    const pg: DrawGeom = { W, H, pad: PAD, ts: timeScale, ymap: pitchYmap };
    out.push({
      key: 'pitch',
      sel: 'pitch',
      color: PITCH_COLOR,
      points: curvePoints(pt, pg),
      kind: 'pitch',
    });
    return out;
  }, [voice, timeScale, yMode, note, velocity]);

  // Crosshair position: note → x (over the keyboard span), velocity → y (top = loud).
  const xhairX =
    PAD + clamp01((note - XHAIR_NOTE_LO) / (XHAIR_NOTE_HI - XHAIR_NOTE_LO)) * (W - 2 * PAD);
  const xhairY = PAD + (1 - clamp01(velocity / 127)) * (H - 2 * PAD);

  // Editor props for the selected envelope.
  const editor =
    selected === 'pitch'
      ? (() => {
          const peg = pitchEgParams(voice);
          return (
            <LiveEnvEditor
              kind="pitch"
              rates={peg.rates}
              levels={peg.levels}
              timeScale={timeScale}
              yMode={yMode}
              color={PITCH_COLOR}
              className="env-overlay-fg"
              subscribe={subscribeStatus}
              onSetRate={(i, v) => setParam(G.pitchEgRate(i), v)}
              onSetLevel={(i, v) => setParam(G.pitchEgLevel(i), v)}
            />
          );
        })()
      : (() => {
          const opNum = selected;
          const base = opBase(opNum);
          const rates = [voice[base], voice[base + 1], voice[base + 2], voice[base + 3]];
          const levels = [voice[base + 4], voice[base + 5], voice[base + 6], voice[base + 7]];
          return (
            <LiveEnvEditor
              kind="amp"
              rates={rates}
              levels={levels}
              ampParams={computeAmpParams(voice, opNum, true, note, velocity)}
              timeScale={timeScale}
              yMode={yMode}
              color={OP_COLORS[opNum - 1]}
              className="env-overlay-fg"
              subscribe={subscribeStatus}
              opIdx={6 - opNum}
              onSetRate={(i, v) => setParam(base + OP.egRate(i), v)}
              onSetLevel={(i, v) => setParam(base + OP.egLevel(i), v)}
            />
          );
        })();

  return (
    <section className="panel env-overlay-panel">
      <div className="panel-head">
        <span className="panel-title">ENVELOPES</span>
        <div className="env-legend">
          {[1, 2, 3, 4, 5, 6].map((opNum) => (
            <button
              key={opNum}
              type="button"
              className={`env-chip${selected === opNum ? ' on' : ''}${hoverOp === opNum ? ' hover' : ''}`}
              style={{ ['--chip' as string]: OP_COLORS[opNum - 1] }}
              onClick={() => onSelect(opNum)}
              onPointerEnter={() => {
                onHoverOp(opNum);
                setHelp({
                  title: `OP${opNum} envelope`,
                  text: `Select OP${opNum}'s amplitude envelope to edit it on top of the others.`,
                });
              }}
              onPointerLeave={() => {
                onHoverOp(null);
                setHelp(null);
              }}
            >
              OP{opNum}
            </button>
          ))}
          <button
            type="button"
            className={`env-chip pitch${selected === 'pitch' ? ' on' : ''}`}
            style={{ ['--chip' as string]: PITCH_COLOR }}
            onClick={() => onSelect('pitch')}
            {...helpProps('Pitch EG', 'Select the pitch envelope to edit it on top of the others.')}
          >
            PITCH
          </button>
        </div>
      </div>

      <div className="env-overlay-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="env-overlay-bg"
          aria-hidden
        >
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
          <line x1={0} y1={H / 2} x2={W} y2={H / 2} className="env-midline" />
          <line
            x1={PAD + timeScale.x(timeScale.gateSec) * (W - 2 * PAD)}
            y1={0}
            x2={PAD + timeScale.x(timeScale.gateSec) * (W - 2 * PAD)}
            y2={H}
            className="env-gate"
          />
          {bg
            .filter((b) => b.sel !== selected)
            .map((b) => (
              <polyline
                key={b.key}
                className={`env-bg-trace${b.kind === 'pitch' ? ' pitch' : ''}`}
                points={b.points}
                style={{ stroke: b.color }}
                onPointerDown={() => onSelect(b.sel)}
                onPointerEnter={() => typeof b.sel === 'number' && onHoverOp(b.sel)}
                onPointerLeave={() => onHoverOp(null)}
              />
            ))}
          {/* Paint note/velocity crosshair: note ↔ horizontal, velocity ↔ vertical. */}
          <line className="env-xhair-v" x1={xhairX} y1={0} x2={xhairX} y2={H} />
          <line className="env-xhair-h" x1={0} y1={xhairY} x2={W} y2={xhairY} />
          <circle className="env-xhair-dot" cx={xhairX} cy={xhairY} r={1.6} />
        </svg>
        {editor}
        <span
          className="env-xhair-label note"
          style={{ left: `${(xhairX / W) * 100}%` }}
          aria-hidden
        >
          {noteLabel(note)}
        </span>
        <span className="env-xhair-label vel" style={{ top: `${(xhairY / H) * 100}%` }} aria-hidden>
          v{velocity}
        </span>
        <div className="env-overlay-axis" aria-hidden>
          <span>{yMode === 'db' ? '0 dB' : '1.0'}</span>
          <span>{yMode === 'db' ? '−72 dB' : '0'}</span>
        </div>
      </div>
    </section>
  );
}
