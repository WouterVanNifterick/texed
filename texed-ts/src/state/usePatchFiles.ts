// Patch file I/O: loading dropped/picked .syx and MiniDexed .ini files, and
// exporting the current voice, bank, or performance. Import and export share
// the parsed MiniDexed extras, so they live in one hook.

import { useCallback, useState } from 'react';
import { getVoiceName } from '@texed/dx7-format/voice';
import { vcedFromVoice } from '@texed/dx7-format/sysex';
import { acedToSysex } from '@texed/dx7-format/amem';
import {
  parseMiniDexedIni,
  serializeMiniDexedIni,
  type MiniDexedExtras,
} from '@texed/dx7-format/minidexed-ini';
import type { Synth } from '../audio/useSynth';
import { downloadBlob } from './download';

export interface PatchFiles {
  loadFiles: (files: File[]) => Promise<void>;
  saveVoice: () => void;
  saveBank: () => void;
  savePerformance: () => void;
}

export function usePatchFiles(synth: Synth, showMsg: (text: string) => void): PatchFiles {
  // Blocks of a loaded MiniDexed .ini that Texed does not model; kept so that
  // saving the performance again round-trips them instead of dropping them.
  const [miniDexedExtras, setMiniDexedExtras] = useState<MiniDexedExtras | null>(null);

  const loadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const iniFiles = files.filter((f) => /\.ini$/i.test(f.name));
      const syxFiles = files.filter((f) => !/\.ini$/i.test(f.name));
      for (const f of iniFiles) {
        const { name: iniName, parts, voices, extras } = parseMiniDexedIni(await f.text());
        setMiniDexedExtras(extras);
        const name = iniName || f.name.replace(/\.ini$/i, '');
        synth.loadPerformance(name, parts, voices);
        showMsg(`Loaded MiniDexed performance · ${name}`);
      }
      if (syxFiles.length) {
        synth.loadCart(await new Blob(syxFiles).arrayBuffer());
      }
    },
    [synth, showMsg],
  );

  const saveVoice = useCallback(() => {
    // Single voice = DX7II additional data (ACED) followed by the voice (VCED),
    // the same pair the DX7II transmits for the current voice.
    const aced = acedToSysex(synth.supplement);
    const vced = vcedFromVoice(synth.voice);
    const syx = new Uint8Array(aced.length + vced.length);
    syx.set(aced, 0);
    syx.set(vced, aced.length);
    downloadBlob(syx.buffer as ArrayBuffer, `${getVoiceName(synth.voice).trim() || 'voice'}.syx`);
  }, [synth]);

  const saveBank = useCallback(() => {
    const bank = synth.partConfigs[synth.selectedPart]?.voice.bank ?? 'internalA';
    synth.requestBankDump(bank, (data) => {
      if (!data) {
        showMsg(`Bank ${bank} is empty - nothing to save`);
        return;
      }
      downloadBlob(data.slice().buffer as ArrayBuffer, `${bank}.syx`);
    });
  }, [synth, showMsg]);

  const savePerformance = useCallback(() => {
    synth.getFullState((state) => {
      const text = serializeMiniDexedIni({
        name: state.performanceName,
        parts: state.parts,
        voices: state.editBuffers.map((eb) => eb.voice),
        extras: miniDexedExtras,
      });
      downloadBlob(text, 'performance.ini', 'text/plain');
    });
  }, [synth, miniDexedExtras]);

  return { loadFiles, saveVoice, saveBank, savePerformance };
}
