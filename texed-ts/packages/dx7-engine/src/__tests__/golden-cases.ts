// The render cases both engine-fidelity suites share: render-golden hashes them,
// and native-null replays them through the C++ rack and compares sample values.
// Keeping the list in one place is what makes those two comparable.
//
// A case is a voice plus a script of block-timed events, so the suites cover
// more than "hold a chord": the behaviour cases drive the controllers, pedals,
// portamento and voice stealing that a note-only render never touches.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SynthRack } from '../synth-rack';
import { setEngineAccuracy, type EngineAccuracy } from '../synth-unit';
import { initVoice } from '@texed/dx7-format/cartridge';
import { loadSysexFile } from '@texed/dx7-format/sysex-loader';
import { DEFAULT_REVERB_SETTINGS, type ReverbSettings } from '@texed/dx7-format/global-settings';
import { G, OP, opBase } from '@texed/dx7-format/voice';

/** AMEM byte offsets the behaviour cases edit; see the layout table in amem.ts. */
const AMEM = {
  polyMode: 5,
  wheelPitch: 9,
  foot1Pitch: 12,
  breathPitch: 16,
  aftertouchPitch: 20,
  unisonDetune: 34,
} as const;

const here = dirname(fileURLToPath(import.meta.url));

export const ENGINES = [0, 1, 2] as const;
export const ENGINE_NAMES = ['modern', 'mki', 'opl'] as const;
export const ACCURACIES = ['hardware', 'dexed'] as const satisfies readonly EngineAccuracy[];

export const SAMPLE_RATE = 44100;
export const BLOCK = 128;
export const BLOCKS = 60;

/** Event opcodes; mirrored by `NullOp` in texed-vst/Source/render/main.cpp. */
export const Op = {
  NoteOn: 0,
  NoteOff: 1,
  Cc: 2,
  PitchBend: 3,
  Aftertouch: 4,
  SetParam: 5,
  SetSupplementParam: 6,
} as const;
export type Op = (typeof Op)[keyof typeof Op];

/** One event, applied before the render of `block`. */
export interface CaseEvent {
  block: number;
  op: Op;
  channel: number;
  a: number;
  b: number;
}

/** The effects a case renders with. */
export interface CaseFx {
  compressor: boolean;
  reverb: ReverbSettings;
  reverbSend: number;
  cutoff: number;
  resonance: number;
}

/** Dry, with the filter open: what every voice and behaviour case wants. */
export function dryFx(): CaseFx {
  return {
    compressor: false,
    reverb: { ...DEFAULT_REVERB_SETTINGS },
    reverbSend: 0,
    cutoff: 1,
    resonance: 0,
  };
}

export interface GoldenCase {
  key: string;
  accuracy: EngineAccuracy;
  engine: number;
  voice: Uint8Array;
  events: CaseEvent[];
  fx: CaseFx;
}

function ev(block: number, op: Op, a: number, b = 0, channel = 1): CaseEvent {
  return { block, op, a, b, channel };
}

/** The original suite's script: a chord with the middle note released midway. */
function chord(): CaseEvent[] {
  return [
    ev(0, Op.NoteOn, 60, 100),
    ev(0, Op.NoteOn, 64, 90),
    ev(0, Op.NoteOn, 67, 80),
    ev(30, Op.NoteOff, 64),
  ];
}

/** Init voice with every operator audible, so the algorithm actually matters. */
function fullVoice(algorithm: number, feedback: number): Uint8Array {
  const v = initVoice();
  for (let opNum = 1; opNum <= 6; opNum++) v[opBase(opNum) + OP.outputLevel] = 99;
  v[G.algorithm] = algorithm;
  v[G.feedback] = feedback;
  return v;
}

/** A voice that responds to every modulation path the behaviour cases drive. */
function modulatedVoice(): Uint8Array {
  const v = fullVoice(4, 5);
  v[G.lfoSpeed] = 40;
  v[G.lfoPmd] = 60;
  v[G.lfoAmd] = 50;
  v[G.pitchModSens] = 7;
  for (let opNum = 1; opNum <= 6; opNum++) v[opBase(opNum) + OP.ampModSens] = 3;
  return v;
}

/**
 * Open one controller's pitch / amp / EG bias ranges. Every range defaults to
 * zero, so without this the controller cases would render identical audio and
 * prove nothing.
 */
function openRanges(base: number): CaseEvent[] {
  return [
    ev(0, Op.SetSupplementParam, base, 99),
    ev(0, Op.SetSupplementParam, base + 1, 99),
    ev(0, Op.SetSupplementParam, base + 2, 70),
  ];
}

