import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import dexedIcon from './assets/dexed-icon.svg';
import { useSynth } from './audio/useSynth';
import { initMidi, type MidiConnection } from './audio/midi';
import {
  setMidiOutConnection,
  setMidiOutTarget,
  setMidiOutLive,
  sendVoiceDump,
  hardwarePort,
} from './audio/midi-out';
import { getVoiceName, voiceToSysex, withVoiceName } from '@texed/dx7-format/params';
import { acedToSysex } from '@texed/dx7-format/amem';
import { trackCc, trackAftertouch } from './state/live-ctrl';
import {
  useFileDrop,
  usePartSelectKeys,
  usePersistentState,
  usePersistentNumber,
  useQwertyKeyboard,
  useStageScale,
  useTransientMessage,
} from './hooks';
import { loadSession, saveSession, SESSION_SCHEMA } from './state/persistence';
import { Keyboard } from './components/Keyboard';
import { HelpBar } from './components/HelpBar';
import { OperatorPanel } from './components/OperatorPanel';
import { GlobalPanel } from './components/GlobalPanel';
import { EnvOverlay, type EnvSelection } from './components/EnvOverlay';
import { useEnvTimeScale, type TimeMode } from './components/env-time';
import { type YMode } from './components/env-draw';
import { Segmented } from './components/ui';
import { RefKeyControl } from './components/RefKeyControl';
import { PartRack } from './components/PartRack';
import { LibraryBrowser } from './components/LibraryBrowser';
import { TopBar } from './components/TopBar';
import { StoreVoiceDialog } from './components/StoreVoiceDialog';
import { StoreIcon } from './components/icons';
import { helpProps } from './state/help';
import type { VoiceRef } from '@texed/dx7-format/voice-library';
import {
  parseMiniDexedIni,
  serializeMiniDexedIni,
  type MiniDexedExtras,
} from '@texed/dx7-format/minidexed-ini';

const ENGINES = ['MODERN', 'MARK I', 'OPL'];

// ?hw - hardware editor mode: the UI drives a real DX7/DX7II/TX802 over MIDI
// SysEx instead of the local engine (pick the output in MIDI settings).
const HW_MODE = new URLSearchParams(window.location.search).has('hw');

// Auto-send: how long edits must settle before the full voice dump goes out.
const AUTO_SEND_DEBOUNCE_MS = 250;

