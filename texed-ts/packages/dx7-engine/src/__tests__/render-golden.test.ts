// Golden hash of rendered audio across all three engines, the feedback-heavy
// algorithms, and the meter state. The engines are bit-exact ports, so any
// change in output is either a deliberate fidelity fix or a bug.
//
// If this fails after a refactor that was meant to preserve output, the
// refactor changed the sound. If you are deliberately changing DSP behavior,
// re-run and paste the new digest, and say why in the commit message.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { SynthRack } from '../synth-rack';
import { G } from '@texed/dx7-format/voice-layout';

const EXPECTED = 'ee4d5ebbd4a4cebfb5f453d1e63434a512558bc9fcdfb20084245f1e4c2a00e7';

function renderDigest(): string {
  const hash = createHash('sha256');
  for (const engine of [0, 1, 2] as const) {
    // Algorithms 4 and 6 (0-based 3 and 5) drive the Mark I multi-op feedback paths.
    for (const algorithm of [0, 3, 5, 15, 31]) {
      for (const feedback of [0, 7]) {
        const rack = new SynthRack(44100);
        rack.setEngineType(engine);
        rack.setVoiceParamForPart(0, G.ALGORITHM, algorithm);
        rack.setVoiceParamForPart(0, G.FEEDBACK, feedback);
        rack.noteOn(60, 100, 1);
        rack.noteOn(64, 90, 1);
        rack.noteOn(67, 80, 1);

        const l = new Float32Array(128);
        const r = new Float32Array(128);
        for (let block = 0; block < 60; block++) {
          if (block === 30) rack.noteOff(64, 1);
          rack.render(l, r, 128);
          hash.update(Buffer.from(l.buffer, 0, l.byteLength));
          hash.update(Buffer.from(r.buffer, 0, r.byteLength));
        }
        const s = rack.getStatus();
        hash.update(
          Buffer.from(
            JSON.stringify([s.amps, s.steps, s.levels, s.pitchStep, s.totalActive, s.partActivity]),
          ),
        );
      }
    }
  }
  return hash.digest('hex');
}

describe('engine render golden', () => {
  it('renders bit-identical audio and meter state across all engines', () => {
    expect(renderDigest()).toBe(EXPECTED);
  });

  it('is deterministic across runs', () => {
    expect(renderDigest()).toBe(renderDigest());
  });
});
