import { useCallback, useEffect, useRef, useState } from 'react';
// The worklet is bundled into a single self-contained ES module by Vite.
import workletUrl from '../worklet/dexed-processor.ts?worker&url';
import { MsgType, type ToWorkletMessage, type FromWorkletMessage, type StatusMsg } from '../worklet/protocol';
import { initVoice } from '../engine/cartridge';

export type SynthStatus = Omit<StatusMsg, 'type'>;

export interface DexedSynth {
  start: () => Promise<void>;
  ready: boolean;
  programNames: string[];
  /** UI mirror of the engine's current 156-byte voice. */
  voice: Uint8Array;
  noteOn: (note: number, velocity: number, channel?: number) => void;
  noteOff: (note: number, channel?: number) => void;
  controlChange: (controller: number, value: number) => void;
  pitchBend: (value: number) => void;
  aftertouch: (value: number) => void;
  setEngine: (engine: number) => void;
  setProgram: (index: number) => void;
  loadCart: (data: ArrayBuffer) => void;
  /** Set one voice byte: updates the UI mirror and the engine. */
  setParam: (offset: number, value: number) => void;
  /** Replace the whole voice (e.g. after a name edit). */
  setVoice: (voice: Uint8Array) => void;
  setFx: (cutoff: number, reso: number, gain: number) => void;
  setMasterGain: (gain: number) => void;
  panic: () => void;
  /** Subscribe to the ~30 Hz realtime status stream. Returns unsubscribe. */
  subscribeStatus: (cb: (s: SynthStatus) => void) => () => void;
}

/**
 * Subscribe to the synth status stream and re-render only when the selected
 * slice changes. Keeps 30 Hz updates confined to small meter components.
 */
export function useStatus<T>(
  subscribe: (cb: (s: SynthStatus) => void) => () => void,
  selector: (s: SynthStatus) => T,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  const sel = useRef(selector);
  sel.current = selector;
  useEffect(() => subscribe((s) => setValue(sel.current(s))), [subscribe]);
  return value;
}

export function useDexedSynth(): DexedSynth {
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const statusSubs = useRef<Set<(s: SynthStatus) => void>>(new Set());
  const [ready, setReady] = useState(false);
  const [programNames, setProgramNames] = useState<string[]>([]);
  const [voice, setVoiceState] = useState<Uint8Array>(() => initVoice());

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
      else if (m.type === 'voice') setVoiceState(new Uint8Array(m.data));
      else if (m.type === 'status') {
        for (const cb of statusSubs.current) cb(m);
      }
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

  const setParam = useCallback(
    (offset: number, value: number) => {
      setVoiceState((prev) => {
        const next = new Uint8Array(prev);
        next[offset] = value;
        return next;
      });
      post({ type: MsgType.SetParam, offset, value });
    },
    [post],
  );

  const setVoice = useCallback(
    (v: Uint8Array) => {
      setVoiceState(v);
      const buf = v.slice().buffer as ArrayBuffer;
      post({ type: MsgType.LoadVoice, data: buf }, [buf]);
    },
    [post],
  );

  const setFx = useCallback(
    (cutoff: number, reso: number, gain: number) => post({ type: MsgType.SetFx, cutoff, reso, gain }),
    [post],
  );
  const setMasterGain = useCallback((gain: number) => post({ type: MsgType.SetMasterGain, gain }), [post]);
  const panic = useCallback(() => post({ type: MsgType.Panic }), [post]);

  const subscribeStatus = useCallback((cb: (s: SynthStatus) => void) => {
    statusSubs.current.add(cb);
    return () => statusSubs.current.delete(cb);
  }, []);

  return {
    start,
    ready,
    programNames,
    voice,
    noteOn,
    noteOff,
    controlChange,
    pitchBend,
    aftertouch,
    setEngine,
    setProgram,
    loadCart,
    setParam,
    setVoice,
    setFx,
    setMasterGain,
    panic,
    subscribeStatus,
  };
}
