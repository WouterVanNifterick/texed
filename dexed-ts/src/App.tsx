import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import dexedIcon from './assets/dexed-icon.svg';
import { useDexedSynth, programIndexForVoice } from './audio/useDexedSynth';
import { initMidi, type MidiConnection } from './audio/midi';
import { getVoiceName, voiceToSysex } from './state/params';
import { useFileDrop, useQwertyKeyboard, useStageScale, useTransientMessage } from './hooks';
import { Keyboard } from './components/Keyboard';
import { OperatorPanel } from './components/OperatorPanel';
import { GlobalPanel } from './components/GlobalPanel';
import { PartRack } from './components/PartRack';
import { TopBar } from './components/TopBar';

const ENGINES = ['MODERN', 'MARK I', 'OPL'];

/** Perceptual volume taper: knob 0-99 to master gain. */
function masterGain(volume: number): number {
  return (volume / 99) ** 2;
}

export default function App() {
  const synth = useDexedSynth();
  const [started, setStarted] = useState(false);
  const [engine, setEngine] = useState(1); // Mark I default
  const [volume, setVolume] = useState(80);
  const [cutoff, setCutoff] = useState(99);
  const [reso, setReso] = useState(0);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [hoverOp, setHoverOp] = useState<number | null>(null);
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const [showParts, setShowParts] = useState(false);
  const [polyphony, setPolyphony] = useState(32);
  const midiRef = useRef<MidiConnection | null>(null);
  const [loadMsg, showLoadMsg] = useTransientMessage();

  useStageScale(1440, 930);

  useEffect(() => {
    if (!synth.loadReport) return;
    const { applied, skipped } = synth.loadReport;
    const perf = applied.find((a) => a.startsWith('performances'));
    const banks = applied.filter((a) => a.startsWith('VMEM →'));
    const amem = applied.filter((a) => a.startsWith('AMEM →'));
    const parts: string[] = [];
    if (perf) parts.push(perf);
    if (banks.length) parts.push(`${banks.length} VMEM bank${banks.length > 1 ? 's' : ''}`);
    if (amem.length) parts.push(`${amem.length} AMEM pair${amem.length > 1 ? 's' : ''}`);
    const rest = applied.filter(
      (a) =>
        !a.startsWith('performances') &&
        !a.startsWith('VMEM →') &&
        !a.startsWith('AMEM'),
    );
    parts.push(...rest);
    if (skipped.length) parts.push(`skipped: ${skipped.join(', ')}`);
    showLoadMsg(parts.join(' · '));
  }, [synth.loadReport, showLoadMsg]);

  const { noteOn: rackNoteOn, noteOff: rackNoteOff } = synth;

  const noteOn = useCallback(
    (note: number, velocity: number, channel = 1) => {
      rackNoteOn(note, velocity, channel);
      setActiveNotes((prev) => new Set(prev).add(note));
    },
    [rackNoteOn],
  );

  const noteOff = useCallback(
    (note: number, channel = 1) => {
      rackNoteOff(note, channel);
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    },
    [rackNoteOff],
  );

  const handleStart = useCallback(async () => {
    await synth.start();
    setStarted(true);
    synth.setEngine(engine);
    synth.setMasterGain(masterGain(volume));
    midiRef.current = await initMidi({
      noteOn,
      noteOff,
      controlChange: synth.controlChange,
      pitchBend: synth.pitchBend,
      aftertouch: synth.aftertouch,
      inputsChanged: setMidiInputs,
    });
  }, [synth, engine, volume, noteOn, noteOff]);

  useQwertyKeyboard(started, noteOn, noteOff);

  useEffect(() => {
    return () => midiRef.current?.close();
  }, []);

  const onEngine = useCallback(() => {
    const next = (engine + 1) % ENGINES.length;
    setEngine(next);
    synth.setEngine(next);
  }, [synth, engine]);

  const onVolume = useCallback(
    (v: number) => {
      setVolume(v);
      synth.setMasterGain(masterGain(v));
    },
    [synth],
  );

  const onFx = useCallback(
    (c: number, r: number) => {
      setCutoff(c);
      setReso(r);
      synth.setFx(c / 99, r / 99, 1);
    },
    [synth],
  );

  const onSelectProgram = useCallback(
    (idx: number) => {
      synth.setProgram(idx);
      setActiveNotes(new Set());
    },
    [synth],
  );

  const onLoadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      synth.loadCart(await new Blob(files).arrayBuffer());
    },
    [synth],
  );

  const onDrop = useCallback(
    (files: File[]) => {
      if (!files.length) {
        showLoadMsg('No .syx or .Dx7Voice files in drop');
        return;
      }
      void (async () => {
        if (!started) await handleStart();
        await onLoadFiles(files);
      })();
    },
    [started, handleStart, onLoadFiles, showLoadMsg],
  );

  const dragging = useFileDrop(onDrop);

  const selectedVoice = synth.partConfigs[synth.selectedPart]?.voice;
  const programIdx = selectedVoice
    ? programIndexForVoice(synth.programOptions, selectedVoice)
    : 0;
  const program = programIdx >= 0 ? programIdx : 0;

  const onSaveVoice = useCallback(() => {
    const syx = voiceToSysex(synth.voice);
    const url = URL.createObjectURL(new Blob([syx.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getVoiceName(synth.voice).trim() || 'voice'}.syx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [synth]);

  return (
    <div className="app-root">
      <div className="rack">
        <TopBar
          synth={synth}
          program={program}
          onSelectProgram={onSelectProgram}
          loadMsg={loadMsg}
          onLoadFiles={onLoadFiles}
          onSaveVoice={onSaveVoice}
          engineName={ENGINES[engine]}
          onEngine={onEngine}
          onShowParts={() => setShowParts(true)}
          polyphony={polyphony}
          onPolyphony={(n) => {
            setPolyphony(n);
            synth.setPolyphonyCap(n);
          }}
          volume={volume}
          onVolume={onVolume}
          cutoff={cutoff}
          reso={reso}
          onFx={onFx}
          midiInputs={midiInputs}
        />

        <main className="editor">
          {[1, 2, 3, 4, 5, 6].map((opNum) => (
            <OperatorPanel
              key={opNum}
              opNum={opNum}
              voice={synth.voice}
              supplement={synth.supplement}
              setParam={synth.setParam}
              setSupplementParam={synth.setSupplementParam}
              subscribeStatus={synth.subscribeStatus}
              hovered={hoverOp === opNum}
              onHover={setHoverOp}
            />
          ))}
          <GlobalPanel
            voice={synth.voice}
            supplement={synth.supplement}
            setParam={synth.setParam}
            setSupplementParam={synth.setSupplementParam}
            subscribeStatus={synth.subscribeStatus}
            hoverOp={hoverOp}
            onHoverOp={setHoverOp}
          />
        </main>

        <Keyboard onNoteOn={noteOn} onNoteOff={noteOff} activeNotes={activeNotes} />
      </div>

      {showParts && (
        <PartRack
          configs={synth.partConfigs}
          selectedPart={synth.selectedPart}
          programOptions={synth.programOptions}
          performanceNames={synth.performanceNames}
          performanceIndex={synth.performanceIndex}
          onSelectPerformance={synth.selectPerformance}
          masterTuneCents={synth.masterTuneCents}
          onMasterTune={synth.setMasterTune}
          onSelect={synth.selectPart}
          onSetPart={synth.setPart}
          onSetVoiceRef={synth.setVoiceRef}
          subscribeStatus={synth.subscribeStatus}
          onClose={() => setShowParts(false)}
        />
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden>
          Drop .syx or .Dx7Voice files to load
        </div>
      )}

      {!started && (
        <div className="start-overlay">
          <img src={dexedIcon} alt="" className="start-icon" width={72} height={72} />
          <button type="button" className="start" onClick={handleStart}>
            START AUDIO
          </button>
          <p>
            Click to initialize the audio engine, or drop .syx / .Dx7Voice files anywhere to load and start.
            Play with mouse, QWERTY (A–K) or MIDI.
          </p>
        </div>
      )}
    </div>
  );
}
