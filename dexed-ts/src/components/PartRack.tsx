// Multi-timbral part rack (TX802 / TX816). Eight parts, each with an on/off,
// MIDI receive channel, program, volume, pan, note range and transpose. Clicking
// a part selects it as the target for the voice editor. Self-contained styling
// so it can overlay the fixed synth rack without disturbing its layout.

import { useEffect, useState } from 'react';
import type { PartConfig } from '../engine/synth-rack';
import type { SynthStatus } from '../audio/useDexedSynth';
import { Knob } from './ui';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteLabel = (n: number): string => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

interface PartRackProps {
  configs: PartConfig[];
  selectedPart: number;
  programNames: string[];
  polyphony: number;
  onSelect: (index: number) => void;
  onSetPart: (index: number, config: Partial<PartConfig>) => void;
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
    borderRadius: 8, padding: 16, width: 'min(1100px, 96vw)', maxHeight: '92vh',
    overflow: 'auto', font: '12px system-ui, sans-serif', boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
  } as const,
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } as const,
  title: { fontSize: 15, fontWeight: 700, letterSpacing: 1 } as const,
  th: { textAlign: 'left', padding: '4px 6px', color: '#8a9098', fontWeight: 600, whiteSpace: 'nowrap' } as const,
  td: { padding: '3px 6px', whiteSpace: 'nowrap' } as const,
  select: { background: '#24272c', color: '#d8dce0', border: '1px solid #3a3f46', borderRadius: 4, padding: '2px 4px' } as const,
  btn: { background: '#2b2f36', color: '#d8dce0', border: '1px solid #3a3f46', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' } as const,
};

export function PartRack({
  configs, selectedPart, programNames, polyphony,
  onSelect, onSetPart, onPolyphony, subscribeStatus, onClose,
}: PartRackProps) {
  const [activity, setActivity] = useState<number[]>([]);

  useEffect(() => subscribeStatus((s) => setActivity(s.partActivity ?? [])), [subscribeStatus]);

  return (
    <div style={c.overlay} onClick={onClose}>
      <div style={c.panel} onClick={(e) => e.stopPropagation()}>
        <div style={c.header}>
          <span style={c.title}>PART RACK · TX802 / TX816</span>
          <label style={{ marginLeft: 'auto' }}>
            Polyphony&nbsp;
            <select style={c.select} value={polyphony} onChange={(e) => onPolyphony(Number(e.target.value))}>
              {[8, 16, 24, 32, 48, 64, 96, 128].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="button" style={c.btn} onClick={onClose}>CLOSE</button>
        </div>

        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {['#', 'On', 'Ch', 'Program', 'Vol', 'Pan', 'Low', 'High', 'Shift', 'Act'].map((h) => (
                <th key={h} style={c.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {configs.map((cfg, i) => {
              const selected = i === selectedPart;
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
                      style={{ ...c.select, width: 150 }}
                      value={cfg.voiceNumber}
                      onChange={(e) => onSetPart(i, { voiceNumber: Number(e.target.value) })}
                      onClick={(e) => e.stopPropagation()}
                      disabled={programNames.length === 0}
                    >
                      {programNames.length === 0
                        ? <option value={0}>INIT VOICE</option>
                        : programNames.map((name, p) => (
                          <option key={p} value={p}>{String(p + 1).padStart(2, '0')} {name}</option>
                        ))}
                    </select>
                  </td>
                  <td style={c.td}>
                    <input
                      type="range" min={0} max={100} value={Math.round(cfg.volume * 100)}
                      onChange={(e) => onSetPart(i, { volume: Number(e.target.value) / 100 })}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td style={c.td}>
                    <input
                      type="range" min={-100} max={100} value={Math.round(cfg.pan * 100)}
                      onChange={(e) => onSetPart(i, { pan: Number(e.target.value) / 100 })}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td style={c.td}>
                    <select
                      style={c.select} value={cfg.noteLow}
                      onChange={(e) => onSetPart(i, { noteLow: Number(e.target.value) })}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {Array.from({ length: 128 }, (_, n) => <option key={n} value={n}>{noteLabel(n)}</option>)}
                    </select>
                  </td>
                  <td style={c.td}>
                    <select
                      style={c.select} value={cfg.noteHigh}
                      onChange={(e) => onSetPart(i, { noteHigh: Number(e.target.value) })}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {Array.from({ length: 128 }, (_, n) => <option key={n} value={n}>{noteLabel(n)}</option>)}
                    </select>
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
        <p style={{ color: '#8a9098', marginTop: 10 }}>
          Click a row to edit that part's voice in the main editor. OMNI parts receive all channels
          (TX816: give each part its own channel). LOAD a cartridge to share it across all parts.
        </p>
      </div>
    </div>
  );
}
