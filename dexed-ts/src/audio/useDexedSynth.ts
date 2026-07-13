import { useCallback, useEffect, useRef, useState } from 'react';
import workletUrl from '../worklet/dexed-processor.ts?worker&url';
import { MsgType, type ToWorkletMessage, type FromWorkletMessage, type StatusMsg } from '../worklet/protocol';
import type { PartConfig, ProgramOption } from '../engine/synth-rack';
import type { VoiceRef } from '../engine/voice-library';
import type { LoadReport } from '../engine/sysex-loader';
import { initVoice } from '../engine/cartridge';
import { createDefaultAmem } from '../engine/amem';
import type { SystemSetup } from '../engine/system-setup';
import { voiceRefEquals } from '../engine/synth-rack';

export type SynthStatus = Omit<StatusMsg, 'type'>;

export interface DexedSynth {
  start: () => Promise<void>;
  ready: boolean;
  programOptions: ProgramOption[];
  programNames: string[];
  loadReport: LoadReport | null;
  voice: Uint8Array;
  /** 35-byte DX7II AMEM supplement for the selected part's voice. */
  supplement: Uint8Array;
  systemSetup: SystemSetup | null;
  masterTuneCents: number;
  noteOn: (note: number, velocity: number, channel?: number) => void;
  noteOff: (note: number, channel?: number) => void;
  controlChange: (controller: number, value: number, channel?: number) => void;
  pitchBend: (value: number, channel?: number) => void;
  aftertouch: (value: number, channel?: number) => void;
  setEngine: (engine: number) => void;
  setProgram: (index: number) => void;
  setVoiceRef: (ref: VoiceRef, partIndex?: number) => void;
  loadCart: (data: ArrayBuffer) => void;
  setParam: (offset: number, value: number) => void;
  setSupplementParam: (offset: number, value: number) => void;
  setMasterTune: (cents: number) => void;
  setVoice: (voice: Uint8Array) => void;
  setFx: (cutoff: number, reso: number, gain: number) => void;
  setMasterGain: (gain: number) => void;
  panic: () => void;
  partConfigs: PartConfig[];
  selectedPart: number;
  selectPart: (index: number) => void;
  setPart: (index: number, config: Partial<PartConfig>) => void;
  setPolyphonyCap: (cap: number) => void;
  performanceNames: string[];
  performanceIndex: number;
  selectPerformance: (index: number) => void;
  subscribeStatus: (cb: (s: SynthStatus) => void) => () => void;
}

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
  const [programOptions, setProgramOptions] = useState<ProgramOption[]>([]);
  const [loadReport, setLoadReport] = useState<LoadReport | null>(null);
  const [voice, setVoiceState] = useState<Uint8Array>(() => initVoice());
  const [supplement, setSupplementState] = useState<Uint8Array>(() => createDefaultAmem());
  const [systemSetup, setSystemSetup] = useState<SystemSetup | null>(null);
  const [masterTuneCents, setMasterTuneCents] = useState(0);
  const [partConfigs, setPartConfigs] = useState<PartConfig[]>([]);
  const [selectedPart, setSelectedPart] = useState(0);
  const [performanceNames, setPerformanceNames] = useState<string[]>([]);
  const [performanceIndex, setPerformanceIndex] = useState(0);

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
      else if (m.type === 'programNames') {
        setProgramOptions(m.names.map((label, i) => ({ ref: { bank: 'internalA', program: i }, label })));
      } else if (m.type === 'programState') {
        setProgramOptions(m.options);
      } else if (m.type === 'loadReport') {
        setLoadReport(m.report);
      } else if (m.type === 'voice') {
        setVoiceState(new Uint8Array(m.data));
        setSupplementState(new Uint8Array(m.supplement));
      } else if (m.type === 'systemSetup') {
        setSystemSetup(m.setup);
        setMasterTuneCents(m.masterTuneCents);
      } else if (m.type === 'parts') {
        setPartConfigs(m.configs);
        setSelectedPart(m.selectedPart);
      } else if (m.type === 'performances') {
        setPerformanceNames(m.names);
        setPerformanceIndex(m.index);
      } else if (m.type === 'status') {
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
    (controller: number, value: number, channel?: number) => post({ type: MsgType.Cc, controller, value, channel }),
    [post],
  );
  const pitchBend = useCallback(
    (value: number, channel?: number) => post({ type: MsgType.PitchBend, value, channel }),
    [post],
  );
  const aftertouch = useCallback(
    (value: number, channel?: number) => post({ type: MsgType.Aftertouch, value, channel }),
    [post],
  );
  const setEngine = useCallback((engine: number) => post({ type: MsgType.SetEngine, engine }), [post]);
  const setProgram = useCallback((index: number) => {
    const opt = programOptions[index];
    if (opt) {
      post({ type: MsgType.SetVoiceRef, voice: opt.ref });
    } else {
      post({ type: MsgType.SetProgram, index });
    }
  }, [post, programOptions]);
  const setVoiceRef = useCallback(
    (ref: VoiceRef, partIndex?: number) => post({ type: MsgType.SetVoiceRef, voice: ref, partIndex }),
    [post],
  );
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

  const setSupplementParam = useCallback(
    (offset: number, value: number) => {
      setSupplementState((prev) => {
        const next = new Uint8Array(prev);
        next[offset] = value;
        return next;
      });
      post({ type: MsgType.SetSupplementParam, offset, value });
    },
    [post],
  );

  const setMasterTune = useCallback(
    (cents: number) => {
      setMasterTuneCents(cents);
      post({ type: MsgType.SetMasterTune, cents });
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

  const selectPart = useCallback((index: number) => post({ type: MsgType.SelectPart, index }), [post]);
  const setPart = useCallback(
    (index: number, config: Partial<PartConfig>) => post({ type: MsgType.SetPart, index, config }),
    [post],
  );
  const setPolyphonyCap = useCallback((cap: number) => post({ type: MsgType.SetPolyphonyCap, cap }), [post]);

  const selectPerformance = useCallback(
    (index: number) => post({ type: MsgType.SelectPerformance, index }),
    [post],
  );

  const subscribeStatus = useCallback((cb: (s: SynthStatus) => void) => {
    statusSubs.current.add(cb);
    return () => statusSubs.current.delete(cb);
  }, []);

  const programNames = programOptions.map((o) => o.label);

  return {
    start,
    ready,
    programOptions,
    programNames,
    loadReport,
    voice,
    supplement,
    systemSetup,
    masterTuneCents,
    noteOn,
    noteOff,
    controlChange,
    pitchBend,
    aftertouch,
    setEngine,
    setProgram,
    setVoiceRef,
    loadCart,
    setParam,
    setSupplementParam,
    setMasterTune,
    setVoice,
    setFx,
    setMasterGain,
    panic,
    partConfigs,
    selectedPart,
    selectPart,
    setPart,
    setPolyphonyCap,
    performanceNames,
    performanceIndex,
    selectPerformance,
    subscribeStatus,
  };
}

export function programIndexForVoice(options: ProgramOption[], voice: VoiceRef): number {
  const idx = options.findIndex((o) => voiceRefEquals(o.ref, voice));
  return idx >= 0 ? idx : 0;
}
