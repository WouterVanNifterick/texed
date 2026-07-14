import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import dexedIcon from './assets/dexed-icon.svg';
import { useDexedSynth, programIndexForVoice } from './audio/useDexedSynth';
import { initMidi, type MidiConnection } from './audio/midi';
import { getVoiceName, withVoiceName, voiceToSysex } from './state/params';
import { Keyboard } from './components/Keyboard';
import { OperatorPanel } from './components/OperatorPanel';
import { GlobalPanel } from './components/GlobalPanel';
import { PartRack } from './components/PartRack';
import { Knob } from './components/ui';

const QWERTY_MAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
  o: 13, l: 14, p: 15, ';': 16,
};

const OCTAVE_BASE = 60;
const ENGINES = ['MODERN', 'MARK I', 'OPL'];

function patchFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter((f) => /\.(syx|dx7voice)$/i.test(f.name));
}

function isFileDrag(dt: DataTransfer | null): boolean {
  return !!dt && (dt.types.includes('Files') || Array.from(dt.items).some((i) => i.kind === 'file'));
}

function patchFilesFromDrop(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const fromList = patchFiles(dt.files);
  if (fromList.length) return fromList;
  const fromItems: File[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  return patchFiles(fromItems);
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
  const heldKeys = useRef<Set<string>>(new Set());
  const [loadMsg, setLoadMsg] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

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
    setLoadMsg(parts.join(' · '));
    const t = setTimeout(() => setLoadMsg(null), 6000);
    return () => clearTimeout(t);
  }, [synth.loadReport]);

  const noteOn = useCallback(
    (note: number, velocity: number, channel = 1) => {
      synth.noteOn(note, velocity, channel);
      setActiveNotes((prev) => new Set(prev).add(note));
    },
    [synth],
  );

  const noteOff = useCallback(
    (note: number, channel = 1) => {
      synth.noteOff(note, channel);
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
      noteOn: (n, v, ch) => noteOn(n, v, ch),
      noteOff: (n, ch) => noteOff(n, ch),
      controlChange: (cc, val, ch) => synth.controlChange(cc, val, ch),
      pitchBend: (v, ch) => synth.pitchBend(v, ch),
      aftertouch: (v, ch) => synth.aftertouch(v, ch),
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
        String(Math.min(window.innerWidth / 1440, window.innerHeight / 930)),
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
    (idx: number) => synth.setProgram(idx),
    [synth],
  );

  const onLoadFile = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files?.length) return;
      const list = Array.from(files);
      const chunks: Uint8Array[] = [];
      for (const file of list) {
        chunks.push(new Uint8Array(await file.arrayBuffer()));
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const combined = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        combined.set(c, off);
        off += c.length;
      }
      synth.loadCart(combined.slice().buffer);
    },
    [synth],
  );

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth.current += 1;
      if (dragDepth.current === 1) setDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };

    const onDragLeave = () => {
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    };

    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = patchFilesFromDrop(e.dataTransfer);
      if (!files.length) {
        setLoadMsg('No .syx or .Dx7Voice files in drop');
        setTimeout(() => setLoadMsg(null), 6000);
        return;
      }
      void (async () => {
        if (!started) await handleStart();
        await onLoadFile(files);
      })();
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [started, handleStart, onLoadFile]);

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
        <header className="topbar">
        <div className="logo">
          <img src={dexedIcon} alt="" className="logo-icon" width={28} height={28} />
          DEXED<span>·WEB</span>
        </div>

        <div className="part-edit-group">
          <div className="part-strip" title="Select part for voice editing">
            {Array.from({ length: 8 }, (_, i) => {
              const cfg = synth.partConfigs[i];
              const selected = i === synth.selectedPart;
              return (
                <button
                  key={i}
                  type="button"
                  className={`part-btn${selected ? ' selected' : ''}${cfg && !cfg.enabled ? ' off' : ''}`}
                  onClick={() => synth.selectPart(i)}
                  title={`Part ${i + 1}${cfg && !cfg.enabled ? ' (disabled)' : ''}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <input
            className="voice-name"
            value={getVoiceName(synth.voice)}
            maxLength={10}
            spellCheck={false}
            onChange={(e) => synth.setVoice(withVoiceName(synth.voice, e.target.value.toUpperCase()))}
            title={`Voice name — editing part ${synth.selectedPart + 1}`}
          />
        </div>

        <select
          className="program-select"
          value={program}
          onChange={(e) => onSelectProgram(Number(e.target.value))}
          disabled={synth.programOptions.length === 0}
        >
          {synth.programOptions.length === 0 ? (
            <option value={0}>INIT VOICE</option>
          ) : (
            synth.programOptions.map((opt, i) => (
              <option key={i} value={i}>
                {opt.label}
              </option>
            ))
          )}
        </select>

        {loadMsg && <span className="load-msg" title={loadMsg}>{loadMsg}</span>}

        <button type="button" className="bar-btn" onClick={() => fileRef.current?.click()}>
          LOAD
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".syx,.Dx7Voice"
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : null;
            e.target.value = '';
            void onLoadFile(files);
          }}
        />
        <button type="button" className="bar-btn" onClick={onSaveVoice}>
          SAVE
        </button>
        <button type="button" className="bar-btn" onClick={onEngine} title="FM engine">
          {ENGINES[engine]}
        </button>
        <button type="button" className="bar-btn" onClick={() => setShowParts(true)} title="Multi-timbral part rack">
          PARTS
        </button>

        <label className="poly-ctl" title="Polyphony (voices)">
          POLY
          <select
            value={polyphony}
            onChange={(e) => {
              const n = Number(e.target.value);
              setPolyphony(n);
              synth.setPolyphonyCap(n);
            }}
          >
            {[8, 16, 24, 32, 48, 64, 96, 128].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

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
