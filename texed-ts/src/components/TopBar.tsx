// Rack header: logo, part strip + parts button, voice I/O (perf/library/load/save),
// master knobs + panic, MIDI status/send, and a settings popover (engine, poly,
// MIDI out, live SysEx).

import { useEffect, useRef, useState, type RefObject } from 'react';
import dexedIcon from '../assets/dexed-icon.svg';
import { useStatus, type DexedSynth } from '../audio/useDexedSynth';
import { helpProps } from '../state/help';
import { Knob, Toggle } from './ui';
import { DownloadIcon, GearIcon } from './icons';

interface TopBarProps {
  synth: DexedSynth;
  loadMsg: string | null;
  onLoadFiles: (files: File[]) => void;
  onSaveVoice: () => void;
  onSaveBank: () => void;
  engine: number;
  engineNames: string[];
  onEngine: (n: number) => void;
  onShowParts: () => void;
  onShowLibrary: () => void;
  polyphony: number;
  onPolyphony: (n: number) => void;
  volume: number;
  onVolume: (v: number) => void;
  masterTuneCents: number;
  onMasterTune: (cents: number) => void;
  midiInputs: string[];
  midiOutputs: { id: string; name: string }[];
  midiOutId: string;
  onMidiOut: (id: string) => void;
  midiLive: boolean;
  onMidiLive: (on: boolean) => void;
  onSendVoice: () => void;
}

// Close a popover on outside click or Escape while it is open.
function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, ref]);
}

