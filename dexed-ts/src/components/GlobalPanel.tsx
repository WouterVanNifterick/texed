// Global voice parameters: algorithm + feedback, LFO (with live level meter),
// the pitch envelope and the DX7II AMEM supplement.

import { memo } from 'react';
import { useStatus, type SynthStatus } from '../audio/useDexedSynth';
import { G, LFO_WAVES, formatTranspose } from '../state/params';
import * as Sup from '../state/supplement';
import { Knob, Cycle, Toggle } from './ui';
import { AlgoDisplay } from './AlgoDisplay';
import { EnvGraph } from './EnvGraph';
import { LfoGraph } from './LfoGraph';

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
  return <EnvGraph rates={rates} levels={levels} stage={stage} tall />;
}

interface GlobalPanelProps {
  voice: Uint8Array;
  supplement: Uint8Array;
  setParam: (offset: number, value: number) => void;
  setSupplementParam: (offset: number, value: number) => void;
  subscribeStatus: Subscribe;
  hoverOp: number | null;
  onHoverOp: (opNum: number | null) => void;
}

export const GlobalPanel = memo(function GlobalPanel({
  voice,
  supplement,
  setParam,
  setSupplementParam,
  subscribeStatus,
  hoverOp,
  onHoverOp,
}: GlobalPanelProps) {
  const set = (offset: number) => (value: number) => setParam(offset, value);
  const setSup = (edit: Sup.ByteEdit) => setSupplementParam(edit.offset, edit.value);
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
        <AlgoDisplay algorithm={voice[G.algorithm]} hoverOp={hoverOp} onHover={onHoverOp} />
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

      <section className="panel lfo-panel">
        <div className="panel-head">
          <span className="panel-title">LFO</span>
          <LfoMeter subscribe={subscribeStatus} />
        </div>
        <LfoGraph waveform={voice[G.lfoWave]} speed={voice[G.lfoSpeed]} delay={voice[G.lfoDelay]} />
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

      <section className="panel pitch-panel">
        <div className="panel-head">
          <span className="panel-title">PITCH EG</span>
        </div>
        <LivePitchEnv subscribe={subscribeStatus} rates={pitchRates} levels={pitchLevels} />
        <div className="eg-grid">
          {[0, 1, 2, 3].map((i) => (
            <Knob
              key={`l${i}`}
              label={`L${i + 1}`}
              value={voice[G.pitchEgLevel(i)]}
              max={99}
              onChange={set(G.pitchEgLevel(i))}
            />
          ))}
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
      </section>

      <section className="panel dx7ii-panel">
        <div className="panel-head">
          <span className="panel-title">DX7II</span>
        </div>
        <div className="ctl-row">
          <Toggle label="MONO" on={Sup.getMono(supplement)} onChange={(on) => setSup(Sup.setMono(supplement, on))} />
          <Toggle label="UNISON" on={Sup.getUnison(supplement)} onChange={(on) => setSup(Sup.setUnison(supplement, on))} />
          <Knob
            label="UNI DET"
            value={Sup.getUnisonDetune(supplement)}
            max={7}
            size={24}
            onChange={(v) => setSup(Sup.setUnisonDetune(supplement, v))}
          />
          <Toggle
            label="RND PT"
            on={Sup.getRandomPitch(supplement)}
            onChange={(on) => setSup(Sup.setRandomPitch(supplement, on))}
          />
        </div>
        <div className="ctl-row">
          <Knob
            label="PB RNG"
            value={Sup.getPitchBendRange(supplement)}
            max={12}
            size={24}
            onChange={(v) => setSup(Sup.setPitchBendRange(supplement, v))}
          />
          <Knob
            label="PB STEP"
            value={Sup.getPitchBendStep(supplement)}
            max={12}
            size={24}
            onChange={(v) => setSup(Sup.setPitchBendStep(supplement, v))}
          />
          <Knob
            label="PORTA"
            value={Sup.getPortaTime(supplement)}
            max={99}
            size={24}
            onChange={(v) => setSup(Sup.setPortaTime(supplement, v))}
          />
          <Cycle
            label="P MODE"
            value={Sup.getPortaMode(supplement)}
            options={Sup.PORTA_MODES}
            onChange={(v) => setSup(Sup.setPortaMode(supplement, v))}
          />
          <Toggle
            label="GLISS"
            on={Sup.getPortaGliss(supplement)}
            onChange={(on) => setSup(Sup.setPortaGliss(supplement, on))}
          />
        </div>
        <div className="ctl-row">
          <Cycle
            label="PEG RNG"
            value={Sup.getPitchEgRange(supplement)}
            options={Sup.PEG_RANGES}
            onChange={(v) => setSup(Sup.setPitchEgRange(supplement, v))}
          />
          <Knob
            label="PEG RS"
            value={Sup.getPitchEgScaleRate(supplement)}
            max={7}
            size={24}
            onChange={(v) => setSup(Sup.setPitchEgScaleRate(supplement, v))}
          />
          <Toggle
            label="PEG VEL"
            on={Sup.getPitchEgVelSens(supplement)}
            onChange={(on) => setSup(Sup.setPitchEgVelSens(supplement, on))}
          />
        </div>
      </section>
    </div>
  );
});
