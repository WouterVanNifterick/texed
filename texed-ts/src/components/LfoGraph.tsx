// LFO waveform preview including the delay envelope. Timing mirrors
// engine/lfo.ts: the delay is a hold followed by a ramp, both derived from
// the same bit math; the wave itself runs during the delay but its effective
// modulation depth is gated by the ramp, which is what we draw.

import { lfoSource } from '@texed/dx7-engine/lfo';

const W = 120;
const H = 40;
const PAD = 2;
const SAMPLES = 360;
const WINDOW = 2; // seconds shown when the delay fits; extends for long delays

// Deterministic S&H steps using the engine's LCG (randstate * 179 + 17).
const SH: number[] = (() => {
  const out: number[] = [];
  let r = 0x35;
  for (let i = 0; i < 24; i++) {
    r = (r * 179 + 17) & 0xff;
    out.push(((r ^ 0x80) + 1) / 128 - 1);
  }
  return out;
})();

function wave(waveform: number, p: number): number {
  const f = p - Math.floor(p);
  switch (waveform) {
    case 0: // triangle
      return f < 0.5 ? 4 * f - 1 : 3 - 4 * f;
    case 1: // saw down
      return 1 - 2 * f;
    case 2: // saw up
      return 2 * f - 1;
    case 3: // square
      return f < 0.5 ? 1 : -1;
    case 4: // sine
      return Math.sin(2 * Math.PI * f);
    case 5: // sample & hold
      return SH[Math.floor(p) % SH.length];
    default:
      return 0;
  }
}

interface LfoGraphProps {
  waveform: number; // 0..5
  speed: number; // 0..99
  delay: number; // 0..99
}

export function LfoGraph({ waveform, speed, delay }: LfoGraphProps) {
  // Delay hold + ramp durations in seconds (see Lfo.reset: state advances by
  // unit*a per block, unit*samplerate/N ≈ 25190424, target 2^31).
  const a = 99 - Math.min(99, Math.max(0, delay));
  let hold = 0;
  let ramp = 0;
  if (a < 99) {
    const a1 = (16 + (a & 15)) << (1 + (a >> 4));
    const a2 = Math.max(a1 & 0xff80, 0x80);
    hold = 2 ** 31 / 25190424 / a1;
    ramp = 2 ** 31 / 25190424 / a2;
  }

  const period = 1 / lfoSource[Math.min(99, Math.max(0, speed))];
  // Fixed time window so speed reads as cycle density; only stretch it when
  // a long delay wouldn't fit. Cap the cycle count so fast LFOs stay readable.
  const total = Math.max(WINDOW, (hold + ramp) * 1.25);
  const drawPeriod = Math.max(period, total / 28);

  const amp = H / 2 - PAD;
  const env = (t: number) => (t < hold ? 0 : t < hold + ramp ? (t - hold) / ramp : 1);

  const pts: string[] = [];
  const envTop: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (total * i) / SAMPLES;
    const x = ((W * i) / SAMPLES).toFixed(1);
    pts.push(`${x},${(H / 2 - env(t) * wave(waveform, t / drawPeriod) * amp).toFixed(1)}`);
    envTop.push(`${x},${(H / 2 - env(t) * amp).toFixed(1)}`);
  }

  const hasDelay = hold + ramp > 0;
  const delayX = (W * (hold + ramp)) / total;

  return (
    <svg className="lfo-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      {hasDelay && <rect x={0} y={0} width={delayX} height={H} className="lfo-delay-zone" />}
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} className="scale-baseline" />
      {hasDelay && <polyline className="lfo-env" points={envTop.join(' ')} />}
      <polyline className="lfo-wave" points={pts.join(' ')} />
    </svg>
  );
}
