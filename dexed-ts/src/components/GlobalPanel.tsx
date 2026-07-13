// Global voice parameters: algorithm + feedback, LFO (with live level meter)
// and the pitch envelope.

import { memo } from 'react';
import type { SynthStatus } from '../audio/useDexedSynth';
import { G, LFO_WAVES, formatTranspose } from '../state/params';
import { Knob, Cycle, Toggle, useStatus } from './ui';
import { AlgoDisplay } from './AlgoDisplay';
import { EnvGraph } from './EnvGraph';

type Subscribe = (cb: (s: SynthStatus) => void) => () => void;

function LfoMeter({ subscribe }: { subscribe: Subscribe }) {
  const lfo = useStatus(subscribe, (s) => s.lfo, 0.5);
  return (
    <div className="meter lfo-meter" title="LFO output">
      <div className="meter-fill" style={{ transform: `scaleX(${lfo.toFixed(3)})` }} />
    </div>
  );
}

function LivePitchEnv({ subscribe, rates, levels }: { subscribe: Subscribe; rates: number[]; levels: number[] }) {
  const stage = useStatus(subscribe, (s) => s.pitchStep, 4);
  return <EnvGraph rates={rates} levels={levels} stage={stage} />;
}

interface GlobalPanelProps {
  voice: Uint8Array;
  setParam: (offset: number, value: number) => void;
  subscribeStatus: Subscribe;
}

export const GlobalPanel = memo(function GlobalPanel({ voice, setParam, subscribeStatus }: GlobalPanelProps) {
  const set = (offset: number) => (value: number) => setParam(offset, value);
  const pitchRates = [voice[G.pitchEgRate(0)], voice[G.pitchEgRate(1)], voice[G.pitchEgRate(2)], voice[G.pitchEgRate(3)]];
  const pitchLevels = [
    voice[G.pitchEgLevel(0)],
    voice[G.pitchEgLevel(1)],
    voice[G.pitchEgLevel(2)],
    voice[G.pitchEgLevel(3)],
  ];

  return (
    <div className="global-col">
      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">ALGORITHM</span>
        </div>
        <AlgoDisplay algorithm={voice[G.algorithm]} />
        <div className="ctl-row">
          <Knob label="ALGO" value={voice[G.algorithm]} max={31} format={(a) => `${a + 1}`} onChange={set(G.algorithm)} />
          <Knob label="F/BACK" value={voice[G.feedback]} max={7} onChange={set(G.feedback)} />
          <Knob
            label="TRANSP"
            value={voice[G.transpose]}
            max={48}
            format={formatTranspose}
            onChange={set(G.transpose)}
          />
          <Toggle label="KEY SYNC" on={voice[G.oscKeySync] !== 0} onChange={(on) => setParam(G.oscKeySync, on ? 1 : 0)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">LFO</span>
          <LfoMeter subscribe={subscribeStatus} />
        </div>
        <div className="ctl-row">
          <Cycle label="WAVE" value={voice[G.lfoWave]} options={LFO_WAVES} onChange={set(G.lfoWave)} />
          <Knob label="SPEED" value={voice[G.lfoSpeed]} max={99} onChange={set(G.lfoSpeed)} />
          <Knob label="DELAY" value={voice[G.lfoDelay]} max={99} onChange={set(G.lfoDelay)} />
        </div>
        <div className="ctl-row">
          <Knob label="PM DEP" value={voice[G.lfoPmd]} max={99} onChange={set(G.lfoPmd)} />
          <Knob label="AM DEP" value={voice[G.lfoAmd]} max={99} onChange={set(G.lfoAmd)} />
          <Knob label="PM SENS" value={voice[G.pitchModSens]} max={7} onChange={set(G.pitchModSens)} />
          <Toggle label="SYNC" on={voice[G.lfoKeySync] !== 0} onChange={(on) => setParam(G.lfoKeySync, on ? 1 : 0)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">PITCH EG</span>
        </div>
        <LivePitchEnv subscribe={subscribeStatus} rates={pitchRates} levels={pitchLevels} />
        <div className="ctl-row">
          {[0, 1, 2, 3].map((i) => (
            <Knob
              key={`r${i}`}
              label={`R${i + 1}`}
              value={voice[G.pitchEgRate(i)]}
              max={99}
              onChange={set(G.pitchEgRate(i))}
            />
          ))}
        </div>
        <div className="ctl-row">
          {[0, 1, 2, 3].map((i) => (
            <Knob
              key={`l${i}`}
              label={`L${i + 1}`}
              value={voice[G.pitchEgLevel(i)]}
              max={99}
              onChange={set(G.pitchEgLevel(i))}
            />
          ))}
        </div>
      </section>
    </div>
  );
});
