// Combined envelope view: all six operator amp EGs plus the pitch EG on one
// shared plot. Non-selected traces are dimmed background context; the selected
// one is drawn on top and is fully editable. Click a trace or a legend chip to
// select it.

import { useMemo } from 'react';
import { OP, G, opBase } from '@texed/dx7-format/voice';
import { setHelp } from '../state/help';
import { useOpDropTarget, type OpClipboard } from '../state/useOpClipboard';
import { simulateAmpEnv, simulatePitchEnv, type EnvTrace } from '@texed/dx7-engine/env-sim';
import { useStatus } from '../audio/useSynth';
import type { StatusSubscribe, SynthStatus } from '../audio/synth-types';
import { computeAmpParams, pitchEgParams, type EnvTimeScale } from './env-time';
import {
  makeYMap,
  curveSegments,
  playheadPoint,
  px,
  py,
  type YMode,
  type DrawGeom,
  type EnvSelection,
} from './env-draw';
import { opColor, PITCH_COLOR } from '../ui/op-colors';
import { LiveEnvEditor } from './EnvEditor';

const W = 100;
const H = 100;
const PAD = 2;

/** One non-editable envelope on the plot: what to draw it with, and where. */
interface BgTrace {
  key: string;
  sel: EnvSelection;
  color: string;
  segments: { points: string; held: boolean }[];
  kind: 'amp' | 'pitch';
  trace: EnvTrace;
  g: DrawGeom;
}

interface EnvOverlayProps {
  voice: Uint8Array;
  timeScale: EnvTimeScale;
  yMode: YMode;
  selected: EnvSelection;
  onSelect: (sel: EnvSelection) => void;
  setParam: (offset: number, value: number) => void;
  subscribeStatus: StatusSubscribe;
  hoverOp: number | null;
  onHoverOp: (opNum: number | null) => void;
  note: number;
  velocity: number;
  clipboard: OpClipboard;
}

/**
 * One legend chip: selects its envelope, and doubles as a drag handle and drop
 * target for it. In this view the operator panels have no envelope graph of
 * their own, so the chips are where envelope-only copies are aimed.
 */
