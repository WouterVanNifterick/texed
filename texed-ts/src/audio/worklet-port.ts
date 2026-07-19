// SynthPort backed by the local TS engine running in an AudioWorklet.

import workletUrl from '../worklet/dexed-processor.ts?worker&url';
import type { SynthCommand, SynthEvent } from '@texed/synth-protocol/protocol';
import type { SynthPort } from '@texed/synth-protocol/port';

export class WorkletPort implements SynthPort {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private listeners = new Set<(e: SynthEvent) => void>();

  async start(): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'dexed-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.port.onmessage = (e: MessageEvent<SynthEvent>) => {
      for (const cb of this.listeners) cb(e.data);
    };
    node.connect(ctx.destination);
    this.ctx = ctx;
    this.node = node;
    await ctx.resume();
  }

  send(cmd: SynthCommand, transfer?: ArrayBuffer[]): void {
    this.node?.port.postMessage(cmd, transfer ?? []);
  }

  onEvent(cb: (e: SynthEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}