export function TopBar({
  synth,
  loadMsg,
  onLoadFiles,
  onSaveVoice,
  onSaveBank,
  engine,
  engineNames,
  onEngine,
  onShowParts,
  onShowLibrary,
  polyphony,
  onPolyphony,
  volume,
  onVolume,
  masterTuneCents,
  onMasterTune,
  midiInputs,
  midiOutputs,
  midiOutId,
  onMidiOut,
  midiLive,
  onMidiLive,
  onSendVoice,
}: TopBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dlRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [dlOpen, setDlOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const partActivity = useStatus(synth.subscribeStatus, (s) => s.partActivity, []);

  useDismiss(dlOpen, () => setDlOpen(false), dlRef);
  useDismiss(settingsOpen, () => setSettingsOpen(false), settingsRef);

  return (
    <header className="topbar">
      <div className="logo bar-group">
        <img src={dexedIcon} alt="" className="logo-icon" width={28} height={28} />
        TEXED
      </div>

      <div className="bar-group">
        <div
          className="part-strip"
          {...helpProps(
            'PART SELECT',
            'Chooses which of the 8 multi-timbral parts the editor below is editing. Keys 1–8 also select parts.',
          )}
        >
          {Array.from({ length: 8 }, (_, i) => {
            const cfg = synth.partConfigs[i];
            const selected = i === synth.selectedPart;
            const active = (partActivity[i] ?? 0) > 0;
            return (
              <button
                key={i}
                type="button"
                className={`part-btn${selected ? ' selected' : ''}${cfg && !cfg.enabled ? ' off' : ''}${active ? ' active' : ''}`}
                onClick={() => synth.selectPart(i)}
                title={`Part ${i + 1}${cfg && !cfg.enabled ? ' (disabled)' : ''}${active ? ' - sounding' : ''}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="bar-btn"
          onClick={onShowParts}
          {...helpProps(
            'PARTS',
            'Opens the multi-timbral part rack: 8 parts with their own voice, channel, volume, pan and note range.',
          )}
        >
          PARTS
        </button>
      </div>

      <span className="bar-divider" aria-hidden />

      <div className="bar-group">
        {synth.performanceNames.length > 0 && (
          <label
            className="perf-ctl"
            {...helpProps(
              'PERFORMANCE',
              'Select a multi-timbral performance - loads all 8 parts with their voices and settings.',
            )}
          >
            PERF
            <select
              value={synth.performanceIndex}
              onChange={(e) => synth.selectPerformance(Number(e.target.value))}
            >
              {synth.performanceNames.map((perfName, i) => (
                <option key={i} value={i}>
                  {String(i + 1).padStart(2, '0')} {perfName || 'INIT'}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className="bar-btn"
          onClick={onShowLibrary}
          {...helpProps(
            'LIBRARY',
            'Browse the built-in voice and performance library (FS1R, TX802, DX7II factory sets and more) plus everything you have loaded.',
          )}
        >
          LIBRARY
        </button>

        <button
          type="button"
          className="bar-btn"
          onClick={() => fileRef.current?.click()}
          {...helpProps(
            'LOAD',
            'Loads .syx (VMEM banks, AMEM, single VCED voices, performances) or raw .Dx7Voice files - or drop them anywhere.',
          )}
        >
          LOAD
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".syx,.Dx7Voice"
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            onLoadFiles(files);
          }}
        />

        <div className="dl-menu-wrap" ref={dlRef}>
          <button
            type="button"
            className={`bar-btn bar-btn-icon${dlOpen ? ' active' : ''}`}
            onClick={() => setDlOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={dlOpen}
            aria-label="Save"
            {...helpProps(
              'SAVE',
              'Save the current voice (ACED + VCED) or the whole 32-voice bank (VMEM + AMEM) as a .syx file.',
            )}
          >
            <DownloadIcon />
          </button>
          {dlOpen && (
            <div className="dl-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDlOpen(false);
                  onSaveVoice();
                }}
              >
                Save voice
                <span className="dl-menu-sub">single voice · ACED + VCED</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDlOpen(false);
                  onSaveBank();
                }}
              >
                Save bank
                <span className="dl-menu-sub">32 voices · VMEM + AMEM</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {loadMsg && (
        <span className="load-msg" title={loadMsg}>
          {loadMsg}
        </span>
      )}

      <div className="bar-group bar-group-right">
        <div className="bar-knobs">
          <Knob
            label="VOLUME"
            value={volume}
            max={99}
            size={28}
            onChange={onVolume}
            help="Master output volume (0–99), with a perceptual taper."
          />
          <Knob
            label="TUNE"
            value={Math.round(masterTuneCents)}
            min={-50}
            max={50}
            center={0}
            size={28}
            format={(t) => (t > 0 ? `+${t}¢` : `${t}¢`)}
            onChange={onMasterTune}
            help="Master tune (−50…+50 cents) - global pitch offset from 8973S system setup."
          />
        </div>

        <button
          type="button"
          className="bar-btn panic"
          onClick={synth.panic}
          {...helpProps('PANIC', 'All notes off - immediately silences every part.')}
        >
          PANIC
        </button>
      </div>

      <span className="bar-divider" aria-hidden />

      <div className="bar-group">
        <span
          className={`midi-led${midiInputs.length > 0 ? ' on' : ''}`}
          {...helpProps(
            'MIDI',
            midiInputs.length > 0
              ? `Connected MIDI inputs: ${midiInputs.join(', ')}`
              : 'Lights up when a MIDI input device is connected.',
          )}
        >
          MIDI
        </span>

        <button
          type="button"
          className="bar-btn"
          disabled={!midiOutId}
          onClick={onSendVoice}
          {...helpProps(
            'SEND',
            'Transmit the current voice (ACED + VCED) to the selected MIDI output.',
          )}
        >
          SEND
        </button>

        <div className="dl-menu-wrap" ref={settingsRef}>
          <button
            type="button"
            className={`bar-btn bar-btn-icon${settingsOpen ? ' active' : ''}`}
            onClick={() => setSettingsOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={settingsOpen}
            aria-label="Settings"
            {...helpProps('SETTINGS', 'Engine, polyphony, MIDI output and live-SysEx options.')}
          >
            <GearIcon />
          </button>
          {settingsOpen && (
            <div className="settings-menu" role="menu">
              <div className="settings-title">SETTINGS</div>
              <label
                className="settings-row"
                {...helpProps(
                  'ENGINE',
                  'FM engine model - MODERN (24-bit float), MARK I (original DX7 fixed-point), or OPL series.',
                )}
              >
                <span className="settings-row-label">Engine</span>
                <select value={engine} onChange={(e) => onEngine(Number(e.target.value))}>
                  {engineNames.map((name, i) => (
                    <option key={i} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label
                className="settings-row"
                {...helpProps(
                  'POLY',
                  'Maximum number of simultaneous voices before the oldest notes are stolen.',
                )}
              >
                <span className="settings-row-label">Polyphony</span>
                <select value={polyphony} onChange={(e) => onPolyphony(Number(e.target.value))}>
                  {[8, 16, 24, 32, 48, 64, 96, 128].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <label
                className="settings-row"
                {...helpProps(
                  'MIDI OUT',
                  'Device for voice send, incoming-MIDI forwarding, and live parameter SysEx.',
                )}
              >
                <span className="settings-row-label">MIDI out</span>
                <select value={midiOutId} onChange={(e) => onMidiOut(e.target.value)}>
                  <option value="">None</option>
                  {midiOutputs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="settings-row">
                <span className="settings-row-label">Live SysEx</span>
                <Toggle
                  label="SYSEX"
                  on={midiLive}
                  onChange={onMidiLive}
                  help="Stream VCED/ACED parameter changes to the MIDI output as you edit."
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
