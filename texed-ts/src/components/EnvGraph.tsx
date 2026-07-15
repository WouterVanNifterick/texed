// DX7 envelope shape (4 rates / 4 levels) as an SVG, with the currently
// active stage highlighted from the realtime status stream.
// Stage semantics match engine/env.ts: 0-2 = key-on segments, 3 = sustain
// or release, 4 = idle.

const W = 100;
const H = 34;
const PAD = 2;

interface EnvGraphProps {
  rates: number[];
  levels: number[];
  stage: number; // 0..4
  /** Taller variant (pitch EG). */
  tall?: boolean;
  /** Fill style: 'amp' fills down to level 0, 'pitch' fills to the 50 midline. */
  variant?: 'amp' | 'pitch';
}

const FILL = {
  amp: { id: 'eg-fill-amp', color: '#6ee7a0' },
  pitch: { id: 'eg-fill-pitch', color: '#7fc4ff' },
};

export function EnvGraph({ rates, levels, stage, tall, variant = 'amp' }: EnvGraphProps) {
  const y = (level: number) => H - PAD - (level / 99) * (H - 2 * PAD);
  // Segment width grows with slowness (99-rate); sustain hold is fixed.
  const w = rates.map((r) => 5 + ((99 - r) / 99) * 20);
  const sustainW = 10;
  const total = w[0] + w[1] + w[2] + sustainW + w[3];
  const sx = (W - 2 * PAD) / total;

  const xs: number[] = [PAD];
  for (const dw of [w[0], w[1], w[2], sustainW, w[3]]) {
    xs.push(xs[xs.length - 1] + dw * sx);
  }
  // Path: L4 -> L1 -> L2 -> L3 -> (hold) -> L4
  const ys = [y(levels[3]), y(levels[0]), y(levels[1]), y(levels[2]), y(levels[2]), y(levels[3])];
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');

  // Fill between the envelope and its "no effect" line: level 0 for amplitude
  // envelopes, the 50 midline for the pitch EG (50 = no pitch change).
  const fill = FILL[variant];
  const y0 = variant === 'pitch' ? y(50) : y(0);
  const fillPoints = `${xs[0].toFixed(1)},${y0.toFixed(1)} ${points} ${xs[5].toFixed(1)},${y0.toFixed(1)}`;

  // Highlight: stage 0..2 -> that segment; 3 -> sustain + release tail.
  const segFrom = stage <= 2 ? stage : 3;
  const segTo = stage <= 2 ? stage + 1 : 5;
  const active = stage >= 0 && stage <= 3;

  return (
    <svg className={`env-graph${tall ? ' tall' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={fill.id} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={H}>
          {variant === 'pitch' ? (
            <>
              <stop offset="0%" stopColor={fill.color} stopOpacity={0.4} />
              <stop offset="50%" stopColor={fill.color} stopOpacity={0.04} />
              <stop offset="100%" stopColor={fill.color} stopOpacity={0.4} />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor={fill.color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={fill.color} stopOpacity={0.03} />
            </>
          )}
        </linearGradient>
      </defs>
      <polygon className="graph-fill" fill={`url(#${fill.id})`} points={fillPoints} />
      <polyline className="env-shape" points={points} />
      {active && (
        <polyline
          className="env-active"
          points={xs
            .slice(segFrom, segTo + 1)
            .map((x, i) => `${x.toFixed(1)},${ys[segFrom + i].toFixed(1)}`)
            .join(' ')}
        />
      )}
      {xs.slice(1, 5).map((x, i) => (
        <line key={i} x1={x} y1={0} x2={x} y2={H} className="env-grid" />
      ))}
    </svg>
  );
}
