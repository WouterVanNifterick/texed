// Rack header: logo, part strip, voice name, program select, load/save,
// engine + parts buttons, polyphony, master knobs, panic and MIDI LED.

import { useRef } from 'react';
import dexedIcon from '../assets/dexed-icon.svg';
import type { DexedSynth } from '../audio/useDexedSynth';
import { getVoiceName, withVoiceName } from '../state/params';
import { Knob } from './ui';

interface TopBarProps {
  synth: DexedSynth;
  program: number;
  onSelectProgram: (index: number) => void;
  loadMsg: string | null;
  onLoadFiles: (files: File[]) => void;
  onSaveVoice: () => void;
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
  synth, program, onSelectProgram, loadMsg, onLoadFiles, onSaveVoice,
  engineName, onEngine, onShowParts, polyphony, onPolyphony,
  volume, onVolume, cutoff, reso, onFx, midiInputs,
}: TopBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
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
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = '';
          onLoadFiles(files);
        }}
      />
      <button type="button" className="bar-btn" onClick={onSaveVoice}>
        SAVE
      </button>
      <button type="button" className="bar-btn" onClick={onEngine} title="FM engine">
        {engineName}
      </button>
      <button type="button" className="bar-btn" onClick={onShowParts} title="Multi-timbral part rack">
        PARTS
      </button>

      <label className="poly-ctl" title="Polyphony (voices)">
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
  );
}
