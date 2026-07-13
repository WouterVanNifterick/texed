import { useCallback, useRef, useState } from 'react';
// The worklet is bundled into a single self-contained ES module by Vite.
import workletUrl from '../worklet/dexed-processor.ts?worker&url';
import { MsgType, type ToWorkletMessage, type FromWorkletMessage } from '../worklet/protocol';

export interface DexedSynth {
  start: () => Promise<void>;
  ready: boolean;
  programNames: string[];
  noteOn: (note: number, velocity: number, channel?: number) => void;
  noteOff: (note: number, channel?: number) => void;
  controlChange: (controller: number, value: number) => void;
  pitchBend: (value: number) => void;
  aftertouch: (value: number) => void;
  setEngine: (engine: number) => void;
  setProgram: (index: number) => void;
  loadCart: (data: ArrayBuffer) => void;
  loadVoice: (data: ArrayBuffer) => void;
  setFx: (cutoff: number, reso: number, gain: number) => void;
  setMasterGain: (gain: number) => void;
  panic: () => void;
}

export function useDexedSynth(): DexedSynth {
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const [ready, setReady] = useState(false);
  const [programNames, setProgramNames] = useState<string[]>([]);

  const post = useCallback((msg: ToWorkletMessage, transfer?: Transferable[]) => {
    nodeRef.current?.port.postMessage(msg, transfer ?? []);
  }, []);

  const start = useCallback(async () => {
    if (ctxRef.current) {
      await ctxRef.current.resume();
      return;
    }
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'dexed-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.port.onmessage = (e: MessageEvent<FromWorkletMessage>) => {
      const m = e.data;
      if (m.type === 'ready') setReady(true);
      else if (m.type === 'programNames') setProgramNames(m.names);
    };
    node.connect(ctx.destination);
    ctxRef.current = ctx;
    nodeRef.current = node;
    await ctx.resume();
  }, []);

  const noteOn = useCallback(
    (note: number, velocity: number, channel = 1) => post({ type: MsgType.NoteOn, note, velocity, channel }),
    [post],
  );
  const noteOff = useCallback(
    (note: number, channel = 1) => post({ type: MsgType.NoteOff, note, channel }),
    [post],
  );
  const controlChange = useCallback(
    (controller: number, value: number) => post({ type: MsgType.Cc, controller, value }),
    [post],
  );
  const pitchBend = useCallback((value: number) => post({ type: MsgType.PitchBend, value }), [post]);
  const aftertouch = useCallback((value: number) => post({ type: MsgType.Aftertouch, value }), [post]);
  const setEngine = useCallback((engine: number) => post({ type: MsgType.SetEngine, engine }), [post]);
  const setProgram = useCallback((index: number) => post({ type: MsgType.SetProgram, index }), [post]);
  const loadCart = useCallback((data: ArrayBuffer) => post({ type: MsgType.LoadCart, data }, [data]), [post]);
  const loadVoice = useCallback((data: ArrayBuffer) => post({ type: MsgType.LoadVoice, data }, [data]), [post]);
  const setFx = useCallback(
    (cutoff: number, reso: number, gain: number) => post({ type: MsgType.SetFx, cutoff, reso, gain }),
    [post],
  );
  const setMasterGain = useCallback((gain: number) => post({ type: MsgType.SetMasterGain, gain }), [post]);
  const panic = useCallback(() => post({ type: MsgType.Panic }), [post]);

  return {
    start,
    ready,
    programNames,
    noteOn,
    noteOff,
    controlChange,
    pitchBend,
    aftertouch,
    setEngine,
    setProgram,
    loadCart,
    loadVoice,
    setFx,
    setMasterGain,
    panic,
  };
}
