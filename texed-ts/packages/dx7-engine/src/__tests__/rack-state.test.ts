import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SynthRack } from '../synth-rack';
import { loadSysexFile } from '@texed/dx7-format/sysex-loader';
import { RACK_STATE_SCHEMA, type RackState } from '@texed/dx7-format/rack-state';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => new Uint8Array(readFileSync(join(here, 'fixtures', name)));

function loadedRack(): SynthRack {
  const rack = new SynthRack(44100);
  const result = loadSysexFile(fx('tx802-prg1.syx'));
  rack.loadLibrary(result.library, result.report);
  return rack;
}

describe('SynthRack.getFullState / restoreFullState', () => {
  it('round-trips banks, parts, edits, and selection byte-exactly', () => {
    const rack = loadedRack();
    rack.setVoiceRefForPart(0, { bank: 'internalA', program: 7 });
    rack.setPartConfig(1, { enabled: true, rxChannel: 2, volume: 0.5, pan: -0.3 });
    rack.selectPart(1);
    rack.applyMasterTuneCents(23);
    rack.setVoiceParamForPart(0, 0, 42); // unsaved edit on part 0's buffer

    const state = rack.getFullState();
    expect(state.schema).toBe(RACK_STATE_SCHEMA);
    expect(state.banks.map((b) => b.id)).toEqual(['internalA']);

    const fresh = new SynthRack(44100);
    fresh.restoreFullState(state);

    // Bank contents identical.
    for (let i = 0; i < 32; i++) {
      const a = rack.voiceLibrary.resolve({ bank: 'internalA', program: i })!;
      const b = fresh.voiceLibrary.resolve({ bank: 'internalA', program: i })!;
      expect(Array.from(b.vmem)).toEqual(Array.from(a.vmem));
      expect(Array.from(b.amem)).toEqual(Array.from(a.amem));
    }
    // Part configs, selection, tuning.
    const cfg = fresh.getPartConfig(1);
    expect(cfg.enabled).toBe(true);
    expect(cfg.rxChannel).toBe(2);
    expect(cfg.volume).toBeCloseTo(0.5);
    expect(fresh.getPartConfig(0).voice).toEqual({ bank: 'internalA', program: 7 });
    expect(fresh.selectedPart).toBe(1);
    expect(fresh.masterTuneCents).toBe(23);
    // Unsaved edit buffer wins over the bank slot on restore.
    expect(fresh.getVoiceData(0)[0]).toBe(42);
  });

  it('round-trips performances', () => {
    const rack = new SynthRack(44100);
    const combined = loadSysexFile(new Uint8Array([...fx('tx802-prg1.syx')]));
    rack.loadLibrary(combined.library);
    rack.loadPerformances([
      { name: 'Test Perf', parts: [{ enabled: true, voice: { bank: 'internalA', program: 3 } }] },
    ]);
    const fresh = new SynthRack(44100);
    fresh.restoreFullState(rack.getFullState());
    expect(fresh.getPerformanceState().names).toEqual(['Test Perf']);
    expect(fresh.voiceLibrary.performances[0].parts[0].voice).toEqual({
      bank: 'internalA',
      program: 3,
    });
  });

  it('rejects an unknown schema without crashing the rack', () => {
    const rack = new SynthRack(44100);
    const bad = { ...rack.getFullState(), schema: 99 } as unknown as RackState;
    expect(() => rack.restoreFullState(bad)).toThrow(/schema/);
  });
});

describe('SynthRack.loadBankInto', () => {
  it('loads voices into an explicit half-bank and re-applies referencing parts', () => {
    const rack = loadedRack();
    // Take internalA's 32 voices and push them into cartridgeB.
    const voices: Uint8Array[] = [];
    const amems: Uint8Array[] = [];
    for (let i = 0; i < 32; i++) {
      const slot = rack.voiceLibrary.resolve({ bank: 'internalA', program: i })!;
      voices.push(slot.vmem.slice());
      amems.push(slot.amem.slice());
    }
    rack.setVoiceRefForPart(0, { bank: 'cartridgeB', program: 4 });

    rack.loadBankInto('cartridgeB', voices, amems);
    expect(rack.voiceLibrary.populatedBanks()).toEqual(['internalA', 'cartridgeB']);
    const src = rack.voiceLibrary.resolve({ bank: 'internalA', program: 4 })!;
    const dst = rack.voiceLibrary.resolve({ bank: 'cartridgeB', program: 4 })!;
    expect(Array.from(dst.vmem)).toEqual(Array.from(src.vmem));
    // Part 0 referenced cartridgeB program 4 and now sounds that voice.
    expect(Array.from(rack.getVoiceData(0))).toEqual(Array.from(src.vmem));
  });

  it('init-pads when fewer than 32 voices are supplied', () => {
    const rack = new SynthRack(44100);
    const one = rack.getVoiceData(0);
    rack.loadBankInto('internalB', [one]);
    expect(rack.voiceLibrary.populatedBanks()).toEqual(['internalB']);
    expect(rack.voiceLibrary.programNames('internalB').length).toBe(32);
  });
});
