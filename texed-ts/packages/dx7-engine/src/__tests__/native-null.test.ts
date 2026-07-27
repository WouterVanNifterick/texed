// Null test between the two engine implementations: every render-golden case is
// rendered here and again by the C++ rack in texed-vst, and the two outputs are
// compared sample by sample. This is what keeps "the plugin sounds like the web
// app" an enforced property rather than an intention.
//
// The C++ side never parses a voice file: this test hands it decoded 156-byte
// voices, so the format code stays in TypeScript.
//
// Skipped unless the renderer has been built. To run it:
//   cmake --build texed-vst/build --target texed-render --config Release
//   pnpm vitest run native-null

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setEngineAccuracy } from '../synth-unit';
import { BLOCK, BLOCKS, goldenCases, renderCase, type GoldenCase } from './golden-cases';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..');

/**
 * The two ports evaluate the same expressions in the same precision over the
 * same fixed-point synthesis, and texed-vst builds with contraction and
 * fast-math off to keep it that way, so they currently agree exactly. Set
 * TEXED_NULL_TOLERANCE to relax this if a toolchain cannot hold it; drifting
 * silently is the thing worth catching.
 */
const MAX_ABS_DIFF = Number(process.env.TEXED_NULL_TOLERANCE ?? 0);

const VOICE_SIZE = 156;
const EVENT_RECORD = 10;
/** Two flags then nine doubles: the reverb block, send, cutoff and resonance. */
const FX_RECORD = 2 + 9 * 8;
const SAMPLES_PER_CASE = BLOCKS * BLOCK * 2;

function findRenderer(): string | null {
  const fromEnv = process.env.TEXED_RENDER;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;

  const exe = process.platform === 'win32' ? 'texed-render.exe' : 'texed-render';
  const build = join(repoRoot, 'texed-vst', 'build', 'texed-render_artefacts');
  for (const config of ['Release', 'RelWithDebInfo', 'Debug', '']) {
    const candidate = join(build, config, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The case file texed-render reads. Its reader is `renderNullCases` in
 * texed-vst/Source/render/main.cpp; the two must be changed together.
 */
function writeCaseFile(path: string, cases: GoldenCase[]): void {
  const header = 16;
  const perCase = 4 + VOICE_SIZE + FX_RECORD;
  const size = cases.reduce((n, c) => n + perCase + c.events.length * EVENT_RECORD, header);
  const buf = Buffer.alloc(size);
  buf.write('TXN2', 0, 'ascii');
  buf.writeUInt32LE(cases.length, 4);
  buf.writeUInt32LE(BLOCKS, 8);
  buf.writeUInt32LE(BLOCK, 12);

  let at = header;
  for (const c of cases) {
    buf[at] = c.accuracy === 'dexed' ? 1 : 0;
    buf[at + 1] = c.engine;
    buf.writeUInt16LE(c.events.length, at + 2);
    Buffer.from(c.voice).copy(buf, at + 4);
    at += 4 + VOICE_SIZE;

    const { reverb } = c.fx;
    buf[at] = c.fx.compressor ? 1 : 0;
    buf[at + 1] = reverb.enabled ? 1 : 0;
    const doubles = [
      reverb.size,
      reverb.hiDamp,
      reverb.loDamp,
      reverb.lowpass,
      reverb.diffusion,
      reverb.level,
      c.fx.reverbSend,
      c.fx.cutoff,
      c.fx.resonance,
    ];
    doubles.forEach((v, i) => buf.writeDoubleLE(v, at + 2 + i * 8));
    at += FX_RECORD;

    for (const e of c.events) {
      buf.writeInt32LE(e.block, at);
      buf[at + 4] = e.op;
      buf[at + 5] = e.channel;
      buf.writeInt16LE(e.a, at + 6);
      buf.writeInt16LE(e.b, at + 8);
      at += EVENT_RECORD;
    }
  }
  writeFileSync(path, buf);
}

const renderer = findRenderer();

describe.skipIf(renderer === null)('C++ rack nulls against this engine', () => {
  const cases = goldenCases();
  let native = new Float32Array(0);

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'texed-null-'));
    const casePath = join(dir, 'cases.bin');
    const pcmPath = join(dir, 'pcm.bin');

    writeCaseFile(casePath, cases);
    execFileSync(renderer as string, ['--null-cases', casePath, '--out-pcm', pcmPath]);

    const bytes = readFileSync(pcmPath);
    expect(bytes.byteLength).toBe(cases.length * SAMPLES_PER_CASE * 4);
    native = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    setEngineAccuracy('hardware');
  });

  it.each(cases.map((c, i) => [c.key, i] as const))('%s', (_key, index) => {
    const expected = renderCase(cases[index]);
    const at = index * SAMPLES_PER_CASE;

    let worst = 0;
    let worstAt = 0;
    for (let i = 0; i < SAMPLES_PER_CASE; i++) {
      const diff = Math.abs(expected[i] - native[at + i]);
      if (diff > worst) {
        worst = diff;
        worstAt = i;
      }
    }
    expect(
      worst,
      `worst at sample ${worstAt}: ts=${expected[worstAt]} cpp=${native[at + worstAt]}`,
    ).toBeLessThanOrEqual(MAX_ABS_DIFF);
  });
});
