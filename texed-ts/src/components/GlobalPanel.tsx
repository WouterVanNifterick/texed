// Global voice parameters: algorithm + feedback, LFO (with live level meter),
// the pitch envelope and the DX7II AMEM supplement.

import { memo, useState } from 'react';
import { useStatus, type SynthStatus } from '../audio/useDexedSynth';
import { G, LFO_WAVES, formatTransposeSemitones, PARAM_CENTER } from '../state/params';
import * as Sup from '../state/supplement';
import { helpProps } from '../state/help';
import { useLiveCtrl } from '../state/live-ctrl';
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
  return <EnvGraph rates={rates} levels={levels} stage={stage} tall variant="pitch" />;
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
  const [showControllers, setShowControllers] = useState(false);
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
          <Knob
            label="ALGO"
            value={voice[G.algorithm]}
            max={31}
            format={(a) => `${a + 1}`}
            onChange={set(G.algorithm)}
            help="Algorithm (1–32) — how the six operators are stacked: which are carriers (make sound) and which are modulators (shape timbre)."
          />
          <Knob
            label="F/BACK"
            value={voice[G.feedback]}
            max={7}
            onChange={set(G.feedback)}
            help="Feedback (0–7) — depth of the algorithm’s feedback loop; adds harmonics, approaching noise at 7."
          />
          <Knob
            label="TRANSP"
            value={voice[G.transpose]}
            max={48}
            center={PARAM_CENTER.transpose}
            format={formatTransposeSemitones}
            onChange={set(G.transpose)}
            help="Key transpose (−24…+24 semitones) — shifts the whole voice; 0 is no transpose."
          />
          <Toggle
            label="KEY SYNC"
            on={voice[G.oscKeySync] !== 0}
            onChange={(on) => setParam(G.oscKeySync, on ? 1 : 0)}
            help="Oscillator key sync — restarts all operator phases on every key-down for a consistent attack."
          />
        </div>
      </section>

      <section className="panel lfo-panel">
        <div className="panel-head">
          <span className="panel-title">LFO</span>
          <LfoMeter subscribe={subscribeStatus} />
        </div>
        <LfoGraph waveform={voice[G.lfoWave]} speed={voice[G.lfoSpeed]} delay={voice[G.lfoDelay]} />
        <div className="ctl-row">
          <Cycle
            label="WAVE"
            value={voice[G.lfoWave]}
            options={LFO_WAVES}
            onChange={set(G.lfoWave)}
            help="LFO waveform — triangle, saw down, saw up, square, sine, or sample & hold (random steps)."
          />
          <Knob
            label="SPEED"
            value={voice[G.lfoSpeed]}
            max={99}
            onChange={set(G.lfoSpeed)}
            help="LFO speed (0–99) — rate of the shared vibrato/tremolo oscillator."
          />
          <Knob
            label="DELAY"
            value={voice[G.lfoDelay]}
            max={99}
            onChange={set(G.lfoDelay)}
            help="LFO delay (0–99) — time before the LFO fades in after a key is pressed, for delayed vibrato."
          />
        </div>
        <div className="ctl-row">
          <Knob
            label="PM DEP"
            value={voice[G.lfoPmd]}
            max={99}
            onChange={set(G.lfoPmd)}
            help="LFO pitch modulation depth (0–99) — vibrato amount permanently applied to the voice."
          />
          <Knob
            label="AM DEP"
            value={voice[G.lfoAmd]}
            max={99}
            onChange={set(G.lfoAmd)}
            help="LFO amplitude modulation depth (0–99) — tremolo/wah amount; each operator’s AMS sets how much it responds."
          />
          <Knob
            label="PM SENS"
            value={voice[G.pitchModSens]}
            max={7}
            onChange={set(G.pitchModSens)}
            help="Pitch modulation sensitivity (0–7) — how strongly the voice responds to LFO pitch modulation."
          />
          <Toggle
            label="SYNC"
            on={voice[G.lfoKeySync] !== 0}
            onChange={(on) => setParam(G.lfoKeySync, on ? 1 : 0)}
            help="LFO key sync — restarts the LFO waveform from its peak on every key-down."
          />
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
              center={PARAM_CENTER.pitchEgLevel}
              onChange={set(G.pitchEgLevel(i))}
              help={`Pitch EG level ${i + 1} (0–99) — the pitch this envelope segment settles at; 50 is no pitch change.`}
            />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <Knob
              key={`r${i}`}
              label={`R${i + 1}`}
              value={voice[G.pitchEgRate(i)]}
              max={99}
              onChange={set(G.pitchEgRate(i))}
              help={`Pitch EG rate ${i + 1} (0–99) — how fast the pitch moves to L${i + 1}; higher is faster.`}
            />
          ))}
        </div>
      </section>

      <section className="panel dx7ii-panel">
        <div className="panel-head">
          <span className="panel-title">DX7II</span>
          <button
            type="button"
            className={`bar-btn ctrl-mod-btn${showControllers ? ' on' : ''}`}
            onClick={() => setShowControllers((s) => !s)}
            {...helpProps('CTRL', 'Opens the DX7II controller assignments: modulation ranges and live values for MW, BC, AT, MC, FC1 and FC2.')}
          >
            CTRL
          </button>
        </div>
        <div className="dx7ii-groups">
          <div className="ctl-group">
            <div className="ctl-group-label">VOICE</div>
            <div className="ctl-row">
              <Toggle
                label="MONO"
                on={Sup.getMono(supplement)}
                onChange={(on) => setSup(Sup.setMono(supplement, on))}
                help="Mono mode — plays one note at a time with last-note priority instead of polyphonically."
              />
              <Toggle
                label="UNISON"
                on={Sup.getUnison(supplement)}
                onChange={(on) => setSup(Sup.setUnison(supplement, on))}
                help="Unison — stacks several detuned voices on every note for a fatter sound, at the cost of polyphony."
              />
              <Knob
                label="UNI DET"
                value={Sup.getUnisonDetune(supplement)}
                max={7}
                size={24}
                onChange={(v) => setSup(Sup.setUnisonDetune(supplement, v))}
                help="Unison detune (0–7) — pitch spread between the stacked unison voices."
              />
              <Knob
                label="RND PT"
                value={Sup.getRandomPitchDepth(supplement)}
                max={7}
                size={24}
                onChange={(v) => setSup(Sup.setRandomPitchDepth(supplement, v))}
                help="Random pitch (0–7) — random per-note pitch drift, like a slightly unstable analog oscillator."
              />
            </div>
          </div>
          <div className="ctl-group">
            <div className="ctl-group-label">LFO</div>
            <div className="ctl-row">
              <Toggle
                label="M.LFO"
                on={Sup.getLfoKeyTrigger(supplement)}
                onChange={(on) => setSup(Sup.setLfoKeyTrigger(supplement, on))}
                help="Multi LFO — every note gets its own LFO restarted at key-down, instead of one LFO shared by all notes."
              />
            </div>
          </div>
          <div className="ctl-group">
            <div className="ctl-group-label">PITCH BEND</div>
            <div className="ctl-row">
              <Knob
                label="PB RNG"
                value={Sup.getPitchBendRange(supplement)}
                max={12}
                size={24}
                onChange={(v) => setSup(Sup.setPitchBendRange(supplement, v))}
                help="Pitch bend range (0–12) — bend wheel range in semitones, up to one octave."
              />
              <Knob
                label="PB STEP"
                value={Sup.getPitchBendStep(supplement)}
                max={12}
                size={24}
                onChange={(v) => setSup(Sup.setPitchBendStep(supplement, v))}
                help="Pitch bend step (0–12) — quantizes the bend into semitone steps; 0 bends smoothly."
              />
              <Cycle
                label="PB MODE"
                value={Sup.getPitchBendMode(supplement)}
                options={Sup.PB_MODES}
                onChange={(v) => setSup(Sup.setPitchBendMode(supplement, v))}
                help="Pitch bend mode — bend all notes, only the lowest or highest note, or only physically held keys (K.ON)."
              />
            </div>
          </div>
          <div className="ctl-group">
            <div className="ctl-group-label">PORTAMENTO</div>
            <div className="ctl-row">
              <Knob
                label="PORTA"
                value={Sup.getPortaTime(supplement)}
                max={99}
                size={24}
                onChange={(v) => setSup(Sup.setPortaTime(supplement, v))}
                help="Portamento time (0–99) — glide time from the previous note to the new one; 0 is instant."
              />
              <Cycle
                label="P MODE"
                value={Sup.getPortaMode(supplement)}
                options={Sup.PORTA_MODES}
                onChange={(v) => setSup(Sup.setPortaMode(supplement, v))}
                help="Portamento mode — RETAIN/FOLLOW in poly mode; FINGERED (legato only) or FULL TIME in mono mode."
              />
              <Knob
                label="P STEP"
                value={Sup.getPortaStep(supplement)}
                max={12}
                size={24}
                onChange={(v) => setSup(Sup.setPortaStep(supplement, v))}
                help="Portamento step (0–12) — glissando in quantized semitone steps instead of a smooth glide; 0 is smooth."
              />
            </div>
          </div>
          <div className="ctl-group">
            <div className="ctl-group-label">PITCH EG</div>
            <div className="ctl-row">
              <Cycle
                label="PEG RNG"
                value={Sup.getPitchEgRange(supplement)}
                options={Sup.PEG_RANGES}
                onChange={(v) => setSup(Sup.setPitchEgRange(supplement, v))}
                help="Pitch EG range — maximum pitch envelope excursion: 8 or 4 octaves, 1 octave, or a half octave."
              />
              <Knob
                label="PEG RS"
                value={Sup.getPitchEgScaleRate(supplement)}
                max={7}
                size={24}
                onChange={(v) => setSup(Sup.setPitchEgScaleRate(supplement, v))}
                help="Pitch EG rate scaling (0–7) — the pitch envelope runs faster for higher notes."
              />
              <Toggle
                label="PEG VEL"
                on={Sup.getPitchEgVelSens(supplement)}
                onChange={(on) => setSup(Sup.setPitchEgVelSens(supplement, on))}
                help="Pitch EG velocity — key velocity scales the depth of the pitch envelope."
              />
            </div>
          </div>
        </div>
      </section>

      {showControllers && (
        <ControllerPanel supplement={supplement} setSup={setSup} onClose={() => setShowControllers(false)} />
      )}
    </div>
  );
});

