// Per-case hashes of rendered audio. The engines are bit-exact ports, so any
// change here is either a deliberate fidelity fix or a bug.
//
// Two suites: every algorithm on a voice whose six operators are all audible
// (so routing changes show up), and real factory voices from ROM1A (so
// envelopes, keyboard scaling and the LFO are in play).
//
// To accept a deliberate DSP change:
//   UPDATE_GOLDEN=1 pnpm vitest run render-golden
// then explain the diff in the commit message.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SynthRack } from '../synth-rack';
import { initVoice } from '@texed/dx7-format/cartridge';
import { loadSysexFile } from '@texed/dx7-format/sysex-loader';
import { G, OP, opBase } from '@texed/dx7-format/voice';

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, 'fixtures', 'render-golden.json');

const ENGINES = [0, 1, 2] as const;
const ENGINE_NAMES = ['modern', 'mki', 'opl'] as const;

/** Init voice with every operator audible, so the algorithm actually matters. */
function fullVoice(algorithm: number, feedback: number): Uint8Array {
  const v = initVoice();
  for (let opNum = 1; opNum <= 6; opNum++) v[opBase(opNum) + OP.outputLevel] = 99;
  v[G.algorithm] = algorithm;
  v[G.feedback] = feedback;
  return v;
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

/** Render a fixed chord with a mid-way note-off and hash the stereo output. */
function renderHash(engine: number, voice: Uint8Array): string {
  const rack = new SynthRack(44100);
  rack.setEngineType(engine as 0 | 1 | 2);
  rack.loadVoiceForPart(0, voice);
  rack.noteOn(60, 100, 1);
  rack.noteOn(64, 90, 1);
  rack.noteOn(67, 80, 1);

  const hash = createHash('sha256');
  const l = new Float32Array(128);
  const r = new Float32Array(128);
  for (let block = 0; block < 60; block++) {
    if (block === 30) rack.noteOff(64, 1);
    rack.render(l, r, 128);
    hash.update(Buffer.from(l.buffer, 0, l.byteLength));
    hash.update(Buffer.from(r.buffer, 0, r.byteLength));
  }
  return hash.digest('hex').slice(0, 16);
}

function renderAll(): Record<string, string> {
  const out: Record<string, string> = {};
  const roms = romVoices();
  for (const engine of ENGINES) {
    const name = ENGINE_NAMES[engine];
    for (let algorithm = 0; algorithm < 32; algorithm++) {
      out[`algo/${name}/${algorithm + 1}`] = renderHash(engine, fullVoice(algorithm, 7));
    }
    roms.forEach((voice, i) => {
      out[`rom1a/${name}/${i}`] = renderHash(engine, voice);
    });
  }
  return out;
}

describe('engine render golden', () => {
  const actual = renderAll();

  if (process.env.UPDATE_GOLDEN) {
    it('rewrites the golden fixture', () => {
      writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n');
      expect(Object.keys(actual).length).toBeGreaterThan(0);
    });
    return;
  }

  const expected = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;

  it('renders every algorithm and ROM voice bit-identically', () => {
    // Compared whole so a failure lists exactly which cases moved.
    expect(actual).toEqual(expected);
  });

  it('is deterministic across runs', () => {
    expect(renderAll()).toEqual(actual);
  });

  // Guards the failure this suite shipped with for a long time: the algorithm
  // was written to a mistyped offset, so all 32 cases rendered the same sine and
  // the digest proved nothing. Mark I models per-algorithm feedback paths and
  // separates all 32; modern and OPL collapse 3/4 and 5/6, which differ only in
  // where the feedback loop sits.
  it.each([
    ['modern', 30],
    ['mki', 32],
    ['opl', 30],
  ])('varies output across algorithms on %s', (name, distinct) => {
    const hashes = Object.entries(actual)
      .filter(([k]) => k.startsWith(`algo/${name}/`))
      .map(([, v]) => v);
    expect(hashes).toHaveLength(32);
    expect(new Set(hashes).size).toBe(distinct);
  });
});
