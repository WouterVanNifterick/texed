// One operator strip: on/off, live level meter, EG graph + knobs, oscillator
// frequency, key/velocity scaling. Meters subscribe individually so 30 Hz
// status updates never re-render the whole panel.

import { memo } from 'react';
import { useStatus } from '../audio/useSynth';
import type { StatusSubscribe } from '../audio/synth-types';
import {
  OP,
  G,
  opBase,
  formatOpFreq,
  formatDetune,
  OSC_MODES,
  PARAM_CENTER,
} from '@texed/dx7-format/voice';
import {
  getAms,
  setAms,
  getScalingMode,
  setScalingMode,
  type ByteEdit,
} from '@texed/dx7-format/supplement';
import { algoGraph } from '../state/algo';
import { helpProps, setHelp } from '../state/help';
import { useOpDropTarget, type OpClipboard } from '../state/useOpClipboard';
import { DropHint } from './DropHint';
import { Knob } from '../ui/Knob';
import { Cycle } from '../ui/Cycle';
import { Toggle } from '../ui/Toggle';
import { LiveEnvEditor } from '../envelope/EnvEditor';
import { computeAmpParams, type EnvTimeScale } from '../envelope/env-time';
import { type YMode } from '../envelope/env-draw';
import { opColor } from '../ui/op-colors';
import { ScalingGraph } from './ScalingGraph';

// Help-bar descriptions, paraphrased from the DX7 / DX7II operating manuals.
const HELP = {
  egLevel: (i: number) =>
    `EG level ${i + 1} of 4 (0–99) - the level this envelope segment settles at. L4 is the level after key release, usually 0.`,
  egRate: (i: number) =>
    `EG rate ${i + 1} of 4 (0–99) - how fast the envelope travels to L${i + 1}; higher is faster.`,
  mode: 'Oscillator mode - RATIO tracks the keyboard as a multiple of the played note; FIXED holds a constant frequency in Hz.',
  coarse:
    'Frequency coarse - ratio ×0.50 to ×31.00 in RATIO mode; 1 / 10 / 100 / 1000 Hz steps in FIXED mode.',
  fine: 'Frequency fine (0–99) - raises the coarse frequency by up to ×2 (RATIO) or ×10 (FIXED) in small steps.',
  detune:
    'Detune (−7…+7) - slight pitch offset against the other operators, for thickness and beating.',
  level:
    'Output level (0–99) - loudness for a carrier; modulation depth (brightness/timbre) when this operator modulates another.',
  vel: 'Key velocity sensitivity (0–7) - how strongly playing harder raises this operator’s output level.',
  rateSc:
    'Keyboard rate scaling (0–7) - envelopes run faster toward the top of the keyboard, like acoustic instruments.',
  ams: 'Amplitude modulation sensitivity (0–7) - how much LFO amp modulation and controller EG bias affect this operator.',
  fract:
    'Fractional scaling (DX7II) - high-resolution keyboard level scaling, stored in the AMEM supplement.',
  scaling:
    'Keyboard level scaling - operator level varies around the break point. Drag left/right of the break point to set depths, drag the blue line to move it, click the corner labels to change curves (−LIN −EXP +EXP +LIN).',
  head: 'Drag this header onto another operator to copy this one there - drop on its envelope graph to copy only the EG, hold Alt to swap the two. Ctrl+C and Ctrl+V copy and paste the selected operator; Ctrl+Shift+V pastes the envelope alone.',
};

function OpMeter({ subscribe, opIdx }: { subscribe: StatusSubscribe; opIdx: number }) {
  const amp = useStatus(subscribe, (s) => s.amps[opIdx], 0);
  return (
    <div className="meter">
      <div className="meter-fill" style={{ transform: `scaleX(${amp.toFixed(3)})` }} />
    </div>
  );
}

