// Orchestrates loading all frames from a composite .syx file into VoiceLibrary.

import { amemPayloadFromFrame } from './amem';
import { performancesFromFrame } from './performance';
import {
  identifySysex,
  SysexKind,
  cartridgeFromSyx,
  cartridgeFromVoices,
  voiceFromVced,
  voiceFromRawVced,
  isRawVcedBuffer,
  bulkPayloadFromFrame,
  type SysexFrame,
} from './sysex';
import { parseSystemSetup, systemSetupPayloadFromFrame, masterTuningCents } from './system-setup';
import {
  VoiceLibrary,
  VOICE_BANK_ORDER,
  type VoiceBankId,
} from './voice-library';

export interface LoadReport {
  frames: number;
  applied: string[];
  skipped: string[];
}

const BANK_SEQUENCE: VoiceBankId[] = VOICE_BANK_ORDER;

function nextFreeBank(lib: VoiceLibrary, startIdx: number): VoiceBankId | null {
  const populated = new Set(lib.populatedBanks());
  for (let i = startIdx; i < BANK_SEQUENCE.length; i++) {
    if (!populated.has(BANK_SEQUENCE[i])) return BANK_SEQUENCE[i];
  }
  return null;
}

function paramChangeBankTag(frame: SysexFrame): VoiceBankId | null {
  const raw = frame.raw;
  if (raw.length < 6) return null;
  if (raw[4] !== 0x4d) return null;
  const val = raw[5] & 0x7f;
  return val === 1 ? 'cartridgeA' : 'internalA';
}

function payloadFromFrame(frame: SysexFrame): Uint8Array | null {
  return bulkPayloadFromFrame(frame);
}

export interface LoadResult {
  library: VoiceLibrary;
  report: LoadReport;
  loaded: boolean;
  singleVoice: Uint8Array | null;
}

