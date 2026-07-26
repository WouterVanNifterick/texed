import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MsgType, type SynthCommand, type SynthEvent } from '@texed/synth-protocol/protocol';
import type { SynthPort } from '@texed/synth-protocol/port';
import { DEFAULT_GLOBAL_SETTINGS } from '@texed/dx7-format/global-settings';
import { G } from '@texed/dx7-format/voice-layout';
import { useSynth, type SynthActions } from '../useSynth';

/** Stands in for the worklet: records commands, replays events on demand. */
function fakePort() {
  const sent: SynthCommand[] = [];
  const listeners = new Set<(e: SynthEvent) => void>();
  const port: SynthPort = {
    start: vi.fn(() => Promise.resolve()),
    send: (cmd) => sent.push(cmd),
    onEvent: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  const emit = (e: SynthEvent) => act(() => listeners.forEach((cb) => cb(e)));
  return { port, sent, emit };
}

/** Status is fanned out on an animation frame, so let one pass. */
function nextFrame(): Promise<void> {
  return act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

const status = {
  type: 'status',
  amps: [1, 0, 0, 0, 0, 0],
  steps: [0, 4, 4, 4, 4, 4],
  levels: [0, 0, 0, 0, 0, 0],
  pitchStep: 4,
  pitchLevel: 0,
  lfo: 0,
  lfoRestart: 0,
  selectedPart: 0,
  partActivity: [1, 0, 0, 0, 0, 0, 0, 0],
  totalActive: 1,
} as const satisfies SynthEvent;

describe('useSynth', () => {
  it('turns actions into protocol commands', () => {
    const { port, sent } = fakePort();
    const { result } = renderHook(() => useSynth(port));

    act(() => {
      result.current.noteOn(60, 100);
      result.current.noteOff(60);
      result.current.setParam(G.algorithm, 7);
      result.current.selectPart(3);
      result.current.panic();
    });

    expect(sent).toEqual([
      { type: MsgType.NoteOn, note: 60, velocity: 100, channel: 1 },
      { type: MsgType.NoteOff, note: 60, channel: 1 },
      { type: MsgType.SetParam, offset: G.algorithm, value: 7 },
      { type: MsgType.SelectPart, index: 3 },
      { type: MsgType.Panic },
    ]);
  });

  it('applies a parameter edit to the mirrored voice right away', () => {
    const { port } = fakePort();
    const { result } = renderHook(() => useSynth(port));

    act(() => result.current.setParam(G.algorithm, 12));

    expect(result.current.voice[G.algorithm]).toBe(12);
  });

  it('resolves setProgram against the program list from the synth', () => {
    const { port, sent, emit } = fakePort();
    const { result } = renderHook(() => useSynth(port));
    const ref = { bank: 'internalA', program: 5 } as const;

    emit({
      type: 'programState',
      options: [
        { ref: { bank: 'internalA', program: 0 }, label: 'INT 01' },
        { ref, label: 'INT 06' },
      ],
      banks: [{ id: 'internalA', label: 'INT A', populated: true }],
    });
    act(() => result.current.setProgram(1));

    expect(sent).toEqual([{ type: MsgType.SetVoiceRef, voice: ref }]);
  });

  it('mirrors the rack state coming back from the synth', () => {
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useSynth(port));

    emit({
      type: 'settings',
      settings: { ...DEFAULT_GLOBAL_SETTINGS, volume: 42 },
      microtuningNames: ['Slendro'],
    });
    emit({ type: 'performances', names: ['A', 'B'], index: 1, name: 'B' });

    expect(result.current.settings.volume).toBe(42);
    expect(result.current.microtuningNames).toEqual(['Slendro']);
    expect(result.current.performanceIndex).toBe(1);
    expect(result.current.performanceName).toBe('B');
  });

  it('answers a bank dump request once, then forgets the callback', () => {
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useSynth(port));
    const cb = vi.fn();

    act(() => result.current.requestBankDump('internalA', cb));
    emit({ type: 'bankDump', bank: 'internalA', data: new Uint8Array([1, 2]) });
    emit({ type: 'bankDump', bank: 'internalA', data: new Uint8Array([3, 4]) });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(new Uint8Array([1, 2]));
  });

  it('fans status out once per frame, keeping only the newest', async () => {
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useSynth(port));
    const cb = vi.fn();

    result.current.subscribeStatus(cb);
    emit(status);
    emit({ ...status, totalActive: 4 });
    expect(cb).not.toHaveBeenCalled();

    await nextFrame();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].totalActive).toBe(4);
  });

  it('stops delivering status after unsubscribe', async () => {
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useSynth(port));
    const cb = vi.fn();

    const unsubscribe = result.current.subscribeStatus(cb);
    unsubscribe();
    emit(status);
    await nextFrame();

    expect(cb).not.toHaveBeenCalled();
  });

  it('keeps every action stable while the mirrored state changes', () => {
    const { port, emit } = fakePort();
    const { result } = renderHook(() => useSynth(port));
    const before = { ...result.current };

    // A voice edit plus a part change: two of the most frequent state updates.
    act(() => result.current.setParam(G.algorithm, 3));
    emit({ type: 'parts', configs: [], selectedPart: 2, voiceNames: [] });

    expect(result.current.selectedPart).toBe(2);
    expect(result.current.voice).not.toBe(before.voice);
    for (const key of Object.keys(before).filter(
      (k) => typeof before[k as keyof typeof before] === 'function',
    ) as (keyof SynthActions)[]) {
      expect(result.current[key], `${key} changed identity`).toBe(before[key]);
    }
  });
});
