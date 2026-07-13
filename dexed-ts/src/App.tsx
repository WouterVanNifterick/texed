import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { useDexedSynth } from './audio/useDexedSynth';
import { initMidi, type MidiConnection } from './audio/midi';
import { Keyboard } from './components/Keyboard';
import { PatchSelector } from './components/PatchSelector';
import { Controls } from './components/Controls';

const QWERTY_MAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
  o: 13, l: 14, p: 15, ';': 16,
};

const OCTAVE_BASE = 60;

export default function App() {
  const synth = useDexedSynth();
  const [started, setStarted] = useState(false);
  const [engine, setEngine] = useState(1); // Mark I default
  const [masterGain, setMasterGain] = useState(0.8);
  const [cutoff, setCutoff] = useState(1);
  const [reso, setReso] = useState(0);
  const [program, setProgram] = useState(0);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const midiRef = useRef<MidiConnection | null>(null);
  const heldKeys = useRef<Set<string>>(new Set());

  const noteOn = useCallback(
    (note: number, velocity: number) => {
      synth.noteOn(note, velocity);
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.add(note);
        return next;
      });
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
    synth.setMasterGain(masterGain);
    const conn = await initMidi({
      noteOn: (n, v) => noteOn(n, v),
      noteOff: (n) => noteOff(n),
      controlChange: (c, val) => synth.controlChange(c, val),
      pitchBend: (v) => synth.pitchBend(v),
      aftertouch: (v) => synth.aftertouch(v),
    });
    midiRef.current = conn;
    if (conn) setMidiInputs(conn.inputNames);
  }, [synth, engine, masterGain, noteOn, noteOff]);

  // QWERTY input
  useEffect(() => {
    if (!started) return;
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
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

  const onEngine = useCallback(
    (en: number) => {
      setEngine(en);
      synth.setEngine(en);
    },
    [synth],
  );

  const onMasterGain = useCallback(
    (g: number) => {
      setMasterGain(g);
      synth.setMasterGain(g);
    },
    [synth],
  );

  const onFx = useCallback(
    (c: number, r: number, gain: number) => {
      setCutoff(c);
      setReso(r);
      synth.setFx(c, r, gain);
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

  const onLoadCart = useCallback(
    (data: ArrayBuffer) => {
      synth.loadCart(data);
      setProgram(0);
    },
    [synth],
  );

  return (
    <div className="app">
      <header>
        <h1>Dexed Web</h1>
        <p className="subtitle">DX7 FM synthesis in the browser</p>
      </header>

      {!started ? (
        <div className="start-panel">
          <button type="button" className="start" onClick={handleStart}>
            Start Audio
          </button>
          <p>Click to initialize the audio engine.</p>
        </div>
      ) : (
        <>
          <Controls
            engine={engine}
            onEngine={onEngine}
            masterGain={masterGain}
            onMasterGain={onMasterGain}
            cutoff={cutoff}
            reso={reso}
            fxGain={1}
            onFx={onFx}
            onLoadCart={onLoadCart}
            onPanic={synth.panic}
          />

          <PatchSelector programNames={synth.programNames} selected={program} onSelect={onSelectProgram} />

          <Keyboard onNoteOn={noteOn} onNoteOff={noteOff} activeNotes={activeNotes} />

          <footer>
            <span>{synth.ready ? 'Engine ready' : 'Loading…'}</span>
            <span>{midiInputs.length > 0 ? `MIDI: ${midiInputs.join(', ')}` : 'No MIDI inputs'}</span>
            <span className="hint">Play with mouse, QWERTY (A–K), or a MIDI keyboard.</span>
          </footer>
        </>
      )}
    </div>
  );
}
