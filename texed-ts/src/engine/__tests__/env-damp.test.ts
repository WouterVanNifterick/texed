import { describe, it, expect } from 'vitest';
import { Env } from '../env';

// Slow attack, high sustain: the level climbs gradually so a restart-from-zero
// is visibly lower than a preserved (continued) level for the first samples.
const rates = [30, 99, 99, 99];
const levels = [99, 99, 99, 99];
const OL = 99 << 5;

function raised(): Env {
  const e = new Env();
  e.init(rates, levels, OL, 0);
  for (let i = 0; i < 600; i++) e.getsample();
  return e;
}

describe('Env forced-damp support', () => {
  it('continueEnv preserves the current level (Forced Damp OFF), plain init resets it', () => {
    Env.initSr(44100);

    const cont = raised();
    const levelBefore = cont.getsample();
    cont.init(rates, levels, OL, 0, true); // continuation
    const afterContinue = cont.getsample();

    const reset = raised();
    reset.init(rates, levels, OL, 0, false); // restart from 0
    const afterReset = reset.getsample();

    // Continuation keeps the sustained level; a restart begins from the attack
    // floor, which is far lower than a fully-open envelope.
    expect(afterContinue).toBeGreaterThan(afterReset);
    expect(afterContinue).toBeGreaterThan(levelBefore * 0.5);
  });

  it('forceDamp() fades to silence and deactivates the envelope', () => {
    Env.initSr(44100);
    const e = raised();
    expect(e.isActive()).toBe(true);

    e.forceDamp();
    for (let i = 0; i < 64; i++) e.getsample();

    expect(e.isActive()).toBe(false);
    expect(e.getsample()).toBe(0);
  });
});