interface OperatorPanelProps {
  opNum: number; // 1..6
  voice: Uint8Array;
  supplement: Uint8Array;
  setParam: (offset: number, value: number) => void;
  setSupplementParam: (offset: number, value: number) => void;
  subscribeStatus: StatusSubscribe;
  hovered: boolean;
  onHover: (opNum: number | null) => void;
  /** This operator is the currently selected one (edited in the combined view). */
  selected: boolean;
  /** Select this operator. */
  onSelect: () => void;
  timeScale: EnvTimeScale;
  yMode: YMode;
  /** Show the per-operator envelope graph (hidden in the combined view). */
  showEnv: boolean;
  /** Flat 1×6 layout: lay the panel out horizontally. */
  flat: boolean;
  /** Reference note/velocity the envelope curve is drawn for. */
  note: number;
  velocity: number;
  clipboard: OpClipboard;
}

export const OperatorPanel = memo(function OperatorPanel({
  opNum,
  voice,
  supplement,
  setParam,
  setSupplementParam,
  subscribeStatus,
  hovered,
  onHover,
  selected,
  onSelect,
  timeScale,
  yMode,
  showEnv,
  flat,
  note,
  velocity,
  clipboard,
}: OperatorPanelProps) {
  const drop = useOpDropTarget(opNum, clipboard);
  const base = opBase(opNum);
  const opIdx = 6 - opNum; // sysex order, used by the engine status
  const v = (rel: number) => voice[base + rel];
  const set = (rel: number) => (value: number) => setParam(base + rel, value);
  const setSup = (edit: ByteEdit) => setSupplementParam(edit.offset, edit.value);

  // AMS spans two stores: 0–3 lives in the voice, the DX7II extension 4–7 in
  // the AMEM supplement. The engine uses the supplement value when it is > 3.
  const amsExt = getAms(supplement, opIdx);
  const ams = amsExt > 3 ? amsExt : v(OP.ampModSens);
  const onAms = (value: number) => {
    setParam(base + OP.ampModSens, Math.min(3, value));
    setSup(setAms(supplement, opIdx, value));
  };

  const enabled = (voice[G.opEnable] & (1 << opIdx)) !== 0;
  const outLevel = v(OP.outputLevel);
  const levelZero = outLevel === 0;
  const carrier = algoGraph(voice[G.algorithm]).nodes.find((n) => n.op === opIdx)?.carrier;
  const rates = [v(0), v(1), v(2), v(3)];
  const levels = [v(4), v(5), v(6), v(7)];

  return (
    // Pointing at or into the panel selects the operator for the combined view.
    // Focus bubbles from the controls inside, so tabbing gets there too; the
    // panel itself holds no controls of its own that need a keyboard handler.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className={`panel op-panel${enabled && !levelZero ? '' : ' disabled'}${enabled && levelZero ? ' level-cue' : ''}${hovered ? ' hilite' : ''}${selected ? ' selected' : ''}${flat ? ' flat' : ''}${drop.armed ? ' drop-armed' : ''}`}
      style={{ ['--op' as string]: opColor(opNum) }}
      aria-label={`Operator ${opNum}`}
      aria-current={selected}
      onPointerEnter={() => onHover(opNum)}
      onPointerLeave={() => onHover(null)}
      onPointerDown={onSelect}
      onFocus={onSelect}
      {...drop.dropProps}
    >
      {drop.hint && <DropHint action={drop.hint} />}
      <div
        className="panel-head"
        // Pointer-only help: the OP button nested inside has its own, and
        // helpProps would also claim the focus that belongs to that button.
        onPointerEnter={() => setHelp({ title: `OP${opNum}`, text: HELP.head })}
        onPointerLeave={() => setHelp(null)}
        {...clipboard.dragProps(opNum)}
      >
        <button
          type="button"
          className={`op-power${enabled ? ' on' : ''}`}
          onClick={() => setParam(G.opEnable, voice[G.opEnable] ^ (1 << opIdx))}
          {...helpProps(
            `OP${opNum} ON/OFF`,
            'Switches this operator in or out of the algorithm - useful for hearing what each operator contributes.',
          )}
        >
          OP{opNum}
        </button>
        <span className={`op-role${carrier ? ' carrier' : ''}`}>{carrier ? 'CAR' : 'MOD'}</span>
        <span className="op-freq">{formatOpFreq(voice, base)}</span>
        <OpMeter subscribe={subscribeStatus} opIdx={opIdx} />
      </div>

      {showEnv && (
        <LiveEnvEditor
          kind="amp"
          rates={rates}
          levels={levels}
          ampParams={computeAmpParams(voice, opNum, !!carrier, note, velocity)}
          timeScale={timeScale}
          yMode={yMode}
          color={opColor(opNum)}
          subscribe={subscribeStatus}
          opIdx={opIdx}
          onSetRate={(i, val) => setParam(base + OP.egRate(i), val)}
          onSetLevel={(i, val) => setParam(base + OP.egLevel(i), val)}
        />
      )}

      <div className="eg-grid">
        {[0, 1, 2, 3].map((i) => (
          <Knob
            key={`l${i}`}
            label={`L${i + 1}`}
            value={v(OP.egLevel(i))}
            max={99}
            onChange={set(OP.egLevel(i))}
            help={HELP.egLevel(i)}
          />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <Knob
            key={`r${i}`}
            label={`R${i + 1}`}
            value={v(OP.egRate(i))}
            max={99}
            onChange={set(OP.egRate(i))}
            help={HELP.egRate(i)}
          />
        ))}
      </div>

      <div className="ctl-row">
        <Cycle
          label="MODE"
          value={v(OP.oscMode)}
          options={OSC_MODES}
          onChange={set(OP.oscMode)}
          help={HELP.mode}
        />
        <Knob
          label="COARSE"
          value={v(OP.freqCoarse)}
          max={31}
          onChange={set(OP.freqCoarse)}
          help={HELP.coarse}
        />
        <Knob
          label="FINE"
          value={v(OP.freqFine)}
          max={99}
          onChange={set(OP.freqFine)}
          help={HELP.fine}
        />
        <Knob
          label="DETUNE"
          value={v(OP.detune)}
          max={14}
          center={PARAM_CENTER.detune}
          format={formatDetune}
          onChange={set(OP.detune)}
          help={HELP.detune}
        />
        <Knob
          label="LEVEL"
          value={outLevel}
          max={99}
          accent={levelZero ? 'var(--red)' : 'var(--green)'}
          className={levelZero ? 'level-zero' : undefined}
          onChange={set(OP.outputLevel)}
          help={
            levelZero
              ? 'Output level is 0 - raise LEVEL to hear this operator (or to modulate with it).'
              : HELP.level
          }
        />
        <Knob
          label="VEL"
          value={v(OP.velocitySens)}
          max={7}
          onChange={set(OP.velocitySens)}
          help={HELP.vel}
        />
      </div>

      <div className="ctl-row scale-row">
        <div className="scale-graph-wrap" {...helpProps('LEVEL SCALING', HELP.scaling)}>
          <ScalingGraph
            breakPoint={v(OP.breakPoint)}
            leftDepth={v(OP.leftDepth)}
            rightDepth={v(OP.rightDepth)}
            leftCurve={v(OP.leftCurve)}
            rightCurve={v(OP.rightCurve)}
            color={opColor(opNum)}
            note={note}
            onChange={(field, value) => setParam(base + OP[field], value)}
          />
        </div>
        <Knob
          label="RATE SC"
          value={v(OP.rateScaling)}
          max={7}
          onChange={set(OP.rateScaling)}
          help={HELP.rateSc}
        />
        <Knob label="AMS" value={ams} max={7} onChange={onAms} help={HELP.ams} />
        <Toggle
          label="FRACT"
          on={getScalingMode(supplement, opIdx)}
          help={HELP.fract}
          onChange={(on) => setSup(setScalingMode(supplement, opIdx, on))}
        />
      </div>
    </section>
  );
});
