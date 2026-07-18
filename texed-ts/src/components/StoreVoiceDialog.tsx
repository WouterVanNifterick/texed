// Modal to name a voice and pick a bank slot before storing the edit buffer.

import { useEffect, useMemo, useState } from 'react';
import type { DexedSynth } from '../audio/useDexedSynth';
import { programIndexForVoice } from '../audio/useDexedSynth';
import { getVoiceName } from '../state/params';
import type { VoiceRef, VoiceBankId } from '../engine/voice-library';
import { VOICE_BANK_LABELS } from '../engine/voice-library';

interface StoreVoiceDialogProps {
  synth: DexedSynth;
  defaultVoice: VoiceRef | undefined;
  onConfirm: (name: string, dest: VoiceRef, destLabel: string) => void;
  onClose: () => void;
}

export function StoreVoiceDialog({ synth, defaultVoice, onConfirm, onClose }: StoreVoiceDialogProps) {
  const [name, setName] = useState(() => getVoiceName(synth.voice));

  const useProgramList = synth.programOptions.length > 0;
  const defaultProgramIdx = useMemo(() => {
    if (!defaultVoice || !useProgramList) return 0;
    const idx = programIndexForVoice(synth.programOptions, defaultVoice);
    return idx >= 0 ? idx : 0;
  }, [defaultVoice, synth.programOptions, useProgramList]);

  const [programIdx, setProgramIdx] = useState(defaultProgramIdx);
  const [bank, setBank] = useState<VoiceBankId>(defaultVoice?.bank ?? 'internalA');
  const [program, setProgram] = useState(defaultVoice?.program ?? 0);

  const populatedBanks = synth.banks.filter((b) => b.populated);
  const fallbackBanks = populatedBanks.length > 0 ? populatedBanks : synth.banks;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleConfirm = () => {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) return;

    if (useProgramList) {
      const opt = synth.programOptions[programIdx];
      if (!opt) return;
      onConfirm(trimmed, opt.ref, opt.label);
    } else {
      const dest: VoiceRef = { bank, program };
      const prefix = VOICE_BANK_LABELS[bank].split(' ')[0];
      const slotNum = String(program + 1).padStart(2, '0');
      onConfirm(trimmed, dest, `${prefix} ${slotNum} ${trimmed}`);
    }
  };

  return (
    <div className="partrack-overlay" onClick={onClose}>
      <div className="partrack store-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="partrack-header">
          <span className="partrack-title">STORE VOICE</span>
        </div>

        <div className="store-dialog-body">
          <label className="store-field">
            Name
            <input
              className="store-name-input"
              value={name}
              maxLength={10}
              spellCheck={false}
              autoFocus
              onChange={(e) => setName(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
              }}
            />
          </label>

          {useProgramList ? (
            <label className="store-field">
              Location
              <select value={programIdx} onChange={(e) => setProgramIdx(Number(e.target.value))}>
                {synth.programOptions.map((opt, i) => (
                  <option key={i} value={i}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="store-field">
                Bank
                <select value={bank} onChange={(e) => setBank(e.target.value as VoiceBankId)}>
                  {fallbackBanks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label || VOICE_BANK_LABELS[b.id]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="store-field">
                Program
                <select value={program} onChange={(e) => setProgram(Number(e.target.value))}>
                  {Array.from({ length: 32 }, (_, i) => (
                    <option key={i} value={i}>
                      {String(i + 1).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        <div className="store-dialog-actions">
          <button type="button" className="partrack-btn" onClick={onClose}>
            CANCEL
          </button>
          <button type="button" className="partrack-btn store-confirm" onClick={handleConfirm} disabled={!name.trim()}>
            STORE
          </button>
        </div>
      </div>
    </div>
  );
}
