// The processor is the one place the protocol meets the audio thread, and it
// used to be untested because it needs an AudioWorkletGlobalScope. Stubbing
// three globals is enough to drive it in Node.

import { describe, it, expect, beforeAll } from 'vitest';
import type { SynthCommand, SynthEvent, StatusMsg } from '@texed/synth-protocol/protocol';
import { MsgType } from '@texed/synth-protocol/protocol';
import { G } from '@texed/dx7-format/voice';

interface Processor {
  port: { postMessage: (m: SynthEvent) => void; onmessage?: (e: { data: SynthCommand }) => void };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

let ProcessorCtor: new () => Processor;
let posted: SynthEvent[];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = 44100;
  g.AudioWorkletProcessor = class {
    port = {
      postMessage: (m: SynthEvent) => posted.push(m),
      onmessage: undefined as ((e: { data: SynthCommand }) => void) | undefined,
    };
  };
  g.registerProcessor = (_name: string, ctor: new () => Processor) => {
    ProcessorCtor = ctor;
  };
  posted = [];
  await import('../texed-processor.ts');
});

function newProcessor() {
  posted = [];
  const p = new ProcessorCtor();
  const send = (msg: SynthCommand) => p.port.onmessage?.({ data: msg });
  const renderBlocks = (n: number) => {
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    for (let i = 0; i < n; i++) expect(p.process([], [[l, r]])).toBe(true);
    return { l, r };
  };
  return { p, send, renderBlocks };
}

const statuses = () => posted.filter((m): m is StatusMsg => m.type === 'status');

describe('TexedProcessor', () => {
  it('announces its initial state on construction', () => {
    newProcessor();
    expect(posted.map((m) => m.type)).toEqual(['voice', 'parts', 'programState', 'settings']);
  });

  it('renders audio and posts status every 12 quanta', () => {
    const { renderBlocks } = newProcessor();
    renderBlocks(11);
    expect(statuses()).toHaveLength(0);
    renderBlocks(1);
    expect(statuses()).toHaveLength(1);
    renderBlocks(12);
    expect(statuses()).toHaveLength(2);
  });

  it('reuses one status message object, so the audio thread does not allocate', () => {
    const { renderBlocks } = newProcessor();
    renderBlocks(36);
    const sent = statuses();
    expect(sent).toHaveLength(3);
    expect(sent[1]).toBe(sent[0]);
    expect(sent[2]).toBe(sent[0]);
  });

  it('fills every status field from the rack', () => {
    const { send, renderBlocks } = newProcessor();
    send({ type: MsgType.NoteOn, note: 60, velocity: 100, channel: 1 });
    renderBlocks(12);
    const s = statuses()[0];
    expect(s.amps).toHaveLength(6);
    expect(s.steps).toHaveLength(6);
    expect(s.levels).toHaveLength(6);
    expect(s.partActivity).toHaveLength(8);
    expect(s.totalActive).toBe(1);
    expect(s.selectedPart).toBe(0);
    // The note is sounding, so the carrier's envelope has left the idle stage.
    expect(s.steps[5]).toBeLessThan(4);
  });

  it('produces sound for a note and silence after panic', () => {
    const { send, renderBlocks } = newProcessor();
    send({ type: MsgType.NoteOn, note: 60, velocity: 100, channel: 1 });
    const loud = renderBlocks(8);
    expect(Math.max(...loud.l.map(Math.abs))).toBeGreaterThan(0);

    send({ type: MsgType.Panic });
    // Envelopes damp rather than cut, and the FX tail decays asymptotically, so
    // check for inaudible (below -120 dBFS) rather than exactly zero.
    const quiet = renderBlocks(40);
    expect(Math.max(...quiet.l.map(Math.abs))).toBeLessThan(1e-6);
  });

  it('applies a parameter edit without echoing a voice event back', () => {
    const { send } = newProcessor();
    posted.length = 0;
    send({ type: MsgType.SetParam, offset: G.algorithm, value: 17 });
    expect(posted).toEqual([]);

    // The edit is visible in the next full-state snapshot.
    send({ type: MsgType.GetFullState });
    const full = posted.find((m) => m.type === 'fullState');
    expect(full).toBeDefined();
  });

  it('reports why an unrecognized load failed instead of throwing', () => {
    const { send } = newProcessor();
    posted.length = 0;
    send({ type: MsgType.LoadCart, data: new Uint8Array([1, 2, 3]).buffer });
    const report = posted.find((m) => m.type === 'loadReport');
    expect(report).toBeDefined();
    expect(report?.type === 'loadReport' && report.report.skipped.length).toBeTruthy();
  });

  it('survives a mono host that supplies only one output channel', () => {
    const { p } = newProcessor();
    const mono = new Float32Array(128);
    expect(p.process([], [[mono]])).toBe(true);
  });
});
