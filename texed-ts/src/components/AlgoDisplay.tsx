// Algorithm routing diagram, generated from the engine's routing table.
// Carriers are filled, modulators outlined, self-feedback shown as a loop.
// Node brightness reflects static output level plus live envelope amplitude.

import { useStatus, type SynthStatus } from '../audio/useDexedSynth';
import { OP, G, opBase } from '@texed/dx7-format/params';
import { algoGraph } from '../state/algo';
import { opColor } from '../state/op-colors';

const CELL = 26;
const BOX = 17;

type Subscribe = (cb: (s: SynthStatus) => void) => () => void;

interface AlgoDisplayProps {
  voice: Uint8Array;
  algorithm: number; // 0..31
  hoverOp: number | null; // display op number 1..6
  onHover: (opNum: number | null) => void;
  selectedOp: number | null; // display op number 1..6, or null when the pitch EG is selected
  onSelect: (opNum: number) => void;
  subscribeStatus: Subscribe;
}

export function AlgoDisplay({ voice, algorithm, hoverOp, onHover, selectedOp, onSelect, subscribeStatus }: AlgoDisplayProps) {
  const amps = useStatus(subscribeStatus, (s) => s.amps, []);
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
      {g.nodes.map((n) => {
        const base = opBase(n.num);
        const enabled = (voice[G.opEnable] & (1 << n.op)) !== 0;
        const outLevel = voice[base + OP.outputLevel];
        const staticBright = !enabled || outLevel === 0 ? 0.25 : 0.25 + (outLevel / 99) * 0.75;
        const amp = amps[n.op] ?? 0;
        const opacity = Math.min(1, staticBright + amp * 0.45);
        const glow = amp > 0.02 ? 2 + amp * 8 : 0;

        return (
          <g
            key={n.op}
            className={`${n.carrier ? 'carrier' : ''}${n.num === hoverOp ? ' hilite' : ''}${n.num === selectedOp ? ' sel' : ''}${!enabled || outLevel === 0 ? ' dim' : ''}`}
            style={{
              ['--op' as string]: opColor(n.num),
              ['--amp' as string]: amp.toFixed(3),
              opacity,
              filter: glow > 0 ? `drop-shadow(0 0 ${glow}px var(--op))` : undefined,
            }}
            onPointerEnter={() => onHover(n.num)}
            onPointerLeave={() => onHover(null)}
            onPointerDown={() => onSelect(n.num)}
          >
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
        );
      })}
    </svg>
  );
}
