import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SynthCommand, SynthEvent } from '@texed/synth-protocol/protocol';
import type { SynthPort } from '@texed/synth-protocol/port';
import { G, opBase, OP } from '@texed/dx7-format/voice';
import { useSynth } from '../../audio/useSynth';
import { useHistory } from '../useHistory';

const COALESCE_MS = 350;

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

function harness() {
  const { port, emit } = fakePort();
  const view = renderHook(() => {
    const synth = useSynth(port);
    return { synth, history: useHistory(synth, true) };
  });
  return { view, emit };
}

/** Let the coalescing window close so the pending edit lands in history. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(COALESCE_MS + 10);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const { view } = harness();
    expect(view.result.current.history.canUndo).toBe(false);
    expect(view.result.current.history.canRedo).toBe(false);
  });

  it('records an edit and restores the previous value', () => {
    const { view } = harness();
    const before = view.result.current.synth.voice[G.algorithm];

    act(() => view.result.current.synth.setParam(G.algorithm, 21));
    settle();
    expect(view.result.current.history.canUndo).toBe(true);

    act(() => view.result.current.history.undo());
    expect(view.result.current.synth.voice[G.algorithm]).toBe(before);
    expect(view.result.current.history.canRedo).toBe(true);
  });

  it('coalesces a burst of edits into one undo step', () => {
    const { view } = harness();
    const before = view.result.current.synth.voice[G.algorithm];

    // A drag posts a value per pointer event.
    act(() => {
      for (let v = 1; v <= 12; v++) view.result.current.synth.setParam(G.algorithm, v);
    });
    settle();

    act(() => view.result.current.history.undo());
    expect(view.result.current.synth.voice[G.algorithm]).toBe(before);
    expect(view.result.current.history.canUndo).toBe(false);
  });

  it('redo replays the undone edit', () => {
    const { view } = harness();
    act(() => view.result.current.synth.setParam(G.algorithm, 9));
    settle();

    act(() => view.result.current.history.undo());
    act(() => view.result.current.history.redo());

    expect(view.result.current.synth.voice[G.algorithm]).toBe(9);
    expect(view.result.current.history.canRedo).toBe(false);
  });

  it('walks back through several separate edits in order', () => {
    const { view } = harness();
    const level = opBase(1) + OP.outputLevel;

    for (const v of [10, 20, 30]) {
      act(() => view.result.current.synth.setParam(level, v));
      settle();
    }

    act(() => view.result.current.history.undo());
    expect(view.result.current.synth.voice[level]).toBe(20);
    act(() => view.result.current.history.undo());
    expect(view.result.current.synth.voice[level]).toBe(10);
  });

  it('drops the redo stack once a new edit is made', () => {
    const { view } = harness();
    act(() => view.result.current.synth.setParam(G.algorithm, 5));
    settle();
    act(() => view.result.current.history.undo());
    expect(view.result.current.history.canRedo).toBe(true);

    act(() => view.result.current.synth.setParam(G.feedback, 4));
    settle();
    expect(view.result.current.history.canRedo).toBe(false);
  });

  it('does not record the synth echoing back an undo', () => {
    const { view, emit } = harness();
    act(() => view.result.current.synth.setParam(G.algorithm, 14));
    settle();
    act(() => view.result.current.history.undo());

    // The worklet confirms the load by posting the same bytes back. That must not
    // look like a fresh edit, or undo would never reach further back.
    const { voice, supplement } = view.result.current.synth;
    emit({ type: 'voice', data: voice, supplement });
    settle();

    expect(view.result.current.history.canUndo).toBe(false);
    expect(view.result.current.history.canRedo).toBe(true);
  });

  it('ignores an event that does not change the bytes', () => {
    const { view, emit } = harness();
    const { voice, supplement } = view.result.current.synth;
    emit({ type: 'voice', data: voice, supplement });
    settle();
    expect(view.result.current.history.canUndo).toBe(false);
  });

  it('covers the supplement as well as the voice', () => {
    const { view } = harness();
    const before = view.result.current.synth.supplement[0];

    act(() => view.result.current.synth.setSupplementParam(0, before ^ 0x01));
    settle();
    expect(view.result.current.history.canUndo).toBe(true);

    act(() => view.result.current.history.undo());
    expect(view.result.current.synth.supplement[0]).toBe(before);
  });
});