/**
 * The effects the dry cases never reach: the plate reverb, the per-part
 * compressor and the resonant ladder in PluginFx. One case each, so a failure
 * names the block that drifted.
 */
function fxScripts(): { name: string; fx: CaseFx }[] {
  const dry = dryFx();
  return [
    { name: 'reverb', fx: { ...dry, reverb: { ...dry.reverb, enabled: true }, reverbSend: 0.8 } },
    { name: 'compressor', fx: { ...dry, compressor: true } },
    { name: 'filter', fx: { ...dry, cutoff: 0.35, resonance: 0.7 } },
  ];
}

function romVoices(): Uint8Array[] {
  const bytes = new Uint8Array(readFileSync(join(here, 'fixtures', 'rom1a.syx')));
  const library = loadSysexFile(bytes).library;
  // Spread across the bank rather than the first N, which are all tuned pianos.
  return [0, 4, 9, 13, 18, 22, 27, 31].map((program) => {
    const slot = library.resolve({ bank: 'internalA', program });
    if (!slot) throw new Error(`ROM1A program ${program} missing`);
    return slot.vmem;
  });
}

/**
 * Scripts for the paths a held chord never reaches. Each runs on one voice and
 * one engine: the DSP is already covered by the sweep above, so what these are
 * pinning down is the voice and controller bookkeeping around it.
 */
function behaviourScripts(): { name: string; events: CaseEvent[] }[] {
  return [
    {
      name: 'modwheel',
      events: [
        ...openRanges(AMEM.wheelPitch),
        ev(0, Op.Cc, 1, 127),
        ...chord(),
        ev(20, Op.Cc, 1, 40),
      ],
    },
    {
      name: 'breath-foot',
      events: [
        ...openRanges(AMEM.breathPitch),
        ...openRanges(AMEM.foot1Pitch),
        ...chord(),
        ev(10, Op.Cc, 2, 100),
        ev(20, Op.Cc, 4, 90),
      ],
    },
    {
      name: 'pitchbend',
      events: [...chord(), ev(10, Op.PitchBend, 16383), ev(35, Op.PitchBend, 0)],
    },
    {
      name: 'aftertouch',
      events: [
        ...openRanges(AMEM.aftertouchPitch),
        ...chord(),
        ev(10, Op.Aftertouch, 127),
        ev(40, Op.Aftertouch, 0),
      ],
    },
    {
      // Held past the key release, then dropped: the pedal, not the note-off,
      // decides when the envelope lets go.
      name: 'sustain',
      events: [
        ev(0, Op.Cc, 64, 127),
        ev(0, Op.NoteOn, 60, 100),
        ev(10, Op.NoteOff, 60),
        ev(40, Op.Cc, 64, 0),
      ],
    },
    {
      // Sostenuto holds only what was already down, so the second note is free.
      name: 'sostenuto',
      events: [
        ev(0, Op.NoteOn, 60, 100),
        ev(5, Op.Cc, 66, 127),
        ev(10, Op.NoteOn, 64, 100),
        ev(15, Op.NoteOff, 60),
        ev(20, Op.NoteOff, 64),
        ev(45, Op.Cc, 66, 0),
      ],
    },
    {
      name: 'hold2',
      events: [ev(0, Op.Cc, 69, 127), ev(0, Op.NoteOn, 60, 100), ev(10, Op.NoteOff, 60)],
    },
    {
      name: 'portamento',
      events: [
        ev(0, Op.Cc, 65, 127),
        ev(0, Op.Cc, 5, 60),
        ev(0, Op.NoteOn, 48, 100),
        ev(15, Op.NoteOn, 67, 100),
        ev(40, Op.NoteOff, 67),
        ev(40, Op.NoteOff, 48),
      ],
    },
    {
      // Mono retrigger, then legato back down through the same voice.
      name: 'mono-legato',
      events: [
        ev(0, Op.Cc, 126, 0),
        ev(0, Op.NoteOn, 60, 100),
        ev(10, Op.NoteOn, 67, 100),
        ev(25, Op.NoteOff, 67),
        ev(45, Op.NoteOff, 60),
      ],
    },
    {
      // Unison stacks detuned voices per key, from the DX7II supplement. Byte 5
      // keeps its default pitch bend range of 2 alongside the unison bit.
      name: 'unison',
      events: [
        ev(0, Op.SetSupplementParam, AMEM.polyMode, 0x0a),
        ev(0, Op.SetSupplementParam, AMEM.unisonDetune, 5),
        ev(1, Op.NoteOn, 60, 100),
        ev(1, Op.NoteOn, 64, 100),
        ev(40, Op.NoteOff, 60),
        ev(40, Op.NoteOff, 64),
      ],
    },
    {
      // More keys than the pool holds, so the steal path runs; the release of
      // the first ones then has to find the right voices.
      name: 'steal',
      events: [
        ...Array.from({ length: 40 }, (_, i) => ev(i, Op.NoteOn, 36 + i, 100)),
        ...Array.from({ length: 40 }, (_, i) => ev(45, Op.NoteOff, 36 + i)),
      ],
    },
    {
      // A live parameter edit while notes are sounding: the voices refresh
      // against the new patch without restarting.
      name: 'live-edit',
      events: [
        ...chord(),
        ev(10, Op.SetParam, G.algorithm, 12),
        ev(20, Op.SetParam, opBase(1) + OP.freqCoarse, 3),
        ev(35, Op.SetParam, G.feedback, 7),
      ],
    },
  ];
}

