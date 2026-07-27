// Single-timbre synth: one Part plus the global Dexed FX filter and the
// block render loop. A thin wrapper around Part (which owns all voice
// management and the mono render), used by the engine tests as a simple
// harness. Production hosting lives in SynthRack.

import { Freqlut } from './freqlut';
import { Lfo } from './lfo';
import { PitchEnv } from './pitchenv';
import { Env } from './env';
import { Porta } from './porta';
import { Sin } from './sin';
import { Exp2, Tanh } from './exp2';
import { PluginFx } from './plugin-fx';
import { Part, MAX_ACTIVE_NOTES, EngineType, type PartStatus } from './part';
import { setEngineAccuracyMode, type EngineAccuracy } from './engine-accuracy';

export { MAX_ACTIVE_NOTES, EngineType };

let tablesInited = false;
function initTablesOnce(): void {
  if (tablesInited) return;
  Exp2.init();
  Tanh.init();
  Sin.init();
  tablesInited = true;
}

let lastSampleRate = 44100;

/** Initialize the shared, sample-rate-dependent DSP tables. Safe to call once
 * per sample rate; SynthRack calls this too so tables are ready for its parts. */
export function initSynthTables(sampleRate: number): void {
  initTablesOnce();
  lastSampleRate = sampleRate;
  Freqlut.init(sampleRate);
  Lfo.init(sampleRate);
  PitchEnv.init(sampleRate);
  Env.initSr(sampleRate);
  Porta.initSr(sampleRate);
}

/**
 * Switch between the hardware-derived and msfa calibrations. The LFO, pitch EG
 * and portamento tables are built at init time, so changing the mode rebuilds
 * them at the current sample rate.
 */
export function setEngineAccuracy(mode: EngineAccuracy): void {
  if (setEngineAccuracyMode(mode)) initSynthTables(lastSampleRate);
}

export { getEngineAccuracy, type EngineAccuracy } from './engine-accuracy';

export class SynthUnit {
  private part = new Part();
  private fx = new PluginFx();

  constructor(sampleRate: number) {
    initTablesOnce();
    this.setSampleRate(sampleRate);
  }

  setSampleRate(sampleRate: number): void {
    Freqlut.init(sampleRate);
    Lfo.init(sampleRate);
    PitchEnv.init(sampleRate);
    Env.initSr(sampleRate);
    Porta.initSr(sampleRate);
    this.fx.init(sampleRate);
  }

  setEngineType(type: EngineType): void {
    this.part.setEngineType(type);
  }

  loadVoice(patch: Uint8Array): void {
    this.part.loadVoice(patch);
  }

  setVoiceParam(offset: number, value: number): void {
    this.part.setVoiceParam(offset, value);
  }

  getVoiceData(): Uint8Array {
    return this.part.getVoiceData();
  }

  noteOn(pitch: number, velocity: number, channel = 1): void {
    this.part.noteOn(pitch, velocity, channel);
  }

  noteOff(pitch: number, channel = 1): void {
    this.part.noteOff(pitch, channel);
  }

  controlChange(ctrl: number, value: number): void {
    this.part.controlChange(ctrl, value);
  }

  aftertouch(value: number): void {
    this.part.aftertouch(value);
  }

  pitchBend(value14: number): void {
    this.part.pitchBend(value14);
  }

  panic(): void {
    this.part.panic();
  }

  getStatus(): PartStatus {
    return this.part.getStatus();
  }

  /** Render `numSamples` mono samples into `channelData` and apply global FX. */
  render(channelData: Float32Array, numSamples: number): void {
    this.part.render(channelData, numSamples);
    this.fx.process(channelData, numSamples);
  }
}