function EnvChip({
  sel,
  color,
  selected,
  hovered,
  clipboard,
  onSelect,
  onHover,
}: {
  sel: EnvSelection;
  color: string;
  selected: boolean;
  hovered: boolean;
  clipboard: OpClipboard;
  onSelect: (sel: EnvSelection) => void;
  onHover: (opNum: number | null) => void;
}) {
  const drop = useOpDropTarget(sel, clipboard, true);
  const name = sel === 'pitch' ? 'Pitch EG' : `OP${sel}`;
  return (
    <button
      type="button"
      className={`env-chip${sel === 'pitch' ? ' pitch' : ''}${selected ? ' on' : ''}${hovered ? ' hover' : ''}${drop.armed ? ' drop-armed' : ''}${drop.hint ? ' drop-over' : ''}`}
      style={{ ['--chip' as string]: color }}
      title={drop.hint?.label}
      onClick={() => onSelect(sel)}
      onPointerEnter={() => {
        if (typeof sel === 'number') onHover(sel);
        setHelp({
          title: `${name} envelope`,
          text: `Select ${name}'s envelope to edit it on top of the others, or drag this chip onto another one to copy the envelope over.`,
        });
      }}
      onPointerLeave={() => {
        onHover(null);
        setHelp(null);
      }}
      {...clipboard.dragProps(sel)}
      {...drop.dropProps}
    >
      {sel === 'pitch' ? 'PITCH' : name}
    </button>
  );
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
  clipboard,
}: EnvOverlayProps) {
  // Background polylines for every envelope (the selected one is redrawn on top
  // by the editor). Recomputed when any EG byte or the scale changes.
  const bg = useMemo(() => {
    const ampG: DrawGeom = { W, H, pad: PAD, ts: timeScale, ymap: makeYMap('amp', yMode) };
    const pitchG: DrawGeom = { W, H, pad: PAD, ts: timeScale, ymap: makeYMap('pitch', yMode) };
    const out: BgTrace[] = [];
    for (let opNum = 1; opNum <= 6; opNum++) {
      const trace = simulateAmpEnv(
        computeAmpParams(voice, opNum, true, note, velocity),
        timeScale.gateSec,
      );
      out.push({
        key: `op${opNum}`,
        sel: opNum,
        color: opColor(opNum),
        segments: curveSegments(trace, ampG),
        kind: 'amp',
        trace,
        g: ampG,
      });
    }
    const peg = pitchEgParams(voice);
    const pt = simulatePitchEnv(peg.rates, peg.levels, timeScale.gateSec);
    out.push({
      key: 'pitch',
      sel: 'pitch',
      color: PITCH_COLOR,
      segments: curveSegments(pt, pitchG),
      kind: 'pitch',
      trace: pt,
      g: pitchG,
    });
    return out;
  }, [voice, timeScale, yMode, note, velocity]);

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
              color={opColor(opNum)}
              className="env-overlay-fg"
              subscribe={subscribeStatus}
              opIdx={6 - opNum}
              onSetRate={(i, v) => setParam(base + OP.egRate(i), v)}
              onSetLevel={(i, v) => setParam(base + OP.egLevel(i), v)}
            />
          );
        })();

  const others = bg.filter((b) => b.sel !== selected);

  return (
    <section className="panel env-overlay-panel">
      <div className="panel-head">
        <span className="panel-title">ENVELOPES</span>
        <div className="env-legend">
          {[1, 2, 3, 4, 5, 6].map((opNum) => (
            <EnvChip
              key={opNum}
              sel={opNum}
              color={opColor(opNum)}
              selected={selected === opNum}
              hovered={hoverOp === opNum}
              clipboard={clipboard}
              onSelect={onSelect}
              onHover={onHoverOp}
            />
          ))}
          <EnvChip
            sel="pitch"
            color={PITCH_COLOR}
            selected={selected === 'pitch'}
            hovered={false}
            clipboard={clipboard}
            onSelect={onSelect}
            onHover={onHoverOp}
          />
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
          {others.flatMap((b) =>
            b.segments.map((s, i) => (
              <polyline
                key={`${b.key}-${i}`}
                className={`env-bg-trace${b.kind === 'pitch' ? ' pitch' : ''}${s.held ? ' held' : ''}`}
                points={s.points}
                style={{ stroke: b.color }}
                onPointerDown={() => onSelect(b.sel)}
                onPointerEnter={() => typeof b.sel === 'number' && onHoverOp(b.sel)}
                onPointerLeave={() => onHoverOp(null)}
              />
            )),
          )}
        </svg>
        <BgPlayheads traces={others} subscribe={subscribeStatus} />
        {editor}
        <div className="env-overlay-axis" aria-hidden>
          <span>{yMode === 'db' ? '0 dB' : '1.0'}</span>
          <span>{yMode === 'db' ? '−72 dB' : '0'}</span>
        </div>
        {/* Time labels: the gridlines move as you zoom, so they need naming. */}
        <div className="env-overlay-times" aria-hidden>
          {timeScale.gridlines.map((gl, i) => (
            <span key={i} style={{ left: `${PAD + gl.x01 * (W - 2 * PAD)}%` }}>
              {gl.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Playback dots for the envelopes that are not being edited. One subscription
 * for all of them: every operator's step and level arrive in the same status
 * frame, so a dot per subscriber would only mean the same frame re-read seven
 * times. The selected envelope draws its own, brighter, dot in the editor.
 */
function BgPlayheads({ traces, subscribe }: { traces: BgTrace[]; subscribe: StatusSubscribe }) {
  const status = useStatus<SynthStatus | null>(subscribe, (s) => s, null);
  if (!status) return null;
  return (
    <>
      {traces.map((b) => {
        // Status arrays are in engine order, the reverse of the UI numbering.
        const opIdx = 6 - (b.sel as number);
        const pitch = b.kind === 'pitch';
        const p = playheadPoint(
          b.trace,
          pitch ? status.pitchStep : status.steps[opIdx],
          pitch ? status.pitchLevel : status.levels[opIdx],
        );
        if (!p) return null;
        return (
          <span
            key={b.key}
            className="env-playhead bg"
            style={{
              left: `${(px(b.g, p.timeSec) / W) * 100}%`,
              top: `${(py(b.g, p.levelQ24) / H) * 100}%`,
              background: b.color,
            }}
            aria-hidden
          />
        );
      })}
    </>
  );
}
