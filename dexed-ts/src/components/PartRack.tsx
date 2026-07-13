// Multi-timbral part rack (TX802 / TX816). Eight parts, each with an on/off,
// MIDI receive channel, program, volume, pan, note range and transpose. Clicking
// a part selects it as the target for the voice editor. Self-contained styling
// so it can overlay the fixed synth rack without disturbing its layout.

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
  polyphony: number;
  masterTuneCents: number;
  onMasterTune: (cents: number) => void;
  onSelect: (index: number) => void;
  onSetPart: (index: number, config: Partial<PartConfig>) => void;
  onSetVoiceRef: (ref: VoiceRef, partIndex?: number) => void;
  onPolyphony: (cap: number) => void;
  subscribeStatus: (cb: (s: SynthStatus) => void) => () => void;
  onClose: () => void;
}

const c = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as const,
  panel: {
    background: '#1a1c20', color: '#d8dce0', border: '1px solid #333',
    borderRadius: 8, padding: '12px 14px', width: 'max-content', maxWidth: '96vw',
    maxHeight: '92vh', overflow: 'auto', font: '12px system-ui, sans-serif',
    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
  } as const,
  header: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 } as const,
  title: { fontSize: 14, fontWeight: 700, letterSpacing: 1 } as const,
  th: { textAlign: 'left', padding: '3px 4px', color: '#8a9098', fontWeight: 600, whiteSpace: 'nowrap' } as const,
  td: { padding: '2px 4px', whiteSpace: 'nowrap' } as const,
  sliderTd: { padding: '2px 4px', whiteSpace: 'nowrap', width: 72 } as const,
  rangeTd: { padding: '2px 4px', whiteSpace: 'nowrap', width: 110 } as const,
  select: { background: '#24272c', color: '#d8dce0', border: '1px solid #3a3f46', borderRadius: 4, padding: '2px 4px' } as const,
  btn: { background: '#2b2f36', color: '#d8dce0', border: '1px solid #3a3f46', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' } as const,
};

export function PartRack({
  configs, selectedPart, programOptions, performanceNames, performanceIndex,
  onSelectPerformance, polyphony, masterTuneCents, onMasterTune,
  onSelect, onSetPart, onSetVoiceRef, onPolyphony, subscribeStatus, onClose,
}: PartRackProps) {
  const [activity, setActivity] = useState<number[]>([]);

  useEffect(() => subscribeStatus((s) => setActivity(s.partActivity ?? [])), [subscribeStatus]);

  return (
    <div style={c.overlay} onClick={onClose}>
      <div style={c.panel} onClick={(e) => e.stopPropagation()}>
        <div style={c.header}>
          <span style={c.title}>PART RACK · TX802 / TX816</span>
          {performanceNames.length > 0 && (
            <label>
              Performance&nbsp;
              <select
                style={c.select}
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
          <label style={{ marginLeft: 'auto' }} title="Master tune (cents), from 8973S system setup">
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
          <label>
            Polyphony&nbsp;
            <select style={c.select} value={polyphony} onChange={(e) => onPolyphony(Number(e.target.value))}>
              {[8, 16, 24, 32, 48, 64, 96, 128].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="button" style={c.btn} onClick={onClose}>CLOSE</button>
        </div>

        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['#', 'On', 'Ch', 'Program', 'Vol', 'Pan', 'Range', 'Shift', 'Detune', 'Act'].map((h) => (
                <th key={h} style={c.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {configs.map((cfg, i) => {
              const selected = i === selectedPart;
              const progIdx = programIndexForVoice(programOptions, cfg.voice);
              return (
                <tr
                  key={i}
                  onClick={() => onSelect(i)}
                  style={{
                    background: selected ? '#2c3a4a' : i % 2 ? '#1e2126' : 'transparent',
                    cursor: 'pointer', opacity: cfg.enabled ? 1 : 0.5,
                  }}
                >
                  <td style={{ ...c.td, fontWeight: 700, color: selected ? '#7fc4ff' : '#d8dce0' }}>{i + 1}</td>
                  <td style={c.td}>
                    <input
                      type="checkbox"
                      checked={cfg.enabled}
                      onChange={(e) => onSetPart(i, { enabled: e.target.checked })}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td style={c.td}>
                    <select
                      style={c.select}
                      value={cfg.rxChannel}
                      onChange={(e) => onSetPart(i, { rxChannel: Number(e.target.value) })}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value={0}>OMNI</option>
                      {Array.from({ length: 16 }, (_, ch) => <option key={ch} value={ch + 1}>{ch + 1}</option>)}
                    </select>
                  </td>
                  <td style={c.td}>
                    <select
                      style={{ ...c.select, width: 180 }}
                      value={progIdx}
                      onChange={(e) => {
                        const opt = programOptions[Number(e.target.value)];
                        if (opt) onSetVoiceRef(opt.ref, i);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      disabled={programOptions.length === 0}
                    >
                      {programOptions.length === 0
                        ? <option value={0}>INIT VOICE</option>
                        : programOptions.map((opt, p) => (
                          <option key={p} value={p}>{opt.label}</option>
                        ))}
                    </select>
                  </td>
                  <td style={c.sliderTd}>
                    <PartSlider
                      label={`Part ${i + 1} volume`}
                      min={0}
                      max={100}
                      value={Math.round(cfg.volume * 100)}
                      onChange={(volume) => onSetPart(i, { volume: volume / 100 })}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td style={c.sliderTd}>
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
                  <td style={c.rangeTd}>
                    <NoteRange
                      low={cfg.noteLow}
                      high={cfg.noteHigh}
                      label={`Part ${i + 1} note range`}
                      onChange={(noteLow, noteHigh) => onSetPart(i, { noteLow, noteHigh })}
                    />
                  </td>
                  <td style={c.td}>
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
                  <td style={c.td}>
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
                  <td style={{ ...c.td, textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                      background: (activity[i] ?? 0) > 0 ? '#4ade80' : '#3a3f46',
                    }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ color: '#8a9098', marginTop: 8, maxWidth: 720, lineHeight: 1.4, whiteSpace: 'normal' }}>
          Click a row to edit that part's voice in the main editor. LOAD a .syx file to import
          internal/cartridge banks, performances, and system setup.
        </p>
      </div>
    </div>
  );
}

