// One operator strip: on/off, live level meter, EG graph + knobs, oscillator
// frequency, key/velocity scaling. Meters subscribe individually so 30 Hz
// status updates never re-render the whole panel.

import { memo } from 'react';
import { useStatus, type SynthStatus } from '../audio/useDexedSynth';
import { OP, G, opBase, formatOpFreq, formatDetune, OSC_MODES } from '../state/params';
import { getAms, setAms } from '../state/supplement';
import { algoGraph } from '../state/algo';
import { Knob, Cycle } from './ui';
import { EnvGraph } from './EnvGraph';
import { ScalingGraph, type ScalingField } from './ScalingGraph';

type Subscribe = (cb: (s: SynthStatus) => void) => () => void;

function OpMeter({ subscribe, opIdx }: { subscribe: Subscribe; opIdx: number }) {
  const amp = useStatus(subscribe, (s) => s.amps[opIdx], 0);
  return (
    <div className="meter">
      <div className="meter-fill" style={{ transform: `scaleX(${amp.toFixed(3)})` }} />
    </div>
  );
}

function LiveEnvGraph({
  subscribe,
  opIdx,
  rates,
  levels,
}: {
  subscribe: Subscribe;
  opIdx: number;
  rates: number[];
  levels: number[];
}) {
  const stage = useStatus(subscribe, (s) => s.steps[opIdx], 4);
  return <EnvGraph rates={rates} levels={levels} stage={stage} />;
}

interface OperatorPanelProps {
  opNum: number; // 1..6
  voice: Uint8Array;
  supplement: Uint8Array;
  setParam: (offset: number, value: number) => void;
  setSupplementParam: (offset: number, value: number) => void;
  subscribeStatus: Subscribe;
  hovered: boolean;
  onHover: (opNum: number | null) => void;
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
}: OperatorPanelProps) {
  const base = opBase(opNum);
  const opIdx = 6 - opNum; // sysex order, used by the engine status
  const v = (rel: number) => voice[base + rel];
  const set = (rel: number) => (value: number) => setParam(base + rel, value);

  // AMS spans two stores: 0–3 lives in the voice, the DX7II extension 4–7 in
  // the AMEM supplement. The engine uses the supplement value when it is > 3.
  const amsExt = getAms(supplement, opIdx);
  const ams = amsExt > 3 ? amsExt : v(OP.ampModSens);
  const onAms = (value: number) => {
    setParam(base + OP.ampModSens, Math.min(3, value));
    const edit = setAms(supplement, opIdx, value);
    setSupplementParam(edit.offset, edit.value);
  };

  const enabled = (voice[G.opEnable] & (1 << opIdx)) !== 0;
  const carrier = algoGraph(voice[G.algorithm]).nodes.find((n) => n.op === opIdx)?.carrier;
  const rates = [v(0), v(1), v(2), v(3)];
  const levels = [v(4), v(5), v(6), v(7)];

  return (
    <section
      className={`panel op-panel${enabled ? '' : ' disabled'}${hovered ? ' hilite' : ''}`}
      onPointerEnter={() => onHover(opNum)}
      onPointerLeave={() => onHover(null)}
    >
      <div className="panel-head">
        <button
          type="button"
          className={`op-power${enabled ? ' on' : ''}`}
          onClick={() => setParam(G.opEnable, voice[G.opEnable] ^ (1 << opIdx))}
          title="Operator on/off"
        >
          OP{opNum}
        </button>
        <span className={`op-role${carrier ? ' carrier' : ''}`}>{carrier ? 'CAR' : 'MOD'}</span>
        <span className="op-freq">{formatOpFreq(voice, base)}</span>
        <OpMeter subscribe={subscribeStatus} opIdx={opIdx} />
      </div>

      <LiveEnvGraph subscribe={subscribeStatus} opIdx={opIdx} rates={rates} levels={levels} />

      <div className="eg-grid">
        {[0, 1, 2, 3].map((i) => (
          <Knob key={`l${i}`} label={`L${i + 1}`} value={v(OP.egLevel(i))} max={99} onChange={set(OP.egLevel(i))} />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <Knob key={`r${i}`} label={`R${i + 1}`} value={v(OP.egRate(i))} max={99} onChange={set(OP.egRate(i))} />
        ))}
      </div>

      <div className="ctl-row">
        <Cycle label="MODE" value={v(OP.oscMode)} options={OSC_MODES} onChange={set(OP.oscMode)} />
        <Knob label="COARSE" value={v(OP.freqCoarse)} max={31} onChange={set(OP.freqCoarse)} />
        <Knob label="FINE" value={v(OP.freqFine)} max={99} onChange={set(OP.freqFine)} />
        <Knob label="DETUNE" value={v(OP.detune)} max={14} format={formatDetune} onChange={set(OP.detune)} />
        <Knob label="LEVEL" value={v(OP.outputLevel)} max={99} accent="var(--green)" onChange={set(OP.outputLevel)} />
        <Knob label="VEL" value={v(OP.velocitySens)} max={7} onChange={set(OP.velocitySens)} />
      </div>

      <div className="ctl-row scale-row">
        <ScalingGraph
          breakPoint={v(OP.breakPoint)}
          leftDepth={v(OP.leftDepth)}
          rightDepth={v(OP.rightDepth)}
          leftCurve={v(OP.leftCurve)}
          rightCurve={v(OP.rightCurve)}
          onChange={(field: ScalingField, value) => setParam(base + OP[field], value)}
        />
        <Knob label="RATE SC" value={v(OP.rateScaling)} max={7} onChange={set(OP.rateScaling)} />
        <Knob label="AMS" value={ams} max={7} onChange={onAms} />
      </div>
    </section>
  );
});
