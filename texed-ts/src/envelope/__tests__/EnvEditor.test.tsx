// The editor solves a drag in fractions so the node can sit between two DX7
// steps, but the voice only ever holds whole numbers. These tests pin both ends
// of that: what is emitted, and what is drawn.

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EnvEditor } from '../EnvEditor';
import { computeEnvTimeScale } from '../env-time';
import { initVoice } from '@texed/dx7-format/cartridge';

const timeScale = computeEnvTimeScale(initVoice(), 'log');

const RATES = [70, 60, 40, 50];
const LEVELS = [99, 80, 60, 0];

/**
 * Stands in for the app: the callbacks write into the voice and the new values
 * come back down as props, which is what lets the editor tell a live fractional
 * position from a stale one.
 */
function Harness(props: {
  onSetRate: (i: number, v: number) => void;
  onSetLevel: (i: number, v: number) => void;
  onReady: (reset: (r: number[], l: number[]) => void) => void;
}) {
  const [rates, setRates] = useState([...RATES]);
  const [levels, setLevels] = useState([...LEVELS]);
  props.onReady((r, l) => {
    setRates(r);
    setLevels(l);
  });
  return (
    <EnvEditor
      kind="amp"
      rates={rates}
      levels={levels}
      ampParams={{ rates, levels, outlevel: 99 << 5, rateScaling: 0 }}
      timeScale={timeScale}
      yMode="db"
      stage={4}
      onSetRate={(i, v) => {
        props.onSetRate(i, v);
        setRates((prev) => prev.map((x, k) => (k === i ? v : x)));
      }}
      onSetLevel={(i, v) => {
        props.onSetLevel(i, v);
        setLevels((prev) => prev.map((x, k) => (k === i ? v : x)));
      }}
    />
  );
}

// jsdom gives every element a zero-size rect, so the plot needs a real one.
const PLOT = { left: 0, top: 0, width: 200, height: 100 };
function stubRects() {
  Element.prototype.getBoundingClientRect = function () {
    return { ...PLOT, right: PLOT.width, bottom: PLOT.height, x: 0, y: 0, toJSON: () => ({}) };
  } as typeof Element.prototype.getBoundingClientRect;
}

function setup() {
  stubRects();
  const onSetRate = vi.fn();
  const onSetLevel = vi.fn();
  let reset = (_r: number[], _l: number[]) => {};
  const view = render(
    <Harness
      onSetRate={onSetRate}
      onSetLevel={onSetLevel}
      onReady={(fn) => {
        reset = fn;
      }}
    />,
  );
  const plot = view.container.querySelector('.env-editor') as HTMLElement;
  const node = (s: number) => screen.getAllByRole('button')[s] as HTMLElement;
  const at = (s: number) => `${node(s).style.left}|${node(s).style.top}`;
  return {
    view,
    plot,
    node,
    at,
    onSetRate,
    onSetLevel,
    reset: (r: number[], l: number[]) => reset(r, l),
  };
}

const down = (el: HTMLElement, x: number, y: number) =>
  fireEvent.pointerDown(el, { pointerId: 1, clientX: x, clientY: y, buttons: 1 });
const move = (el: HTMLElement, x: number, y: number) =>
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y, buttons: 1 });
const up = (el: HTMLElement) => fireEvent.pointerUp(el, { pointerId: 1 });

describe('EnvEditor drag', () => {
  it('only ever emits whole numbers to the voice', () => {
    const { plot, node, onSetRate, onSetLevel } = setup();

    down(node(1), 60, 50);
    for (let i = 0; i < 20; i++) move(plot, 60 + i * 3, 30 + i * 2);
    up(plot);

    const emitted = [...onSetRate.mock.calls, ...onSetLevel.mock.calls];
    expect(emitted.length).toBeGreaterThan(0);
    for (const [i, v] of emitted) {
      expect(Number.isInteger(v), `param ${i} got ${v}`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(99);
    }
  });

  it('moves the node on a sub-step drag that emits nothing', () => {
    const { plot, node, at, onSetRate, onSetLevel } = setup();

    // Sweep the level axis a fraction of a pixel at a time. A whole level step
    // is ~1.5 dB of the ~78 dB axis, so most of these land between two of them.
    down(node(1), 100, 50);
    let movedSilently = false;
    let prev = at(1);
    for (let i = 1; i <= 24 && !movedSilently; i++) {
      onSetRate.mockClear();
      onSetLevel.mockClear();
      move(plot, 100, 50 + i * 0.25);
      const now = at(1);
      movedSilently =
        now !== prev && onSetRate.mock.calls.length === 0 && onSetLevel.mock.calls.length === 0;
      prev = now;
    }
    up(plot);

    // The whole point: the node followed the cursor to a position the integer
    // grid cannot express, and the engine was told nothing.
    expect(movedSilently).toBe(true);
  });

  it('drops the fractional position when the voice changes elsewhere', () => {
    const { plot, node, at, reset } = setup();

    const atRest = at(1);
    down(node(1), 100, 50);
    move(plot, 140, 35);
    up(plot);
    expect(at(1)).not.toBe(atRest);

    // A patch load / undo / knob edit arrives as new values. The fractional
    // position no longer rounds to them, so it retires and the node snaps back.
    act(() => reset([...RATES], [...LEVELS]));
    expect(at(1)).toBe(atRest);
  });

  it('steps on the whole-number grid with the arrow keys', () => {
    const { node, onSetRate, onSetLevel } = setup();
    fireEvent.keyDown(node(1), { key: 'ArrowUp' });
    expect(onSetLevel).toHaveBeenLastCalledWith(1, LEVELS[1] + 1);
    fireEvent.keyDown(node(1), { key: 'ArrowLeft' });
    expect(onSetRate).toHaveBeenLastCalledWith(1, RATES[1] + 1);
  });
});
