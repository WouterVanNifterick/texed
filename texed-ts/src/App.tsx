import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import dexedIcon from './assets/dexed-icon.svg';
import { useSynth } from './audio/useSynth';
import type { MidiConnection } from './audio/midi';
import { useMidiIo } from './audio/useMidiIo';
import { hardwarePort } from './audio/midi-out';
import { NativeBridgePort, hasNativeBridge } from './audio/native-bridge-port';
import { getVoiceName, withVoiceName } from '@texed/dx7-format/voice';
import {
  useClipboardKeys,
  useFileDrop,
  usePersistentFlag,
  usePersistentState,
  usePersistentNumber,
  useQwertyKeyboard,
  useSelectKeys,
  useStageScale,
  useTransientMessage,
  useUndoKeys,
} from './hooks';
import { useHistory } from './state/useHistory';
import { useOpClipboard } from './state/useOpClipboard';
import { useSession } from './state/useSession';
import { usePatchFiles } from './state/usePatchFiles';
import { Keyboard } from './components/Keyboard';
import { HelpBar } from './components/HelpBar';
import { OperatorPanel } from './components/OperatorPanel';
import { GlobalPanel } from './components/GlobalPanel';
import { EnvOverlay } from './envelope/EnvOverlay';
import { useEnvTimeScale, type TimeMode } from './envelope/env-time';
import { type EnvSelection, type YMode } from './envelope/env-draw';
import { Segmented } from './ui/Segmented';
import { RefKeyControl } from './components/RefKeyControl';
import { PartRack } from './components/PartRack';
import { LibraryBrowser } from './components/LibraryBrowser';
import { TopBar } from './components/TopBar';
import { StoreVoiceDialog } from './components/StoreVoiceDialog';
import { RedoIcon, StoreIcon, UndoIcon } from './ui/icons';
import { helpProps } from './state/help';
import { useEnvAxisFrozen, useEnvView } from './state/env-axis';
import type { VoiceRef } from '@texed/dx7-format/voice-library';

const ENGINES = ['MODERN', 'MARK I', 'OPL'];

// ?hw - hardware editor mode: the UI drives a real DX7/DX7II/TX802 over MIDI
// SysEx instead of the local engine (pick the output in MIDI settings).
const HW_MODE = new URLSearchParams(window.location.search).has('hw');

function formatLoadReport(applied: string[], skipped: string[]): string {
  const perf = applied.find((a) => a.startsWith('performances'));
  const banks = applied.filter((a) => a.startsWith('VMEM →'));
  const amem = applied.filter((a) => a.startsWith('AMEM →'));
  const parts: string[] = [];
  if (perf) parts.push(perf);
  if (banks.length) parts.push(`${banks.length} VMEM bank${banks.length > 1 ? 's' : ''}`);
  if (amem.length) parts.push(`${amem.length} AMEM pair${amem.length > 1 ? 's' : ''}`);
  parts.push(
    ...applied.filter(
      (a) => !a.startsWith('performances') && !a.startsWith('VMEM →') && !a.startsWith('AMEM'),
    ),
  );
  if (skipped.length) parts.push(`skipped: ${skipped.join(', ')}`);
  return parts.join(' · ');
}

