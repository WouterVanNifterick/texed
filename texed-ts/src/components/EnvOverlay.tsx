// Combined envelope view: all six operator amp EGs plus the pitch EG on one
// shared plot. Non-selected traces are dimmed background context; the selected
// one is drawn on top and is fully editable. Click a trace or a legend chip to
// select it.

import { useMemo } from 'react';
import type { SynthStatus } from '../audio/useDexedSynth';
import { OP, G, opBase } from '../state/params';
import { helpProps, setHelp } from '../state/help';
import { simulateAmpEnv, simulatePitchEnv } from '../engine/env-sim';
import { computeAmpParams, pitchEgParams, REF_LABEL, type EnvTimeScale } from './env-time';
import { makeYMap, curvePoints, OP_COLORS, PITCH_COLOR, type YMode, type DrawGeom } from './env-draw';
import { LiveEnvEditor } from './EnvEditor';

const W = 100;
const H = 100;
const PAD = 2;

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
}: EnvOverlayProps) {
  // Background polylines for every envelope (the selected one is redrawn on top
  // by the editor). Recomputed when any EG byte or the scale changes.
  const bg = useMemo(() => {
    const ampYmap = makeYMap('amp', yMode);
    const pitchYmap = makeYMap('pitch', yMode);
    const out: { key: string; sel: EnvSelection; color: string; points: string; kind: 'amp' | 'pitch' }[] = [];
    for (let opNum = 1; opNum <= 6; opNum++) {
      const trace = simulateAmpEnv(computeAmpParams(voice, opNum), timeScale.gateSec);
      const g: DrawGeom = { W, H, pad: PAD, ts: timeScale, ymap: ampYmap };
      out.push({ key: `op${opNum}`, sel: opNum, color: OP_COLORS[opNum - 1], points: curvePoints(trace, g), kind: 'amp' });
    }
    const peg = pitchEgParams(voice);
    const pt = simulatePitchEnv(peg.rates, peg.levels, timeScale.gateSec);
    const pg: DrawGeom = { W, H, pad: PAD, ts: timeScale, ymap: pitchYmap };
    out.push({ key: 'pitch', sel: 'pitch', color: PITCH_COLOR, points: curvePoints(pt, pg), kind: 'pitch' });
    return out;
  }, [voice, timeScale, yMode]);

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
              ampParams={computeAmpParams(voice, opNum)}
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
                setHelp({ title: `OP${opNum} envelope`, text: `Select OP${opNum}'s amplitude envelope to edit it on top of the others.` });
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
        <span className="env-ref" title={`Timing shown for ${REF_LABEL}`}>{REF_LABEL}</span>
      </div>

      <div className="env-overlay-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="env-overlay-bg" aria-hidden>
          {timeScale.gridlines.map((gl, i) => (
            <line key={i} x1={PAD + gl.x01 * (W - 2 * PAD)} y1={0} x2={PAD + gl.x01 * (W - 2 * PAD)} y2={H} className="env-grid" />
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
        </svg>
        {editor}
        <div className="env-overlay-axis" aria-hidden>
          <span>{yMode === 'db' ? '0 dB' : '1.0'}</span>
          <span>{yMode === 'db' ? '−72 dB' : '0'}</span>
        </div>
      </div>
    </section>
  );
}
