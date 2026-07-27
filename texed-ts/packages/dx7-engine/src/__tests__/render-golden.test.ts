// Per-case hashes of rendered audio. The engines are bit-exact ports, so any
// change here is either a deliberate fidelity fix or a bug.
//
// Two suites: every algorithm on a voice whose six operators are all audible
// (so routing changes show up), and real factory voices from ROM1A (so
// envelopes, keyboard scaling and the LFO are in play). The case list is shared
// with native-null, which replays the same renders through the C++ rack.
//
// To accept a deliberate DSP change:
//   UPDATE_GOLDEN=1 pnpm vitest run render-golden
// then explain the diff in the commit message.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setEngineAccuracy } from '../synth-unit';
import { goldenCases, renderCase } from './golden-cases';

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, 'fixtures', 'render-golden.json');

function renderAll(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of goldenCases()) {
    const samples = renderCase(c);
    const hash = createHash('sha256');
    hash.update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    out[c.key] = hash.digest('hex').slice(0, 16);
  }
  setEngineAccuracy('hardware');
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