export function loadSysexFile(bytes: Uint8Array): LoadResult {
  const frames = identifySysex(bytes);
  if (frames.length === 0 && isRawVcedBuffer(bytes)) {
    return loadRawVced(bytes);
  }

  const lib = new VoiceLibrary();
  const report: LoadReport = { frames: frames.length, applied: [], skipped: [] };

  let bankAssignIdx = 0;
  let pendingBankTag: VoiceBankId | null = null;
  let pendingAmem: Uint8Array | null = null;
  let pendingAmemBank: VoiceBankId | null = null;
  let singleVoice: Uint8Array | null = null;

  const flushAmemPair = (vmemBank: VoiceBankId): void => {
    if (pendingAmem && pendingAmemBank === vmemBank) {
      lib.loadAmemBank(vmemBank, pendingAmem);
      report.applied.push(`AMEM → ${vmemBank}`);
      pendingAmem = null;
      pendingAmemBank = null;
    } else if (pendingAmem && pendingAmemBank) {
      lib.loadAmemBank(pendingAmemBank, pendingAmem);
      report.applied.push(`AMEM → ${pendingAmemBank}`);
      pendingAmem = null;
      pendingAmemBank = null;
    }
  };

  for (const frame of frames) {
    switch (frame.kind) {
      case SysexKind.ParamChange: {
        const tag = paramChangeBankTag(frame);
        if (tag) {
          pendingBankTag = tag;
          report.applied.push(`bank tag ${tag}`);
        } else {
          report.skipped.push('paramChange');
        }
        break;
      }
      case SysexKind.Amem:
      case SysexKind.AcedBank: {
        const packed = amemPayloadFromFrame(frame.raw);
        if (packed) {
          pendingAmem = packed;
          pendingAmemBank = pendingBankTag ?? nextFreeBank(lib, bankAssignIdx) ?? 'internalA';
          report.applied.push(`AMEM pending → ${pendingAmemBank}`);
        }
        break;
      }
      case SysexKind.Cartridge: {
        const cart = cartridgeFromSyx(frame.raw);
        if (!cart) {
          report.skipped.push('VMEM (parse failed)');
          break;
        }
        let bank = pendingBankTag ?? nextFreeBank(lib, bankAssignIdx);
        if (!bank) bank = 'internalA';
        flushAmemPair(bank);
        lib.loadVmemBank(bank, cart);
        report.applied.push(`VMEM → ${bank}`);
        bankAssignIdx = BANK_SEQUENCE.indexOf(bank) + 1;
        pendingBankTag = null;
        break;
      }
      case SysexKind.Dx7iiPerformance:
      case SysexKind.Dx7iiPerformanceEdit: {
        const perfs = performancesFromFrame(frame);
        if (perfs && perfs.length > 0) {
          lib.performances = perfs;
          lib.performanceIndex = 0;
          report.applied.push(`performances (${perfs.length})`);
        }
        break;
      }
      case SysexKind.Performance: {
        const perfs = performancesFromFrame(frame);
        if (perfs && perfs.length > 0) {
          if (lib.performances.length === 0) {
            lib.performances = perfs;
            lib.performanceIndex = 0;
            report.applied.push('TX802 performance');
          } else {
            report.skipped.push('TX802 performance (DX7II bank present)');
          }
        }
        break;
      }
      case SysexKind.SystemSetup: {
        const data = systemSetupPayloadFromFrame(frame.raw);
        if (data) {
          lib.systemSetup = parseSystemSetup(data);
          report.applied.push('8973S system setup');
        }
        break;
      }
      case SysexKind.Microtune: {
        const data = payloadFromFrame(frame);
        if (data) {
          lib.microtunings.push(data.slice());
          report.applied.push('microtuning (stored)');
        }
        break;
      }
      case SysexKind.Voice: {
        const v = voiceFromVced(frame.raw);
        if (v) singleVoice = v;
        break;
      }
      case SysexKind.Aced: {
        report.skipped.push('ACED single');
        break;
      }
      default:
        report.skipped.push(frame.kind);
        break;
    }
  }

  if (pendingAmem && pendingAmemBank) {
    lib.loadAmemBank(pendingAmemBank, pendingAmem);
    report.applied.push(`AMEM → ${pendingAmemBank} (final)`);
  }

  const loaded = lib.populatedBanks().length > 0 || lib.performances.length > 0 || singleVoice !== null;
  return { library: lib, report, loaded, singleVoice };
}

function loadRawVced(bytes: Uint8Array): LoadResult {
  const lib = new VoiceLibrary();
  const report: LoadReport = { frames: 0, applied: [], skipped: [] };

  if (bytes.length === 155 || bytes.length === 156) {
    const voice = voiceFromRawVced(bytes);
    if (!voice) {
      return { library: lib, report: { ...report, skipped: ['raw VCED (parse failed)'] }, loaded: false, singleVoice: null };
    }
    report.applied.push('raw VCED voice');
    return { library: lib, report, loaded: true, singleVoice: voice };
  }

  const voices: Uint8Array[] = [];
  for (let i = 0; i + 155 <= bytes.length; i += 155) {
    const voice = voiceFromRawVced(bytes.subarray(i, i + 155));
    if (voice) voices.push(voice);
  }
  if (voices.length === 0) {
    return { library: lib, report: { ...report, skipped: ['raw VCED (parse failed)'] }, loaded: false, singleVoice: null };
  }

  const cart = cartridgeFromVoices(voices);
  lib.loadVmemBank('internalA', cart);
  report.applied.push(`raw VCED bank (${voices.length} voices)`);
  return { library: lib, report, loaded: true, singleVoice: null };
}

export function applySystemSetupToParts(
  lib: VoiceLibrary,
  applyMasterTune: (cents: number) => void,
): void {
  const setup = lib.systemSetup;
  if (!setup) return;
  applyMasterTune(masterTuningCents(setup.masterTuning));
}
