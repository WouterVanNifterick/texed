// Multi-timbral part rack (TX802 / TX816). Eight parts, each with an on/off,
// MIDI receive channel, program, volume, pan, note range and transpose. Clicking
// a part selects it as the target for the voice editor.

import { useEffect, useState } from 'react';
import type { PartConfig, ProgramOption } from '../engine/synth-rack';
import type { VoiceRef } from '../engine/voice-library';
import { programIndexForVoice } from '../audio/useDexedSynth';
import type { SynthStatus } from '../audio/useDexedSynth';
import { Knob, NoteRange, PartSlider } from './ui';

interface PartRackProps {
  configs: PartConfig[];
  selectedPart: number;
  programOptions: ProgramOption[];
  performanceNames: string[];
  performanceIndex: number;
  onSelectPerformance: (index: number) => void;
  masterTuneCents: number;
  onMasterTune: (cents: number) => void;
  onSelect: (index: number) => void;
  onSetPart: (index: number, config: Partial<PartConfig>) => void;
  onSetVoiceRef: (ref: VoiceRef, partIndex?: number) => void;
  subscribeStatus: (cb: (s: SynthStatus) => void) => () => void;
  onClose: () => void;
}

export function PartRack({
  configs, selectedPart, programOptions, performanceNames, performanceIndex,
  onSelectPerformance, masterTuneCents, onMasterTune,
  onSelect, onSetPart, onSetVoiceRef, subscribeStatus, onClose,
}: PartRackProps) {
  const [activity, setActivity] = useState<number[]>([]);

  useEffect(() => subscribeStatus((s) => setActivity(s.partActivity ?? [])), [subscribeStatus]);

  return (
    <div className="partrack-overlay" onClick={onClose}>
      <div className="partrack" onClick={(e) => e.stopPropagation()}>
        <div className="partrack-header">
          <span className="partrack-title">PART RACK · TX802 / TX816</span>
          {performanceNames.length > 0 && (
            <label>
              Performance&nbsp;
              <select
                value={performanceIndex}
                onChange={(e) => onSelectPerformance(Number(e.target.value))}
              >
                {performanceNames.map((name, i) => (
                  <option key={i} value={i}>
                    {String(i + 1).padStart(2, '0')} {name || 'INIT'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="partrack-tune" title="Master tune (cents), from 8973S system setup">
            Tune&nbsp;
            <Knob
              value={Math.round(masterTuneCents)}
              min={-50}
              max={50}
              size={24}
              layout="inline"
              label=""
              format={(t) => (t > 0 ? `+${t}¢` : `${t}¢`)}
              onChange={onMasterTune}
            />
          </label>
          <button type="button" className="partrack-btn" onClick={onClose}>CLOSE</button>
        </div>

        <table>
          <thead>
            <tr>
              {['#', 'On', 'Ch', 'Program', 'Vol', 'Pan', 'Range', 'Shift', 'Detune', 'Act'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {configs.map((cfg, i) => {
              const selected = i === selectedPart;
              const progIdx = programIndexForVoice(programOptions, cfg.voice);
              const voiceLabel = cfg.voiceLabel ?? programOptions[progIdx]?.label ?? 'INIT VOICE';
              const selectValue = progIdx >= 0 ? progIdx : 'unresolved';
              return (
                <tr
                  key={i}
                  onClick={() => onSelect(i)}
                  className={`${selected ? 'selected' : ''}${cfg.enabled ? '' : ' off'}`}
                >
                  <td className="part-num">{i + 1}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={cfg.enabled}
                      onChange={(e) => onSetPart(i, { enabled: e.target.checked })}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td>
                    <select
                      value={cfg.rxChannel}
                      onChange={(e) => onSetPart(i, { rxChannel: Number(e.target.value) })}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value={0}>OMNI</option>
                      {Array.from({ length: 16 }, (_, ch) => <option key={ch} value={ch + 1}>{ch + 1}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      className="prog"
                      value={selectValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'unresolved') return;
                        const opt = programOptions[Number(val)];
                        if (opt) onSetVoiceRef(opt.ref, i);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      disabled={programOptions.length === 0}
                    >
                      {programOptions.length === 0
                        ? <option value="unresolved">{voiceLabel}</option>
                        : (
                          <>
                            {progIdx < 0 && (
                              <option value="unresolved">{voiceLabel}</option>
                            )}
                            {programOptions.map((opt, p) => (
                              <option key={p} value={p}>{opt.label}</option>
                            ))}
                          </>
                        )}
                    </select>
                  </td>
                  <td className="td-slider">
                    <PartSlider
                      label={`Part ${i + 1} volume`}
                      min={0}
                      max={100}
                      value={Math.round(cfg.volume * 100)}
                      onChange={(volume) => onSetPart(i, { volume: volume / 100 })}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="td-slider">
                    <PartSlider
                      label={`Part ${i + 1} pan`}
                      center
                      min={-100}
                      max={100}
                      value={Math.round(cfg.pan * 100)}
                      onChange={(pan) => onSetPart(i, { pan: pan / 100 })}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="td-range">
                    <NoteRange
                      low={cfg.noteLow}
                      high={cfg.noteHigh}
                      label={`Part ${i + 1} note range`}
                      onChange={(noteLow, noteHigh) => onSetPart(i, { noteLow, noteHigh })}
                    />
                  </td>
                  <td>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <Knob
                        value={cfg.noteShift}
                        min={-24}
                        max={24}
                        size={28}
                        layout="inline"
                        label=""
                        format={(s) => (s > 0 ? `+${s}` : `${s}`)}
                        onChange={(noteShift) => onSetPart(i, { noteShift })}
                      />
                    </div>
                  </td>
                  <td>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <Knob
                        value={cfg.detune}
                        min={-7}
                        max={7}
                        size={28}
                        layout="inline"
                        label=""
                        format={(d) => (d > 0 ? `+${d}` : `${d}`)}
                        onChange={(detune) => onSetPart(i, { detune })}
                      />
                    </div>
                  </td>
                  <td className="td-act">
                    <span className={`part-led${(activity[i] ?? 0) > 0 ? ' on' : ''}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="partrack-note">
          Click a row to edit that part's voice in the main editor. Drop or LOAD .syx
          or .Dx7Voice files (e.g. TX802 factory A1–B2 + P, or FS1R voice banks) to import banks, AMEM supplements,
          performances, and system setup.
        </p>
      </div>
    </div>
  );
}
