// Multi-timbral part rack (TX802 / TX816). Eight parts, each with an on/off,
// MIDI receive channel, program, volume, pan, note range and transpose. Clicking
// a part selects it as the target for the voice editor.

import { useEffect, useState } from 'react';
import type { PartConfig, ProgramOption } from '@texed/dx7-format/part-config';
import type { VoiceRef } from '@texed/dx7-format/voice-library';
import { programIndexForVoice } from '../audio/useSynth';
import type { SynthStatus } from '../audio/useSynth';
import { Knob } from './Knob';
import { NoteRange } from './NoteRange';
import { PartSlider } from './PartSlider';

interface PartRackProps {
  configs: PartConfig[];
  /** Voice name in each part's edit buffer (live voice, not the library slot). */
  voiceNames: string[];
  selectedPart: number;
  programOptions: ProgramOption[];
  onSelect: (index: number) => void;
  onSetPart: (index: number, config: Partial<PartConfig>) => void;
  onSetVoiceRef: (ref: VoiceRef, partIndex?: number) => void;
  subscribeStatus: (cb: (s: SynthStatus) => void) => () => void;
  onClose: () => void;
}

export function PartRack({
  configs,
  voiceNames,
  selectedPart,
  programOptions,
  onSelect,
  onSetPart,
  onSetVoiceRef,
  subscribeStatus,
  onClose,
}: PartRackProps) {
  const [activity, setActivity] = useState<number[]>([]);

  useEffect(() => subscribeStatus((s) => setActivity(s.partActivity ?? [])), [subscribeStatus]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="partrack-overlay partrack-overlay--region">
      <button
        type="button"
        className="overlay-dismiss"
        aria-label="Close part rack"
        onClick={onClose}
      />
      <div className="partrack" role="dialog" aria-modal="true" aria-label="Part rack">
        <div className="partrack-header">
          <span className="partrack-title">PART RACK</span>
          <button type="button" className="partrack-btn" onClick={onClose}>
            CLOSE
          </button>
        </div>

        <table>
          <thead>
            <tr>
              {[
                '#',
                'Link',
                'On',
                'Ch',
                'Program',
                'Vol',
                'Pan',
                'Range',
                'Shift',
                'Detune',
                'Damp',
                'Act',
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {configs.map((cfg, i) => {
              const selected = i === selectedPart;
              const progIdx = programIndexForVoice(programOptions, cfg.voice);
              // Show the live edit-buffer name; fall back to the resolved library
              // label only if the buffer name has not arrived yet.
              const originLabel = cfg.voiceLabel ?? programOptions[progIdx]?.label ?? 'INIT VOICE';
              const editName = voiceNames[i]?.trim() || originLabel;
              const isSlave = i > 0 && cfg.link;
              let masterIdx = i;
              while (masterIdx > 0 && configs[masterIdx].link) masterIdx--;
              const masterEnabled = configs[masterIdx].enabled;
              return (
                <tr
                  key={i}
                  onClick={() => onSelect(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(i);
                    }
                  }}
                  tabIndex={0}
                  aria-selected={selected}
                  className={`${selected ? 'selected' : ''}${(isSlave ? masterEnabled : cfg.enabled) ? '' : ' off'}${isSlave ? ' linked' : ''}`}
                >
                  <td className="part-num">{i + 1}</td>
                  <td>
                    {i > 0 && (
                      <input
                        type="checkbox"
                        checked={cfg.link}
                        title="Link to the instrument above (combine polyphony)"
                        onChange={(e) => onSetPart(i, { link: e.target.checked })}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </td>
                  {isSlave ? (
                    <>
                      <td>
                        <input
                          type="checkbox"
                          checked={masterEnabled}
                          disabled
                          aria-label={`Part ${i + 1} on (follows part ${masterIdx + 1})`}
                        />
                      </td>
                      <td colSpan={8} className="part-linked">
                        ← linked to part {masterIdx + 1}
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <input
                          type="checkbox"
                          checked={cfg.enabled}
                          aria-label={`Part ${i + 1} on`}
                          onChange={(e) => onSetPart(i, { enabled: e.target.checked })}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td>
                        <select
                          value={cfg.rxChannel}
                          aria-label={`Part ${i + 1} MIDI receive channel`}
                          onChange={(e) => onSetPart(i, { rxChannel: Number(e.target.value) })}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value={0}>OMNI</option>
                          {Array.from({ length: 16 }, (_, ch) => (
                            <option key={ch} value={ch + 1}>
                              {ch + 1}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="prog"
                          // The edit-buffer name is the current value; the bank
                          // list is a picker for loading a different voice.
                          value="current"
                          title={
                            progIdx >= 0
                              ? `Loaded from ${originLabel}`
                              : 'Not stored in a loaded bank'
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'current') return;
                            const opt = programOptions[Number(val)];
                            if (opt) onSetVoiceRef(opt.ref, i);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          disabled={programOptions.length === 0}
                        >
                          <option value="current">{editName}</option>
                          {programOptions.map((opt, p) => (
                            <option key={p} value={p}>
                              {opt.label}
                            </option>
                          ))}
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
                        {/* Wrapper stops the row's select-on-click from firing while
                            dragging the knob; the knob itself is the focusable control. */}
                        <div
                          role="presentation"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <Knob
                            value={cfg.noteShift}
                            min={-24}
                            max={24}
                            center={0}
                            size={28}
                            layout="inline"
                            label={`Part ${i + 1} transpose`}
                            format={(s) => (s > 0 ? `+${s}` : `${s}`)}
                            onChange={(noteShift) => onSetPart(i, { noteShift })}
                          />
                        </div>
                      </td>
                      <td>
                        <div
                          role="presentation"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <Knob
                            value={cfg.detune}
                            min={-7}
                            max={7}
                            center={0}
                            size={28}
                            layout="inline"
                            label={`Part ${i + 1} detune`}
                            format={(d) => (d > 0 ? `+${d}` : `${d}`)}
                            onChange={(detune) => onSetPart(i, { detune })}
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={cfg.forcedDamp}
                          title="EG Forced Damp"
                          aria-label={`Part ${i + 1} EG forced damp`}
                          onChange={(e) => onSetPart(i, { forcedDamp: e.target.checked })}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    </>
                  )}
                  {/* Decorative: the LED tracks sounding voices at ~31Hz, so announcing
                      it would flood a screen reader with no useful information. */}
                  <td className="td-act" aria-hidden>
                    <span className={`part-led${(activity[i] ?? 0) > 0 ? ' on' : ''}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="partrack-note">
          Click a row to edit that part's voice in the main editor. Drop or LOAD .syx or .Dx7Voice
          files (e.g. TX802 factory A1–B2 + P, or FS1R voice banks) to import banks, AMEM
          supplements, performances, and system setup.
        </p>
      </div>
    </div>
  );
}
