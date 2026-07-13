// State layer: derive a drawable modulation graph for each of the 32 DX7
// algorithms from the engine's routing-flags table (no hardcoded layouts).

import { algorithms, FmOperatorFlags } from '../engine/fm-core';

export interface AlgoNode {
  op: number; // sysex op index 0..5 (0 = OP6)
  num: number; // display number 1..6
  x: number; // column, arbitrary units
  y: number; // 0 = carrier row (bottom), increasing upward
  carrier: boolean;
  feedback: boolean; // self-feedback loop marker
}

export interface AlgoGraph {
  nodes: AlgoNode[];
  edges: Array<[number, number]>; // [modulator op, target op] sysex indices
  cols: number;
  rows: number;
}

const graphs: AlgoGraph[] = [];

function buildGraph(alg: number): AlgoGraph {
  const flags = algorithms[alg];
  // Replay the render loop's bus bookkeeping to find modulator -> target edges.
  const busContents: number[][] = [[], [], []]; // output, buf0, buf1
  const edges: Array<[number, number]> = [];
  for (let op = 0; op < 6; op++) {
    const f = flags[op];
    const inbus = (f >> 4) & 3;
    const outbus = f & 3;
    const add = (f & FmOperatorFlags.OUT_BUS_ADD) !== 0;
    if (inbus > 0) {
      for (const src of busContents[inbus]) edges.push([src, op]);
    }
    if (!add) busContents[outbus] = [];
    busContents[outbus].push(op);
  }

  // Row: carriers at 0, each modulator one above its highest target.
  const carriers = flags.map((f) => (f & 3) === 0);
  const y = new Array<number>(6).fill(0);
  for (let op = 5; op >= 0; op--) {
    const targets = edges.filter(([m]) => m === op).map(([, t]) => t);
    if (targets.length > 0) y[op] = Math.max(...targets.map((t) => y[t])) + 1;
  }

  // Column: carriers left-to-right in display order (OP1 first), modulators
  // above their first target, nudged right until the (x, y) slot is free.
  const x = new Array<number>(6).fill(0);
  const order = [5, 4, 3, 2, 1, 0]; // display order OP1..OP6
  let nextCol = 0;
  const taken = new Set<string>();
  const place = (op: number, col: number) => {
    let c = col;
    while (taken.has(`${c},${y[op]}`)) c++;
    x[op] = c;
    taken.add(`${c},${y[op]}`);
  };
  for (const op of order) if (carriers[op]) place(op, nextCol++);
  // Modulators, lowest row first so targets are already placed.
  const mods = order.filter((op) => !carriers[op]).sort((a, b) => y[a] - y[b]);
  for (const op of mods) {
    const target = edges.find(([m]) => m === op)?.[1];
    place(op, target !== undefined ? x[target] : nextCol++);
  }

  const nodes: AlgoNode[] = [];
  for (let op = 0; op < 6; op++) {
    nodes.push({
      op,
      num: 6 - op,
      x: x[op],
      y: y[op],
      carrier: carriers[op],
      feedback: (flags[op] & 0xc0) === 0xc0,
    });
  }
  return {
    nodes,
    edges,
    cols: Math.max(...x) + 1,
    rows: Math.max(...y) + 1,
  };
}

export function algoGraph(alg: number): AlgoGraph {
  if (!graphs[alg]) graphs[alg] = buildGraph(alg);
  return graphs[alg];
}