/**
 * Every case, in a fixed order. Both calibrations are covered: the hardware
 * curves and rates are the default, but the msfa ones stay reachable and must
 * not drift either.
 */
export function goldenCases(): GoldenCase[] {
  const roms = romVoices();
  const cases: GoldenCase[] = [];
  for (const accuracy of ACCURACIES) {
    const prefix = accuracy === 'hardware' ? '' : `${accuracy}/`;
    for (const engine of ENGINES) {
      const name = ENGINE_NAMES[engine];
      for (let algorithm = 0; algorithm < 32; algorithm++) {
        cases.push({
          key: `${prefix}algo/${name}/${algorithm + 1}`,
          accuracy,
          engine,
          voice: fullVoice(algorithm, 7),
          events: chord(),
          fx: dryFx(),
        });
      }
      roms.forEach((voice, i) => {
        cases.push({
          key: `${prefix}rom1a/${name}/${i}`,
          accuracy,
          engine,
          voice,
          events: chord(),
          fx: dryFx(),
        });
      });
    }
    for (const script of behaviourScripts()) {
      cases.push({
        key: `${prefix}behaviour/${script.name}`,
        accuracy,
        engine: 1,
        voice: modulatedVoice(),
        events: script.events,
        fx: dryFx(),
      });
    }
    for (const script of fxScripts()) {
      cases.push({
        key: `${prefix}fx/${script.name}`,
        accuracy,
        engine: 1,
        voice: modulatedVoice(),
        events: chord(),
        fx: script.fx,
      });
    }
  }
  return cases;
}

/**
 * Render one case. Returns the stereo output as consecutive blocks of 128 left
 * samples followed by 128 right samples, which is the layout both the hash and
 * the native comparison read.
 */
export function renderCase(c: GoldenCase): Float32Array {
  setEngineAccuracy(c.accuracy);
  const rack = new SynthRack(SAMPLE_RATE);
  rack.setEngineType(c.engine as 0 | 1 | 2);
  rack.loadVoiceForPart(0, c.voice);
  rack.setCompressorEnabled(c.fx.compressor);
  rack.setReverbSettings(c.fx.reverb);
  rack.setPartConfig(0, {
    reverbSend: c.fx.reverbSend,
    cutoff: c.fx.cutoff,
    resonance: c.fx.resonance,
  });

  const out = new Float32Array(BLOCKS * BLOCK * 2);
  let next = 0;
  for (let block = 0; block < BLOCKS; block++) {
    for (; next < c.events.length && c.events[next].block <= block; next++) {
      apply(rack, c.events[next]);
    }
    const at = block * BLOCK * 2;
    rack.render(out.subarray(at, at + BLOCK), out.subarray(at + BLOCK, at + BLOCK * 2), BLOCK);
  }
  return out;
}

function apply(rack: SynthRack, e: CaseEvent): void {
  switch (e.op) {
    case Op.NoteOn:
      rack.noteOn(e.a, e.b, e.channel);
      break;
    case Op.NoteOff:
      rack.noteOff(e.a, e.channel);
      break;
    case Op.Cc:
      rack.controlChange(e.a, e.b, e.channel);
      break;
    case Op.PitchBend:
      rack.pitchBend(e.a, e.channel);
      break;
    case Op.Aftertouch:
      rack.aftertouch(e.a, e.channel);
      break;
    case Op.SetParam:
      rack.setVoiceParamForPart(0, e.a, e.b);
      break;
    case Op.SetSupplementParam:
      rack.setSupplementParamForPart(0, e.a, e.b);
      break;
  }
}