export default function App() {
  const synth = useSynth(HW_MODE ? hardwarePort : undefined);
  const [started, setStarted] = useState(false);
  // Global system-setup settings live in the engine's edit buffer; mirror them.
  const { engine, volume, polyphony } = synth.settings;
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [hoverOp, setHoverOp] = useState<number | null>(null);
  const [selectedOp, setSelectedOp] = useState<EnvSelection>(1);
  const [envView, setEnvView] = usePersistentState<'individual' | 'combined'>(
    'envView',
    'individual',
  );
  const [opLayout, setOpLayout] = usePersistentState<'grid' | 'stack'>('opLayout', 'grid');
  const [timeMode, setTimeMode] = usePersistentState<TimeMode>('envTimeMode', 'log');
  const [yMode, setYMode] = usePersistentState<YMode>('envYMode', 'db');
  const [refNote, setRefNote] = usePersistentNumber('envRefNote', 60);
  const [refVelocity, setRefVelocity] = usePersistentNumber('envRefVelocity', 99);
  const [refFollow, setRefFollow] = usePersistentState<'on' | 'off'>('envRefFollow', 'off');
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const [midiOutputs, setMidiOutputs] = useState<{ id: string; name: string }[]>([]);
  const [midiOutId, setMidiOutId] = usePersistentState<string>('midiOutId', '');
  const [midiLive, setMidiLive] = usePersistentState<'on' | 'off'>('midiLiveSend', 'off');
  const [autoSend, setAutoSend] = usePersistentState<'on' | 'off'>('midiAutoSend', 'off');
  const [showParts, setShowParts] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const midiRef = useRef<MidiConnection | null>(null);
  const [loadMsg, showLoadMsg] = useTransientMessage();
  const [miniDexedExtras, setMiniDexedExtras] = useState<MiniDexedExtras | null>(null);

  useStageScale(1440, 1020);

  const timeScale = useEnvTimeScale(synth.voice, timeMode, refNote, refVelocity);
  const combined = envView === 'combined';
  const stack = opLayout === 'stack';

  // FOLLOW capture reads the toggle through a ref so the note-on callback stays
  // stable (MIDI is wired once at start and must not be re-registered).
  const refFollowRef = useRef(false);
  useEffect(() => {
    refFollowRef.current = refFollow === 'on';
  }, [refFollow]);

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
      (a) => !a.startsWith('performances') && !a.startsWith('VMEM →') && !a.startsWith('AMEM'),
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
      if (refFollowRef.current) {
        setRefNote(note);
        setRefVelocity(velocity);
      }
    },
    [rackNoteOn, setRefNote, setRefVelocity],
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

    const saved = await loadSession();
    if (saved) {
      // setFullState restores parts, edit buffers and global settings together.
      synth.setFullState(saved.rack);
      showLoadMsg('Session restored');
    }

    midiRef.current = await initMidi({
      noteOn,
      noteOff,
      controlChange: (controller, value, channel) => {
        trackCc(controller, value);
        synth.controlChange(controller, value, channel);
      },
      pitchBend: synth.pitchBend,
      aftertouch: (value, channel) => {
        trackAftertouch(value);
        synth.aftertouch(value, channel);
      },
      inputsChanged: setMidiInputs,
      outputsChanged: setMidiOutputs,
    });
    // Route all outgoing SysEx (voice dumps, live param changes) and note
    // forwarding through this connection, restoring the persisted target/toggle.
    setMidiOutConnection(midiRef.current);
    setMidiOutTarget(midiOutId);
    // In hardware mode every edit already goes out through the port; the live
    // mirror would duplicate each frame.
    setMidiOutLive(!HW_MODE && midiLive === 'on');
  }, [synth, noteOn, noteOff, showLoadMsg, midiOutId, midiLive]);

  // Persist the session (debounced): every rack mutation (including global
  // settings) flows through the synth's mirrored state, so the synth object
  // identity is the change signal.
  useEffect(() => {
    if (!started) return;
    const t = window.setTimeout(() => {
      synth.getFullState((rack) => {
        void saveSession({
          schema: SESSION_SCHEMA,
          savedAt: Date.now(),
          rack,
        });
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [started, synth]);

  useQwertyKeyboard(started, noteOn, noteOff);
  usePartSelectKeys(started, synth.selectPart);

  useEffect(() => {
    return () => midiRef.current?.close();
  }, []);

  useEffect(() => {
    setMidiOutTarget(midiOutId);
  }, [midiOutId]);
  useEffect(() => {
    // In hardware mode every edit already goes out through the port; the live
    // mirror would duplicate each frame.
    setMidiOutLive(!HW_MODE && midiLive === 'on');
  }, [midiLive]);

  const onSendVoice = useCallback(() => {
    sendVoiceDump(synth.voice, synth.supplement);
  }, [synth]);

  // Auto-send: after edits settle, push the full ACED + VCED dump. Each new
  // voice/supplement reference restarts the timer (cleanup = debounce), so a
  // slider drag sends once, not per frame. Skipped in ?hw mode (edits already
  // stream through the hardware port).
  useEffect(() => {
    if (HW_MODE || autoSend !== 'on' || !midiOutId) return;
    const t = setTimeout(() => sendVoiceDump(synth.voice, synth.supplement), AUTO_SEND_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [autoSend, midiOutId, synth.voice, synth.supplement]);

  const onSelectProgram = useCallback(
    (idx: number) => {
      synth.setProgram(idx);
      setActiveNotes(new Set());
    },
    [synth],
  );

  const applyMiniDexedIni = useCallback(
    (text: string, fileName: string) => {
      const { name: iniName, parts, voices, extras } = parseMiniDexedIni(text);
      setMiniDexedExtras(extras);
      const name = iniName || fileName.replace(/\.ini$/i, '');
      synth.loadPerformance(name, parts, voices);
      showLoadMsg(`Loaded MiniDexed performance · ${name}`);
    },
    [synth, showLoadMsg],
  );

  const onLoadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const iniFiles = files.filter((f) => /\.ini$/i.test(f.name));
      const syxFiles = files.filter((f) => !/\.ini$/i.test(f.name));
      for (const f of iniFiles) {
        applyMiniDexedIni(await f.text(), f.name);
      }
      if (syxFiles.length) {
        synth.loadCart(await new Blob(syxFiles).arrayBuffer());
      }
    },
    [synth, applyMiniDexedIni],
  );

  const onDrop = useCallback(
    (files: File[]) => {
      if (!files.length) {
        showLoadMsg('No .syx, .ini, or .Dx7Voice files in drop');
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
  // Name shown in the editor is the live edit-buffer name (which may have been
  // edited away from the bank slot it was loaded from), not the library label.
  const editBufferName = getVoiceName(synth.voice).trim() || 'INIT VOICE';

  const onSaveBank = useCallback(() => {
    const bank = synth.partConfigs[synth.selectedPart]?.voice.bank ?? 'internalA';
    synth.requestBankDump(bank, (data) => {
      if (!data) {
        showLoadMsg(`Bank ${bank} is empty - nothing to save`);
        return;
      }
      const url = URL.createObjectURL(
        new Blob([data.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `${bank}.syx`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }, [synth, showLoadMsg]);

  const onStoreConfirm = useCallback(
    (name: string, dest: VoiceRef, destLabel: string) => {
      synth.setVoice(withVoiceName(synth.voice, name));
      synth.storeVoice(dest);
      setShowStore(false);
      showLoadMsg(`Stored voice into ${destLabel}`);
    },
    [synth, showLoadMsg],
  );

  const onSavePerformance = useCallback(() => {
    synth.getFullState((state) => {
      const text = serializeMiniDexedIni({
        name: state.performanceName,
        parts: state.parts,
        voices: state.editBuffers.map((eb) => eb.voice),
        extras: miniDexedExtras,
      });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'performance.ini';
      a.click();
      URL.revokeObjectURL(url);
    });
  }, [synth, miniDexedExtras]);

  const onSaveVoice = useCallback(() => {
    // Single voice = DX7II additional data (ACED) followed by the voice (VCED),
    // the same pair the DX7II transmits for the current voice.
    const aced = acedToSysex(synth.supplement);
    const vced = voiceToSysex(synth.voice);
    const syx = new Uint8Array(aced.length + vced.length);
    syx.set(aced, 0);
    syx.set(vced, aced.length);
    const url = URL.createObjectURL(
      new Blob([syx.buffer as ArrayBuffer], { type: 'application/octet-stream' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getVoiceName(synth.voice).trim() || 'voice'}.syx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [synth]);

  return (
    <div className="app-root" onContextMenu={(e) => e.preventDefault()}>
      <div className="rack">
        <TopBar
          synth={synth}
          loadMsg={loadMsg}
          onLoadFiles={onLoadFiles}
          onSaveVoice={onSaveVoice}
          onSaveBank={onSaveBank}
          onSavePerformance={onSavePerformance}
          engine={engine}
          engineNames={ENGINES}
          onEngine={synth.setEngine}
          onShowParts={() => setShowParts(true)}
          onShowLibrary={() => setShowLibrary(true)}
          polyphony={polyphony}
          onPolyphony={synth.setPolyphonyCap}
          volume={volume}
          onVolume={synth.setVolume}
          masterTuneCents={synth.settings.masterTuneCents}
          onMasterTune={synth.setMasterTune}
          midiInputs={midiInputs}
          midiOutputs={midiOutputs}
          midiOutId={midiOutId}
          onMidiOut={setMidiOutId}
          midiLive={midiLive === 'on'}
          onMidiLive={(on) => setMidiLive(on ? 'on' : 'off')}
          autoSend={autoSend === 'on'}
          onAutoSend={(on) => setAutoSend(on ? 'on' : 'off')}
          onSendVoice={onSendVoice}
        />

        <div className="mode-bar">
          <div className="mode-bar-left">
            <select
              className="program-select"
              // Always show the edit-buffer name as the current value; the bank
              // options are just a picker for loading a different voice.
              value="current"
              onChange={(e) => {
                if (e.target.value !== 'current') onSelectProgram(Number(e.target.value));
              }}
              disabled={synth.programOptions.length === 0}
              {...helpProps(
                'PROGRAM',
                "The voice name in the current part's edit buffer. Pick another entry to load it from a bank.",
              )}
            >
              <option value="current">{editBufferName}</option>
              {synth.programOptions.map((opt, i) => (
                <option key={i} value={i}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bar-btn bar-btn-icon"
              onClick={() => setShowStore(true)}
              aria-label="Store"
              {...helpProps('STORE', 'Store the edited voice into a bank slot (name + location).')}
            >
              <StoreIcon />
            </button>
          </div>
          <div className="mode-bar-viz">
            <Segmented
              value={envView}
              onChange={setEnvView}
              options={[
                {
                  value: 'individual',
                  label: 'SEPARATE',
                  help: 'Show one envelope per operator plus the pitch EG.',
                },
                {
                  value: 'combined',
                  label: 'COMBINED',
                  help: 'Overlay all envelopes on one plot; edit the selected one on top.',
                },
              ]}
            />
            <Segmented
              value={opLayout}
              onChange={setOpLayout}
              options={[
                {
                  value: 'grid',
                  label: '3×2',
                  help: 'Arrange the six operator panels in a 3×2 grid.',
                },
                {
                  value: 'stack',
                  label: '1×6',
                  help: 'Stack the six operators as flat horizontal rows.',
                },
              ]}
            />
            <Segmented
              label="TIME"
              value={timeMode}
              onChange={setTimeMode}
              options={[
                {
                  value: 'log',
                  label: 'LOG',
                  help: 'Logarithmic time axis: fast attacks and slow releases are both legible.',
                },
                {
                  value: 'linear',
                  label: 'LIN',
                  help: 'Linear time axis (clamped to 10 s), same seconds-per-pixel everywhere.',
                },
              ]}
            />
            <Segmented
              label="LEVEL"
              value={yMode}
              onChange={setYMode}
              options={[
                {
                  value: 'db',
                  label: 'dB',
                  help: 'Decibel level axis: decay stages are straight, quiet levels stay visible.',
                },
                {
                  value: 'linear',
                  label: 'LIN',
                  help: 'Linear amplitude axis: matches raw sample output; low levels sit near the floor.',
                },
              ]}
            />
            <RefKeyControl
              note={refNote}
              velocity={refVelocity}
              follow={refFollow === 'on'}
              onNote={setRefNote}
              onVelocity={setRefVelocity}
              onToggleFollow={(on) => setRefFollow(on ? 'on' : 'off')}
            />
          </div>
        </div>

        <main className={`editor${stack ? ' stack' : ''}${combined ? ' combined' : ''}`}>
          {combined && (
            <EnvOverlay
              voice={synth.voice}
              timeScale={timeScale}
              yMode={yMode}
              selected={selectedOp}
              onSelect={setSelectedOp}
              setParam={synth.setParam}
              subscribeStatus={synth.subscribeStatus}
              hoverOp={hoverOp}
              onHoverOp={setHoverOp}
              note={refNote}
              velocity={refVelocity}
            />
          )}
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
              selected={selectedOp === opNum}
              onSelect={() => setSelectedOp(opNum)}
              timeScale={timeScale}
              yMode={yMode}
              showEnv={!combined}
              flat={stack}
              note={refNote}
              velocity={refVelocity}
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
            selected={selectedOp}
            onSelect={setSelectedOp}
            timeScale={timeScale}
            yMode={yMode}
            showEnv={!combined}
          />

          {showParts && (
            <PartRack
              configs={synth.partConfigs}
              voiceNames={synth.partVoiceNames}
              selectedPart={synth.selectedPart}
              programOptions={synth.programOptions}
              onSelect={synth.selectPart}
              onSetPart={synth.setPart}
              onSetVoiceRef={synth.setVoiceRef}
              subscribeStatus={synth.subscribeStatus}
              onClose={() => setShowParts(false)}
            />
          )}
        </main>

        <Keyboard onNoteOn={noteOn} onNoteOff={noteOff} activeNotes={activeNotes} />

        <HelpBar />
      </div>

      {showStore && (
        <StoreVoiceDialog
          synth={synth}
          defaultVoice={selectedVoice}
          onConfirm={onStoreConfirm}
          onClose={() => setShowStore(false)}
        />
      )}

      {showLibrary && (
        <LibraryBrowser synth={synth} showMsg={showLoadMsg} onClose={() => setShowLibrary(false)} />
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden>
          Drop .syx, .ini, or .Dx7Voice files to load
        </div>
      )}

      {!started && (
        <div className="start-overlay">
          <div className="start-card">
            <header className="start-head">
              <img src={dexedIcon} alt="" className="start-icon" width={72} height={72} />
              <div className="start-title">
                <h1>TEXED</h1>
                <p className="start-tag">
                  Yamaha DX7/TX802/TX816 FM synthesizer, right in your browser.
                </p>
              </div>
            </header>

            <ul className="start-features">
              <li>Dexed core</li>
              <li>256-voice polyphony</li>
              <li>Loads TX802 / TX816 multi-timbral performances</li>
              <li>Drag &amp; drop .syx or MiniDexed .ini files</li>
              <li>Live interactive envelope editing</li>
              <li>100% free &amp; open source</li>
            </ul>

            <button type="button" className="start" onClick={handleStart}>
              LET'S PLAY!
            </button>

            <footer className="start-credits">
              <span>
                Wouter van Nifterick (woutervannifterick&nbsp;at&nbsp;gmail&nbsp;dot&nbsp;com)
              </span>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
