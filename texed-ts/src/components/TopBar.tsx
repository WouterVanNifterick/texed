// Rack header: logo, part strip, voice name, program select, load/save,
// engine + parts buttons, polyphony, master knobs, panic and MIDI LED.

import { useRef } from 'react';
import dexedIcon from '../assets/dexed-icon.svg';
import type { DexedSynth } from '../audio/useDexedSynth';
import { getVoiceName, withVoiceName } from '../state/params';
import { helpProps } from '../state/help';
import { Knob } from './ui';

interface TopBarProps {
  synth: DexedSynth;
  program: number;
  onSelectProgram: (index: number) => void;
  loadMsg: string | null;
  onLoadFiles: (files: File[]) => void;
  onSaveVoice: () => void;
  onSaveBank: () => void;
  engineName: string;
  onEngine: () => void;
  onShowParts: () => void;
  polyphony: number;
  onPolyphony: (n: number) => void;
  volume: number;
  onVolume: (v: number) => void;
  cutoff: number;
  reso: number;
  onFx: (cutoff: number, reso: number) => void;
  midiInputs: string[];
}

export function TopBar({
  synth, program, onSelectProgram, loadMsg, onLoadFiles, onSaveVoice, onSaveBank,
  engineName, onEngine, onShowParts, polyphony, onPolyphony,
  volume, onVolume, cutoff, reso, onFx, midiInputs,
}: TopBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <div className="logo">
        <img src={dexedIcon} alt="" className="logo-icon" width={28} height={28} />
        TEXED
      </div>

      <div className="part-edit-group">
        <div
          className="part-strip"
          {...helpProps('PART SELECT', 'Chooses which of the 8 multi-timbral parts the editor below is editing.')}
        >
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
          {...helpProps('VOICE NAME', `Name of the voice (up to 10 characters), stored in the patch — editing part ${synth.selectedPart + 1}.`)}
        />
      </div>

      <select
        className="program-select"
        value={program}
        onChange={(e) => onSelectProgram(Number(e.target.value))}
        disabled={synth.programOptions.length === 0}
        {...helpProps('PROGRAM', 'Selects a voice for the current part from the loaded banks.')}
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

      <button
        type="button"
        className="bar-btn"
        onClick={() => fileRef.current?.click()}
        {...helpProps('LOAD', 'Loads .syx (VMEM banks, AMEM, single VCED voices, performances) or raw .Dx7Voice files — or drop them anywhere.')}
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
      <button
        type="button"
        className="bar-btn"
        onClick={onSaveVoice}
        {...helpProps('SAVE', 'Saves the current voice as a single-voice VCED .syx file.')}
      >
        SAVE
      </button>
      <button
        type="button"
        className="bar-btn"
        onClick={onSaveBank}
        {...helpProps('SAVE BANK', 'Saves the current 32-voice bank (VMEM + AMEM supplement) as a .syx file.')}
      >
        SAVE BANK
      </button>
      <button
        type="button"
        className="bar-btn"
        onClick={onEngine}
        {...helpProps('ENGINE', 'FM engine model — MODERN (24-bit float), MARK I (original DX7 fixed-point), or OPL series. Click to cycle.')}
      >
        {engineName}
      </button>
      <button
        type="button"
        className="bar-btn"
        onClick={onShowParts}
        {...helpProps('PARTS', 'Opens the multi-timbral part rack: 8 parts with their own voice, channel, volume, pan and note range.')}
      >
        PARTS
      </button>

      <label
        className="poly-ctl"
        {...helpProps('POLY', 'Maximum number of simultaneous voices before the oldest notes are stolen.')}
      >
        POLY
        <select value={polyphony} onChange={(e) => onPolyphony(Number(e.target.value))}>
          {[8, 16, 24, 32, 48, 64, 96, 128].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

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
          label="CUTOFF"
          value={cutoff}
          max={99}
          size={28}
          onChange={(c) => onFx(c, reso)}
          help="Low-pass filter cutoff (0–99) — a Dexed extension, not on the original DX7; 99 is fully open."
        />
        <Knob
          label="RESO"
          value={reso}
          max={99}
          size={28}
          onChange={(r) => onFx(cutoff, r)}
          help="Filter resonance (0–99) — emphasis at the cutoff frequency (Dexed extension)."
        />
      </div>

      <button
        type="button"
        className="bar-btn panic"
        onClick={synth.panic}
        {...helpProps('PANIC', 'All notes off — immediately silences every part.')}
      >
        PANIC
      </button>
      <span
        className={`midi-led${midiInputs.length > 0 ? ' on' : ''}`}
        {...helpProps('MIDI', midiInputs.length > 0 ? `Connected MIDI inputs: ${midiInputs.join(', ')}` : 'Lights up when a MIDI input device is connected.')}
      >
        MIDI
      </span>
    </header>
  );
}
