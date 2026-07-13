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
}

export function EnvGraph({ rates, levels, stage }: EnvGraphProps) {
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

  // Highlight: stage 0..2 -> that segment; 3 -> sustain + release tail.
  const segFrom = stage <= 2 ? stage : 3;
  const segTo = stage <= 2 ? stage + 1 : 5;
  const active = stage >= 0 && stage <= 3;

  return (
    <svg className="env-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
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
