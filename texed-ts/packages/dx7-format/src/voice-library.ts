// DX7II bank-aware voice storage: up to four 32-voice VMEM halves plus AMEM supplements.

import { Cartridge, initVoice, sysexChecksum } from './cartridge';
import { createDefaultAmem, AMEM_SLOT_SIZE, AMEM_BULK_SIZE } from './amem';
import { cartridgeFromVoices } from './sysex';
import { getVoiceName, isFillerVoiceName } from './voice';
import type { ProgramOption } from './part-config';
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

/**
 * Decode a raw DX7II PMEM/PCED voice byte (0–127): INT 1–64 then CRT 1–64,
 * which is VOICE_BANK_ORDER in steps of 32.
 */
export function decodeDx7iiVoiceRef(raw: number): VoiceRef {
  const v = raw & 0x7f;
  return { bank: VOICE_BANK_ORDER[v >> 5], program: v % 32 };
}

/** Decode a TX802 TPMEM voice number (1–128, 1-based). Voice 0 = no voice assigned. */
export function decodeTx802VoiceRef(vnum: number): VoiceRef | null {
  const v = vnum & 0x7f;
  if (v === 0) return null;
  return decodeDx7iiVoiceRef(v - 1);
}

function createEmptySlot(): VoiceSlot {
  return { vmem: initVoice(), amem: createDefaultAmem() };
}

function voiceNameFromVmem(vmem: Uint8Array): string {
  return getVoiceName(vmem).trimEnd();
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
  /** Raw 256-byte micro-tuning payloads, in the order they were loaded. */
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

  /**
   * Replace one half-bank with up to 32 unpacked 156-byte voices (plus optional
   * 35-byte AMEM supplements). Slots beyond the supplied voices reset to init.
   */
  loadVoicesInto(bank: VoiceBankId, voices: Uint8Array[], amems?: Uint8Array[]): void {
    const slots = this.ensureBank(bank);
    for (let i = 0; i < 32; i++) {
      const v = voices[i];
      slots[i].vmem.set(v ? v.subarray(0, 156) : initVoice());
      const a = amems?.[i];
      slots[i].amem.set(a ? a.subarray(0, AMEM_SLOT_SIZE) : createDefaultAmem());
    }
  }

  resolve(ref: VoiceRef): VoiceSlot | null {
    const bank = this.slots[ref.bank];
    if (!bank) return null;
    const idx = ref.program & 0x1f;
    return bank[idx] ?? null;
  }

  /**
   * Store an edited voice buffer (156-byte VMEM + AMEM supplement) into a bank
   * slot - the "Store into Internal/Cartridge Voice Memory" operation. Creates
   * the destination bank if it isn't populated yet.
   */
  storeVoice(ref: VoiceRef, vmem: Uint8Array, amem: Uint8Array): void {
    const slots = this.ensureBank(ref.bank);
    const slot = slots[ref.program & 0x1f];
    slot.vmem.set(vmem.subarray(0, 156));
    slot.amem.set(amem.subarray(0, AMEM_SLOT_SIZE));
  }

  programNames(bank: VoiceBankId): string[] {
    const slots = this.slots[bank];
    if (!slots) return [];
    return slots.map((s) => voiceNameFromVmem(s.vmem));
  }

  /** Flat program list for UI: all populated banks with prefixed labels. */
  programOptions(): ProgramOption[] {
    const out: ProgramOption[] = [];
    for (const bank of this.populatedBanks()) {
      const prefix = VOICE_BANK_LABELS[bank].split(' ')[0];
      const names = this.programNames(bank);
      for (let p = 0; p < names.length; p++) {
        out.push({
          ref: { bank, program: p },
          label: `${prefix} ${String(p + 1).padStart(2, '0')} ${names[p]}`,
          filler: isFillerVoiceName(names[p]),
        });
      }
    }
    return out;
  }

  /** Human-readable label for a voice ref (from loaded banks). */
  voiceLabel(ref: VoiceRef): string {
    const slot = this.resolve(ref);
    const prefix = VOICE_BANK_LABELS[ref.bank].split(' ')[0];
    const slotNum = String((ref.program & 0x1f) + 1).padStart(2, '0');
    if (!slot) return `${prefix} ${slotNum} (bank not loaded)`;
    const name = voiceNameFromVmem(slot.vmem);
    return `${prefix} ${slotNum} ${name}`;
  }

  /**
   * Serialize one bank half as SysEx: an AMEM bulk (format 0x06) followed by a
   * VMEM 32-voice bulk (format 0x09), the same pairing a DX7II transmits.
   * Returns null when the bank is not populated.
   */
  dumpBankSysex(bank: VoiceBankId): Uint8Array | null {
    const slots = this.slots[bank];
    if (!slots) return null;

    // AMEM bulk: F0 43 0n 06 08 60 <1120 bytes> cksum F7.
    const amem = new Uint8Array(6 + AMEM_BULK_SIZE + 2);
    amem.set([0xf0, 0x43, 0x00, 0x06, 0x08, 0x60], 0);
    for (let i = 0; i < 32; i++) {
      amem.set(slots[i].amem.subarray(0, AMEM_SLOT_SIZE), 6 + i * AMEM_SLOT_SIZE);
    }
    amem[6 + AMEM_BULK_SIZE] = sysexChecksum(amem, 6, AMEM_BULK_SIZE);
    amem[6 + AMEM_BULK_SIZE + 1] = 0xf7;

    // VMEM bulk: pack the 32 unpacked voices back into a 4104-byte dump.
    const vmem = cartridgeFromVoices(slots.map((s) => s.vmem)).voiceData;

    const out = new Uint8Array(amem.length + vmem.length);
    out.set(amem, 0);
    out.set(vmem, amem.length);
    return out;
  }

  /** Merge another loaded library into this one (banks, performances, setup). */
  mergeFrom(other: VoiceLibrary): void {
    for (const bank of other.populatedBanks()) {
      const dst = this.ensureBank(bank);
      for (let i = 0; i < 32; i++) {
        const slot = other.resolve({ bank, program: i });
        if (slot) {
          dst[i].vmem.set(slot.vmem);
          dst[i].amem.set(slot.amem);
        }
      }
    }
    if (other.performances.length > 0) {
      this.performances = other.performances;
      this.performanceIndex = other.performanceIndex;
    }
    if (other.systemSetup) this.systemSetup = other.systemSetup;
    if (other.microtunings.length > 0) {
      this.microtunings.push(...other.microtunings);
    }
  }

  clear(): void {
    this.slots = {};
    this.systemSetup = null;
    this.performances = [];
    this.performanceIndex = 0;
    this.microtunings = [];
  }
}
