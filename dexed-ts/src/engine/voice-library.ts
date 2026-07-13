// DX7II bank-aware voice storage: up to four 32-voice VMEM halves plus AMEM supplements.

import { Cartridge, initVoice } from './cartridge';
import { createDefaultAmem, AMEM_SLOT_SIZE } from './amem';
import type { ParsedPerformance } from './performance';
import type { SystemSetup } from './system-setup';

export type VoiceBankId = 'internalA' | 'internalB' | 'cartridgeA' | 'cartridgeB';

export const VOICE_BANK_ORDER: VoiceBankId[] = [
  'internalA',
  'internalB',
  'cartridgeA',
  'cartridgeB',
];

export const VOICE_BANK_LABELS: Record<VoiceBankId, string> = {
  internalA: 'INT 1–32',
  internalB: 'INT 33–64',
  cartridgeA: 'CRT 1–32',
  cartridgeB: 'CRT 33–64',
};

export interface VoiceRef {
  bank: VoiceBankId;
  /** 0–31 program index within the half-bank. */
  program: number;
}

export interface VoiceSlot {
  vmem: Uint8Array;
  amem: Uint8Array;
}

export function defaultVoiceRef(): VoiceRef {
  return { bank: 'internalA', program: 0 };
}

export function voiceRefEquals(a: VoiceRef, b: VoiceRef): boolean {
  return a.bank === b.bank && a.program === b.program;
}

/** Decode a raw DX7II PMEM/PCED voice byte (0–127). */
export function decodeDx7iiVoiceRef(raw: number): VoiceRef {
  const v = raw & 0x7f;
  if (v >= 64) {
    const cart = v - 64;
    return {
      bank: cart >= 32 ? 'cartridgeB' : 'cartridgeA',
      program: cart % 32,
    };
  }
  return {
    bank: v >= 32 ? 'internalB' : 'internalA',
    program: v % 32,
  };
}

/** Encode a VoiceRef back to a DX7II PMEM voice byte. */
export function encodeDx7iiVoiceRef(ref: VoiceRef): number {
  let base = ref.program % 32;
  switch (ref.bank) {
    case 'internalB':
      base += 32;
      break;
    case 'cartridgeA':
      base += 64;
      break;
    case 'cartridgeB':
      base += 96;
      break;
    default:
      break;
  }
  return base;
}

function createEmptySlot(): VoiceSlot {
  return { vmem: initVoice(), amem: createDefaultAmem() };
}

function voiceNameFromVmem(vmem: Uint8Array): string {
  let name = '';
  for (let n = 0; n < 10; n++) {
    const c = vmem[145 + n] & 0x7f;
    name += String.fromCharCode(c < 32 ? 32 : c);
  }
  return name.trimEnd();
}

export interface BankInfo {
  id: VoiceBankId;
  label: string;
  populated: boolean;
}

export class VoiceLibrary {
  private slots: Partial<Record<VoiceBankId, VoiceSlot[]>> = {};
  systemSetup: SystemSetup | null = null;
  performances: ParsedPerformance[] = [];
  performanceIndex = 0;
  /** Parsed microtuning blobs (not yet applied to playback). */
  microtunings: Uint8Array[] = [];

  private ensureBank(bank: VoiceBankId): VoiceSlot[] {
    if (!this.slots[bank]) {
      this.slots[bank] = Array.from({ length: 32 }, () => createEmptySlot());
    }
    return this.slots[bank]!;
  }

  populatedBanks(): VoiceBankId[] {
    return VOICE_BANK_ORDER.filter((b) => this.slots[b] !== undefined);
  }

  bankInfos(): BankInfo[] {
    return VOICE_BANK_ORDER.map((id) => ({
      id,
      label: VOICE_BANK_LABELS[id],
      populated: this.slots[id] !== undefined,
    }));
  }

  /** Load a 32-voice VMEM cartridge into a bank half. */
  loadVmemBank(bank: VoiceBankId, cart: Cartridge): void {
    const slots = this.ensureBank(bank);
    for (let i = 0; i < 32; i++) {
      slots[i].vmem.set(cart.unpackProgram(i));
    }
  }

  /** Load packed AMEM bulk (1120 bytes) into a bank half. */
  loadAmemBank(bank: VoiceBankId, packed: Uint8Array): void {
    const slots = this.ensureBank(bank);
    for (let i = 0; i < 32; i++) {
      const off = i * AMEM_SLOT_SIZE;
      if (off + AMEM_SLOT_SIZE <= packed.length) {
        slots[i].amem.set(packed.subarray(off, off + AMEM_SLOT_SIZE));
      }
    }
  }

  /** Load a single-cartridge file into internalA (legacy / simple dumps). */
  loadLegacyCartridge(cart: Cartridge): void {
    this.loadVmemBank('internalA', cart);
  }

  resolve(ref: VoiceRef): VoiceSlot | null {
    const bank = this.slots[ref.bank];
    if (!bank) return null;
    const idx = ref.program & 0x1f;
    return bank[idx] ?? null;
  }

  programNames(bank: VoiceBankId): string[] {
    const slots = this.slots[bank];
    if (!slots) return [];
    return slots.map((s) => voiceNameFromVmem(s.vmem));
  }

  /** Flat program list for UI: all populated banks with prefixed labels. */
  programOptions(): { ref: VoiceRef; label: string }[] {
    const out: { ref: VoiceRef; label: string }[] = [];
    for (const bank of this.populatedBanks()) {
      const prefix = VOICE_BANK_LABELS[bank].split(' ')[0];
      const names = this.programNames(bank);
      for (let p = 0; p < names.length; p++) {
        out.push({
          ref: { bank, program: p },
          label: `${prefix} ${String(p + 1).padStart(2, '0')} ${names[p]}`,
        });
      }
    }
    return out;
  }

  findProgramOptionIndex(ref: VoiceRef): number {
    const opts = this.programOptions();
    return opts.findIndex((o) => voiceRefEquals(o.ref, ref));
  }

  clear(): void {
    this.slots = {};
    this.systemSetup = null;
    this.performances = [];
    this.performanceIndex = 0;
    this.microtunings = [];
  }
}