export default function App() {
  // Detect the JUCE bridge when the component mounts, not at module load time.
  // Document-created scripts run before module scripts, but checking here avoids
  // a stale false if the import graph ever changes.
  const nativePortRef = useRef<NativeBridgePort | null>(null);
  if (nativePortRef.current === null && hasNativeBridge()) {
    nativePortRef.current = new NativeBridgePort();
  }
  const nativeMode = nativePortRef.current !== null;

  const synth = useSynth(HW_MODE ? hardwarePort : (nativePortRef.current ?? undefined));
  const [started, setStarted] = useState(false);
  /** Startup finished, including any session restore. */
  const [loaded, setLoaded] = useState(false);
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
  const [refFollow, setRefFollow] = usePersistentFlag('envRefFollow', false);
  const [showParts, setShowParts] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const midiRef = useRef<MidiConnection | null>(null);
  const [loadMsg, showLoadMsg] = useTransientMessage();

  // Floor chosen so the smallest controls (4px envelope labels at 0.27) stay
  // readable; below it the stage pans instead of shrinking further.
  const stageClamped = useStageScale(1440, 1020, 0.62);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const axisFrozen = useEnvAxisFrozen();
  const axisView = useEnvView();
  const timeScale = useEnvTimeScale(
    synth.voice,
    timeMode,
    refNote,
    refVelocity,
    axisFrozen,
    axisView,
  );
  const combined = envView === 'combined';
  const stack = opLayout === 'stack';

  // FOLLOW capture reads the toggle through a ref so the note-on callback stays
  // stable (MIDI is wired once at start and must not be re-registered).
  const refFollowRef = useRef(false);
  useEffect(() => {
    refFollowRef.current = refFollow;
  }, [refFollow]);

  useEffect(() => {
    if (!synth.loadReport) return;
    showLoadMsg(formatLoadReport(synth.loadReport.applied, synth.loadReport.skipped));
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

  const midi = useMidiIo({ synth, noteOn, noteOff, hardwareMode: HW_MODE });
  const session = useSession(synth, started && !nativeMode);
  const files = usePatchFiles(synth, showLoadMsg);
  // Armed only once the session has been restored, so its baseline is the patch
  // the user actually sees. Arming at `started` would make the restore itself the
  // first undo step, and Ctrl+Z would throw the restored session away.
  const history = useHistory(synth, loaded);

  const handleStart = useCallback(async () => {
    await synth.start();
    setStarted(true);
    // In the plugin the host owns both the session (it saves plugin state) and
    // the MIDI input, so neither belongs to the UI.
    if (!nativeMode) {
      if (await session.restore()) showLoadMsg('Session restored');
      midiRef.current = await midi.connect();
    }
    setLoaded(true);
  }, [synth, session, midi, showLoadMsg, nativeMode]);

  // There is no AudioContext to unlock inside the plugin, so skip the gesture.
  useEffect(() => {
    if (nativeMode) void handleStart();
    // Only ever on mount: handleStart is idempotent but re-running it would
    // re-request the initial snapshot for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clipboard = useOpClipboard(synth, showLoadMsg);
  const copySelected = useCallback(() => clipboard.copy(selectedOp), [clipboard, selectedOp]);
  const pasteSelected = useCallback(
    (envOnly: boolean) => clipboard.paste(selectedOp, envOnly ? 'env' : 'all'),
    [clipboard, selectedOp],
  );

  const showOctave = useCallback(
    (label: string) => showLoadMsg(`Keyboard starts at ${label}`),
    [showLoadMsg],
  );

  useQwertyKeyboard(started, noteOn, noteOff, showOctave);
  useSelectKeys(started, synth.selectPart, setSelectedOp);
  useUndoKeys(loaded, history.undo, history.redo);
  useClipboardKeys(loaded, copySelected, pasteSelected);

  useEffect(() => {
    return () => midiRef.current?.close();
  }, []);

  const onSelectProgram = useCallback(
    (idx: number) => {
      synth.setProgram(idx);
      setActiveNotes(new Set());
    },
    [synth],
  );

  const onDrop = useCallback(
    async (dropped: File[]) => {
      if (!dropped.length) {
        showLoadMsg('No .syx, .ini, or .Dx7Voice files in drop');
        return;
      }
      if (!started) await handleStart();
      await files.loadFiles(dropped);
    },
    [started, handleStart, files, showLoadMsg],
  );

  const dragging = useFileDrop(onDrop);

  const selectedVoice = synth.partConfigs[synth.selectedPart]?.voice;
  // Name shown in the editor is the live edit-buffer name (which may have been
  // edited away from the bank slot it was loaded from), not the library label.
  const editBufferName = getVoiceName(synth.voice).trim() || 'INIT VOICE';

  const onStoreConfirm = useCallback(
    (name: string, dest: VoiceRef, destLabel: string) => {
      synth.setVoice(withVoiceName(synth.voice, name));
      synth.storeVoice(dest);
      setShowStore(false);
      showLoadMsg(`Stored voice into ${destLabel}`);
    },
    [synth, showLoadMsg],
  );

  return (
    <div className="app-root" onContextMenu={(e) => e.preventDefault()}>
      <div className="rack">
        <TopBar
          synth={synth}
          loadMsg={loadMsg}
          onLoadFiles={files.loadFiles}
          onSaveVoice={files.saveVoice}
          onSaveBank={files.saveBank}
          onSavePerformance={files.savePerformance}
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
          midiInputs={midi.inputs}
          midiOutputs={midi.outputs}
          midiOutId={midi.outId}
          onMidiOut={midi.setOutId}
          midiLive={midi.live}
          onMidiLive={midi.setLive}
          autoSend={midi.autoSend}
          onAutoSend={midi.setAutoSend}
          onSendVoice={midi.sendVoice}
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
            <button
              type="button"
              className="bar-btn bar-btn-icon"
              onClick={history.undo}
              disabled={!history.canUndo}
              aria-label="Undo"
              {...helpProps('UNDO', 'Step back through patch edits (Ctrl+Z).')}
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              className="bar-btn bar-btn-icon"
              onClick={history.redo}
              disabled={!history.canRedo}
              aria-label="Redo"
              {...helpProps('REDO', 'Step forward again (Ctrl+Shift+Z).')}
            >
              <RedoIcon />
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
              follow={refFollow}
              onNote={setRefNote}
              onVelocity={setRefVelocity}
              onToggleFollow={setRefFollow}
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
              clipboard={clipboard}
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
              clipboard={clipboard}
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
            clipboard={clipboard}
          />

          {showLibrary && (
            <LibraryBrowser
              synth={synth}
              showMsg={showLoadMsg}
              onClose={() => setShowLibrary(false)}
            />
          )}

          {showParts && (
            <PartRack
              configs={synth.partConfigs}
              voiceNames={synth.partVoiceNames}
              selectedPart={synth.selectedPart}
              programOptions={synth.programOptions}
              settings={synth.settings}
              onSelect={synth.selectPart}
              onSetPart={synth.setPart}
              onGesture={synth.paramGesture}
              onSetVoiceRef={synth.setVoiceRef}
              onSetGlobal={synth.setGlobal}
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

      {dragging && (
        <div className="drop-overlay" aria-hidden>
          Drop .syx, .ini, or .Dx7Voice files to load
        </div>
      )}

      {stageClamped && !noticeDismissed && (
        <div className="small-screen-notice" role="status">
          <span>This editor is built for a larger screen. Scroll to reach the rest of it.</span>
          <button type="button" onClick={() => setNoticeDismissed(true)}>
            Got it
          </button>
        </div>
      )}

      {!started && !nativeMode && (
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
