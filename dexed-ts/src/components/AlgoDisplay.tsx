// Algorithm routing diagram, generated from the engine's routing table.
// Carriers are filled, modulators outlined, self-feedback shown as a loop.

import { algoGraph } from '../state/algo';

const CELL = 26;
const BOX = 17;

interface AlgoDisplayProps {
  algorithm: number; // 0..31
}

export function AlgoDisplay({ algorithm }: AlgoDisplayProps) {
  const g = algoGraph(algorithm);
  const width = g.cols * CELL + 10;
  const height = g.rows * CELL + 10;
  const cx = (x: number) => 5 + x * CELL + CELL / 2;
  const cy = (y: number) => height - 5 - y * CELL - CELL / 2;
  const pos = new Map(g.nodes.map((n) => [n.op, n]));

  return (
    <svg className="algo-display" viewBox={`0 0 ${width} ${height}`}>
      {g.edges.map(([from, to], i) => {
        const a = pos.get(from)!;
        const b = pos.get(to)!;
        return (
          <line
            key={i}
            x1={cx(a.x)}
            y1={cy(a.y) + BOX / 2}
            x2={cx(b.x)}
            y2={cy(b.y) - BOX / 2}
            className="algo-edge"
          />
        );
      })}
      {g.nodes.map((n) => (
        <g key={n.op} className={n.carrier ? 'carrier' : undefined}>
          {n.feedback && (
            <path
              d={`M ${cx(n.x) + BOX / 2} ${cy(n.y) - 3} h 5 v -${BOX / 2 + 4} h -${BOX / 2 + 5} v 4`}
              className="algo-fb"
            />
          )}
          <rect
            x={cx(n.x) - BOX / 2}
            y={cy(n.y) - BOX / 2}
            width={BOX}
            height={BOX}
            rx={3}
            className="algo-node"
          />
          <text x={cx(n.x)} y={cy(n.y) + 3.5} textAnchor="middle" className="algo-num">
            {n.num}
          </text>
        </g>
      ))}
    </svg>
  );
}
