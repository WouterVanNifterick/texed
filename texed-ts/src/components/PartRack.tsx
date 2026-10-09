// Multi-timbral part rack (TX802 / TX816). Eight parts, each with an on/off,
// MIDI receive channel, program, volume, pan, note range, transpose, filter and
// reverb send, over a global reverb and compressor. Clicking a part selects it
// as the target for the voice editor.

import type { ReactNode, SyntheticEvent } from 'react';
import type { PartConfig, ProgramOption } from '@texed/dx7-format/part-config';
import type { GlobalSettings, ReverbSettings } from '@texed/dx7-format/global-settings';
import type { VoiceRef } from '@texed/dx7-format/voice-library';
import { programIndexForVoice, useStatus } from '../audio/useSynth';
import type { StatusSubscribe } from '../audio/synth-types';
import { useEscapeClose } from '../hooks';
import { Knob } from '../ui/Knob';
import { NoteRange } from '../ui/NoteRange';
import { PartSlider } from '../ui/PartSlider';

interface PartRackProps {
  configs: PartConfig[];
  /** Voice name in each part's edit buffer (live voice, not the library slot). */
  voiceNames: string[];
  selectedPart: number;
  programOptions: ProgramOption[];
  settings: GlobalSettings;
  onSelect: (index: number) => void;
  onSetPart: (index: number, config: Partial<PartConfig>) => void;
  onGesture: (index: number, field: keyof PartConfig, begin: boolean) => void;
  onSetVoiceRef: (ref: VoiceRef, partIndex?: number) => void;
  onSetGlobal: (settings: Partial<GlobalSettings>) => void;
  subscribeStatus: StatusSubscribe;
  onClose: () => void;
}

/** These controls are 0..99 on MiniDexed hardware; the engine wants 0..1. */
const toKnob = (v: number) => Math.round(v * 99);
const fromKnob = (v: number) => v / 99;

const REVERB_KNOBS: { key: keyof Omit<ReverbSettings, 'enabled'>; label: string; help: string }[] =
  [
    { key: 'size', label: 'Size', help: 'Reverb time' },
    { key: 'hiDamp', label: 'Hi Damp', help: 'High frequency loss in the tail' },
    { key: 'loDamp', label: 'Lo Damp', help: 'Low frequency loss in the tail' },
    { key: 'lowpass', label: 'Lowpass', help: 'Darkens the reverb output' },
    { key: 'diffusion', label: 'Diffuse', help: 'Lower settings make the tail echoey' },
    { key: 'level', label: 'Level', help: 'Wet return level' },
  ];

const formatSigned = (v: number) => (v > 0 ? `+${v}` : `${v}`);

/** Keeps a click on a row's control from also selecting the row. */
const stopPropagation = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Table cell for a knob. The wrapper stops the row's select-on-click from
 * firing while dragging the knob; the knob itself is the focusable control.
 */
function KnobCell({ children }: { children: ReactNode }) {
  return (
    <td>
      <div role="presentation" onClick={stopPropagation} onPointerDown={stopPropagation}>
        {children}
      </div>
    </td>
  );
}

export function PartRack({
  configs,
  voiceNames,
  selectedPart,
  programOptions,
  settings,
  onSelect,
  onSetPart,
  onGesture,
  onSetVoiceRef,
  onSetGlobal,
  subscribeStatus,
  onClose,
}: PartRackProps) {
  const activity = useStatus(subscribeStatus, (s) => s.partActivity, []);
  useEscapeClose(onClose);

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
                'Cutoff',
                'Reso',
                'Send',
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
                        onClick={stopPropagation}
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
                      <td colSpan={11} className="part-linked">
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
                          onClick={stopPropagation}
                        />
                      </td>
                      <td>
                        <select
                          value={cfg.rxChannel}
                          aria-label={`Part ${i + 1} MIDI receive channel`}
                          onChange={(e) => onSetPart(i, { rxChannel: Number(e.target.value) })}
                          onClick={stopPropagation}
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
                          onClick={stopPropagation}
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
                          onGesture={(begin) => onGesture(i, 'volume', begin)}
                          onClick={stopPropagation}
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
                          onGesture={(begin) => onGesture(i, 'pan', begin)}
                          onClick={stopPropagation}
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
                      <KnobCell>
                        <Knob
                          label=""
                          helpLabel={`Part ${i + 1} transpose`}
                          value={cfg.noteShift}
                          min={-24}
                          max={24}
                          center={0}
                          size={28}
                          layout="inline"
                          help={`Part ${i + 1} transpose`}
                          format={formatSigned}
                          onChange={(noteShift) => onSetPart(i, { noteShift })}
                        />
                      </KnobCell>
                      <KnobCell>
                        <Knob
                          label=""
                          helpLabel={`Part ${i + 1} detune`}
                          value={cfg.detune}
                          min={-7}
                          max={7}
                          center={0}
                          size={28}
                          layout="inline"
                          help={`Part ${i + 1} detune`}
                          format={formatSigned}
                          onChange={(detune) => onSetPart(i, { detune })}
                          onGesture={(begin) => onGesture(i, 'detune', begin)}
                        />
                      </KnobCell>
                      {(
                        [
                          ['cutoff', 'filter cutoff'],
                          ['resonance', 'filter resonance'],
                          ['reverbSend', 'reverb send'],
                        ] as const
                      ).map(([field, what]) => (
                        <KnobCell key={field}>
                          <Knob
                            label=""
                            helpLabel={`Part ${i + 1} ${what}`}
                            value={toKnob(cfg[field])}
                            max={99}
                            size={28}
                            layout="inline"
                            help={`Part ${i + 1} ${what}`}
                            onChange={(v) => onSetPart(i, { [field]: fromKnob(v) })}
                            onGesture={(begin) => onGesture(i, field, begin)}
                          />
                        </KnobCell>
                      ))}
                      <td>
                        <input
                          type="checkbox"
                          checked={cfg.forcedDamp}
                          title="EG Forced Damp"
                          aria-label={`Part ${i + 1} EG forced damp`}
                          onChange={(e) => onSetPart(i, { forcedDamp: e.target.checked })}
                          onClick={stopPropagation}
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

        <div className="partrack-global">
          <label className="partrack-toggle">
            <input
              type="checkbox"
              checked={settings.compressor}
              onChange={(e) => onSetGlobal({ compressor: e.target.checked })}
            />
            COMPRESSOR
          </label>
          <label className="partrack-toggle">
            <input
              type="checkbox"
              checked={settings.reverb.enabled}
              onChange={(e) =>
                onSetGlobal({ reverb: { ...settings.reverb, enabled: e.target.checked } })
              }
            />
            REVERB
          </label>
          {REVERB_KNOBS.map(({ key, label, help }) => (
            <Knob
              key={key}
              label={label}
              value={toKnob(settings.reverb[key])}
              max={99}
              size={30}
              help={help}
              onChange={(v) => onSetGlobal({ reverb: { ...settings.reverb, [key]: fromKnob(v) } })}
            />
          ))}
        </div>

        <p className="partrack-note">
          Click a row to edit that part's voice in the main editor. Drop or LOAD .syx or .Dx7Voice
          files (e.g. TX802 factory A1–B2 + P, or FS1R voice banks) to import banks, AMEM
          supplements, performances, and system setup.
        </p>
      </div>
    </div>
  );
}