// One controller strip: pitch / amp / EG bias ranges plus the 4th destination
// (volume for FC1/FC2/MC, pitch bias for BC/AT) and the FC1 CS1 switch.
// Foot controllers sit at the bottom of the popup.
interface CtrlRowSpec {
  ctrl: Sup.CtrlName;
  label: string;
  name: string;
  fourth: 'vol' | 'bias' | null;
}

const CTRL_ROWS: CtrlRowSpec[] = [
  { ctrl: 'wheel', label: 'MW', name: 'Modulation wheel (MIDI CC 1)', fourth: null },
  { ctrl: 'breath', label: 'BC', name: 'Breath controller (MIDI CC 2)', fourth: 'bias' },
  { ctrl: 'at', label: 'AT', name: 'Channel aftertouch (key pressure)', fourth: 'bias' },
  { ctrl: 'midiCtrl', label: 'MC', name: 'MIDI IN controller (MIDI CC 13)', fourth: 'vol' },
  { ctrl: 'foot2', label: 'FC2', name: 'Foot controller 2 (MIDI CC 11)', fourth: 'vol' },
  { ctrl: 'foot', label: 'FC1', name: 'Foot controller 1 (MIDI CC 4)', fourth: 'vol' },
];

const DEST_HELP: Record<string, (name: string) => string> = {
  PITCH: (n) => `Pitch modulation range (0–99) — how much LFO pitch modulation the ${n} can add.`,
  AMP: (n) => `Amplitude modulation range (0–99) — how much LFO amplitude modulation the ${n} can add.`,
  EG: (n) => `EG bias range (0–99) — the ${n} raises the level of AMS-sensitive operators, e.g. for breath-controlled swells.`,
  VOL: (n) => `Volume range (0–99) — how far the ${n} can attenuate the part volume.`,
  BIAS: (n) => `Pitch bias (−50…+50) — the ${n} bends pitch directly up or down from center 0.`,
};

