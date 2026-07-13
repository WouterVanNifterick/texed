import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import dexedIcon from './assets/dexed-icon.svg';
import { useDexedSynth } from './audio/useDexedSynth';
import { initMidi, type MidiConnection } from './audio/midi';
import { getVoiceName, withVoiceName, voiceToSysex } from './state/params';
import { Keyboard } from './components/Keyboard';
import { OperatorPanel } from './components/OperatorPanel';
import { GlobalPanel } from './components/GlobalPanel';
import { Knob } from './components/ui';

const QWERTY_MAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
  o: 13, l: 14, p: 15, ';': 16,
};

const OCTAVE_BASE = 60;
const ENGINES = ['MODERN', 'MARK I', 'OPL'];

export default function App() {
  const synth = useDexedSynth();
  const [started, setStarted] = useState(false);
  const [engine, setEngine] = useState(1); // Mark I default
  const [volume, setVolume] = useState(80);
  const [cutoff, setCutoff] = useState(99);
  const [reso, setReso] = useState(0);
  const [program, setProgram] = useState(0);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [hoverOp, setHoverOp] = useState<number | null>(null);
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const midiRef = useRef<MidiConnection | null>(null);
  const heldKeys = useRef<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const noteOn = useCallback(
    (note: number, velocity: number) => {
      synth.noteOn(note, velocity);
      setActiveNotes((prev) => new Set(prev).add(note));
    },
    [synth],
  );

  const noteOff = useCallback(
    (note: number) => {
      synth.noteOff(note);
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    },
    [synth],
  );

  const handleStart = useCallback(async () => {
    await synth.start();
    setStarted(true);
    synth.setEngine(engine);
    synth.setMasterGain(volume / 99);
    const conn = await initMidi({
      noteOn: (n, v) => noteOn(n, v),
      noteOff: (n) => noteOff(n),
      controlChange: (c, val) => synth.controlChange(c, val),
      pitchBend: (v) => synth.pitchBend(v),
      aftertouch: (v) => synth.aftertouch(v),
    });
    midiRef.current = conn;
    if (conn) setMidiInputs(conn.inputNames);
  }, [synth, engine, volume, noteOn, noteOff]);

  // QWERTY input
  useEffect(() => {
    if (!started) return;
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const semi = QWERTY_MAP[e.key.toLowerCase()];
      if (semi === undefined || heldKeys.current.has(e.key)) return;
      heldKeys.current.add(e.key);
      noteOn(OCTAVE_BASE + semi, 100);
    };
    const up = (e: KeyboardEvent) => {
      const semi = QWERTY_MAP[e.key.toLowerCase()];
      if (semi === undefined) return;
      heldKeys.current.delete(e.key);
      noteOff(OCTAVE_BASE + semi);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [started, noteOn, noteOff]);

  useEffect(() => {
    return () => midiRef.current?.close();
  }, []);

  // Fixed-size stage scaled to fit the window, like a resizable plugin UI.
  useEffect(() => {
    const update = () =>
      document.documentElement.style.setProperty(
        '--stage-scale',
        String(Math.min(window.innerWidth / 1440, window.innerHeight / 850)),
      );
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const onEngine = useCallback(() => {
    const next = (engine + 1) % ENGINES.length;
    setEngine(next);
    synth.setEngine(next);
  }, [synth, engine]);

  const onVolume = useCallback(
    (v: number) => {
      setVolume(v);
      synth.setMasterGain(v / 99);
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
      setProgram(idx);
      synth.setProgram(idx);
    },
    [synth],
  );

  const onLoadFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      synth.loadCart(await file.arrayBuffer());
      setProgram(0);
    },
    [synth],
  );

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
        <header className="topbar">
        <div className="logo">
          <img src={dexedIcon} alt="" className="logo-icon" width={28} height={28} />
          DEXED<span>·WEB</span>
        </div>

        <input
          className="voice-name"
          value={getVoiceName(synth.voice)}
          maxLength={10}
          spellCheck={false}
          onChange={(e) => synth.setVoice(withVoiceName(synth.voice, e.target.value.toUpperCase()))}
          title="Voice name"
        />

        <select
          className="program-select"
          value={program}
          onChange={(e) => onSelectProgram(Number(e.target.value))}
          disabled={synth.programNames.length === 0}
        >
          {synth.programNames.length === 0 ? (
            <option value={0}>INIT VOICE</option>
          ) : (
            synth.programNames.map((name, i) => (
              <option key={i} value={i}>
                {String(i + 1).padStart(2, '0')} {name}
              </option>
            ))
          )}
        </select>

        <button type="button" className="bar-btn" onClick={() => fileRef.current?.click()}>
          LOAD
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".syx"
          hidden
          onChange={(e) => {
            onLoadFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button type="button" className="bar-btn" onClick={onSaveVoice}>
          SAVE
        </button>
        <button type="button" className="bar-btn" onClick={onEngine} title="FM engine">
          {ENGINES[engine]}
        </button>

        <div className="bar-knobs">
          <Knob label="VOLUME" value={volume} max={99} size={28} onChange={onVolume} />
          <Knob label="CUTOFF" value={cutoff} max={99} size={28} onChange={(c) => onFx(c, reso)} />
          <Knob label="RESO" value={reso} max={99} size={28} onChange={(r) => onFx(cutoff, r)} />
        </div>

        <button type="button" className="bar-btn panic" onClick={synth.panic}>
          PANIC
        </button>
        <span className={`midi-led${midiInputs.length > 0 ? ' on' : ''}`} title={midiInputs.join(', ') || 'No MIDI inputs'}>
          MIDI
        </span>
      </header>

      <main className="editor">
        {[1, 2, 3, 4, 5, 6].map((opNum) => (
          <OperatorPanel
            key={opNum}
            opNum={opNum}
            voice={synth.voice}
            setParam={synth.setParam}
            subscribeStatus={synth.subscribeStatus}
            hovered={hoverOp === opNum}
            onHover={setHoverOp}
          />
        ))}
        <GlobalPanel
          voice={synth.voice}
          setParam={synth.setParam}
          subscribeStatus={synth.subscribeStatus}
          hoverOp={hoverOp}
          onHoverOp={setHoverOp}
        />
      </main>

        <Keyboard onNoteOn={noteOn} onNoteOff={noteOff} activeNotes={activeNotes} />
      </div>

      {!started && (
        <div className="start-overlay">
          <img src={dexedIcon} alt="" className="start-icon" width={72} height={72} />
          <button type="button" className="start" onClick={handleStart}>
            START AUDIO
          </button>
          <p>Click to initialize the audio engine. Play with mouse, QWERTY (A–K) or MIDI.</p>
        </div>
      )}
    </div>
  );
}
