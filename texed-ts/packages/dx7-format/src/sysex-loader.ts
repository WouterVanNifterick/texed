// Orchestrates loading all frames from a composite .syx file into VoiceLibrary.

import { amemPayloadFromFrame } from './amem';
import { performancesFromFrame, type ParsedPerformance } from './performance';
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
import { VoiceLibrary, VOICE_BANK_ORDER, type VoiceBankId } from './voice-library';

export interface LoadReport {
  frames: number;
  applied: string[];
  skipped: string[];
}

/** Frame kinds `performancesFromFrame` can decode. */
const PERF_KINDS = new Set<SysexFrame['kind']>([
  SysexKind.Performance,
  SysexKind.Dx7iiPerformance,
  SysexKind.Dx7iiPerformanceEdit,
]);

function nextFreeBank(
  lib: VoiceLibrary,
  sequence: VoiceBankId[],
  startIdx: number,
): VoiceBankId | null {
  const populated = new Set(lib.populatedBanks());
  for (let i = startIdx; i < sequence.length; i++) {
    if (!populated.has(sequence[i])) return sequence[i];
  }
  return null;
}

/**
 * `F0 43 1n 19 4D vv F7` precedes each VMEM dump of a DX7II-family bulk save.
 * `vv` selects the *half* of the 64-voice memory being sent (0 = voices 1-32,
 * 1 = voices 33-64) - it does not say internal or cartridge. Which memory the
 * pair belongs to comes from the file's own performances (see `memorySideOf`).
 */
function paramChangeHalf(frame: SysexFrame): 0 | 1 | null {
  const raw = frame.raw;
  if (raw.length < 6) return null;
  if (raw[4] !== 0x4d) return null;
  return (raw[5] & 0x7f) === 1 ? 1 : 0;
}

const MEMORY_HALVES: Record<'internal' | 'cartridge', [VoiceBankId, VoiceBankId]> = {
  internal: ['internalA', 'internalB'],
  cartridge: ['cartridgeA', 'cartridgeB'],
};

/**
 * Which memory a file's voice dumps belong to. A cartridge save carries
 * performances whose parts point at CRT slots, an internal save at INT slots;
 * files with no performances (plain bank dumps) are treated as internal.
 * Mixed references mean the performances also reach into a memory this file
 * does not carry, and the majority wins.
 */
function memorySideOf(perfs: ParsedPerformance[]): 'internal' | 'cartridge' {
  let internal = 0;
  let cartridge = 0;
  for (const perf of perfs) {
    for (const part of perf.parts) {
      if (part.enabled === false || !part.voice) continue;
      if (part.voice.bank.startsWith('cartridge')) cartridge++;
      else internal++;
    }
  }
  return cartridge > internal ? 'cartridge' : 'internal';
}

/** Every half-bank the performances point at, in VOICE_BANK_ORDER. */
function referencedBanks(perfs: ParsedPerformance[]): VoiceBankId[] {
  const used = new Set<VoiceBankId>();
  for (const perf of perfs) {
    for (const part of perf.parts) {
      if (part.enabled === false || !part.voice) continue;
      used.add(part.voice.bank);
    }
  }
  return VOICE_BANK_ORDER.filter((b) => used.has(b));
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

  // Pre-pass: the performances decide which memory the voice dumps belong to,
  // and they can sit either side of those dumps in the file. Parsed once and
  // reused by the main pass below.
  const perfByFrame = new Map<number, ParsedPerformance[]>();
  frames.forEach((frame, i) => {
    if (!PERF_KINDS.has(frame.kind)) return;
    const perfs = performancesFromFrame(frame);
    if (perfs && perfs.length > 0) perfByFrame.set(i, perfs);
  });
  const perfs = [...perfByFrame.values()].flat();
  const halves = MEMORY_HALVES[memorySideOf(perfs)];
  // Untagged dumps fill the indicated memory first, then the other one.
  const bankSequence = [...halves, ...VOICE_BANK_ORDER.filter((b) => !halves.includes(b))];
  // A file with a single voice dump whose performances all point at one
  // half-bank puts the dump there, whatever the half tag says: the references
  // are the only unambiguous statement of where these voices live.
  const refs = referencedBanks(perfs);
  const soleBank =
    refs.length === 1 && frames.filter((f) => f.kind === SysexKind.Cartridge).length === 1
      ? refs[0]
      : null;

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

  for (const [frameIdx, frame] of frames.entries()) {
    switch (frame.kind) {
      case SysexKind.ParamChange: {
        const half = paramChangeHalf(frame);
        if (half !== null) {
          pendingBankTag = halves[half];
          report.applied.push(`bank tag ${pendingBankTag}`);
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
          pendingAmemBank =
            soleBank ??
            pendingBankTag ??
            nextFreeBank(lib, bankSequence, bankAssignIdx) ??
            halves[0];
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
        const bank =
          soleBank ?? pendingBankTag ?? nextFreeBank(lib, bankSequence, bankAssignIdx) ?? halves[0];
        flushAmemPair(bank);
        lib.loadVmemBank(bank, cart);
        report.applied.push(`VMEM → ${bank}`);
        bankAssignIdx = bankSequence.indexOf(bank) + 1;
        pendingBankTag = null;
        break;
      }
      case SysexKind.Dx7iiPerformance:
      case SysexKind.Dx7iiPerformanceEdit: {
        const perfs = perfByFrame.get(frameIdx);
        if (perfs) {
          lib.performances = perfs;
          lib.performanceIndex = 0;
          report.applied.push(`performances (${perfs.length})`);
        }
        break;
      }
      case SysexKind.Performance: {
        const perfs = perfByFrame.get(frameIdx);
        if (perfs) {
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
        const data = bulkPayloadFromFrame(frame);
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

  const loaded =
    lib.populatedBanks().length > 0 || lib.performances.length > 0 || singleVoice !== null;
  return { library: lib, report, loaded, singleVoice };
}

function loadRawVced(bytes: Uint8Array): LoadResult {
  const lib = new VoiceLibrary();
  const report: LoadReport = { frames: 0, applied: [], skipped: [] };

  if (bytes.length === 155 || bytes.length === 156) {
    const voice = voiceFromRawVced(bytes);
    if (!voice) {
      return {
        library: lib,
        report: { ...report, skipped: ['raw VCED (parse failed)'] },
        loaded: false,
        singleVoice: null,
      };
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
    return {
      library: lib,
      report: { ...report, skipped: ['raw VCED (parse failed)'] },
      loaded: false,
      singleVoice: null,
    };
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