/** Controller name plus a live meter fed by incoming MIDI. */
function CtrlId({ ctrl, label, name }: { ctrl: Sup.CtrlName; label: string; name: string }) {
  const value = useLiveCtrl(ctrl);
  return (
    <div className="ctrl-mod-id" {...helpProps(label, `${name} — the meter shows the last received MIDI value (${value}).`)}>
      <span className="ctrl-mod-name">
        {label}
        <span className="ctrl-live-val">{value}</span>
      </span>
      <div className="ctrl-live">
        <div className="ctrl-live-fill" style={{ width: `${(value / 127) * 100}%` }} />
      </div>
    </div>
  );
}

function ControllerPanel({
  supplement,
  setSup,
  onClose,
}: {
  supplement: Uint8Array;
  setSup: (edit: Sup.ByteEdit) => void;
  onClose: () => void;
}) {
  const knob = (row: CtrlRowSpec, dest: number, label: string, format?: (v: number) => string, center?: number) => (
    <Knob
      label={label}
      value={Sup.getCtrlRange(supplement, row.ctrl, dest)}
      max={99}
      size={20}
      center={center}
      format={format}
      onChange={(v) => setSup(Sup.setCtrlRange(supplement, row.ctrl, dest, v))}
      help={DEST_HELP[label](row.name)}
    />
  );

  return (
    <section className="panel ctrl-mod-panel">
      <div className="panel-head">
        <span className="panel-title">CONTROLLERS</span>
        <button type="button" className="bar-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      {CTRL_ROWS.map((row) => (
        <div className="ctrl-mod-row" key={row.ctrl}>
          <CtrlId ctrl={row.ctrl} label={row.label} name={row.name} />
          {knob(row, 0, 'PITCH')}
          {knob(row, 1, 'AMP')}
          {knob(row, 2, 'EG')}
          {row.fourth === 'vol' && knob(row, 3, 'VOL')}
          {row.fourth === 'bias' && knob(row, 3, 'BIAS', Sup.formatPitchBias, Sup.PITCH_BIAS_CENTER)}
          {row.fourth === null && <span />}
          {row.ctrl === 'foot' ? (
            <Toggle
              label="CS1"
              on={Sup.getFc1AsCs1(supplement)}
              onChange={(on) => setSup(Sup.setFc1AsCs1(supplement, on))}
              help="Use FC1 as the CS1 continuous slider (direct data entry) instead of a modulation source."
            />
          ) : (
            <span />
          )}
        </div>
      ))}
    </section>
  );
}
