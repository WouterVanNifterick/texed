// Zooming and panning the shared envelope time axis: the gestures that drive
// the view, and what the view then does to the time mapping.

import { useRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
  getEnvView,
  resetEnvView,
  useEnvZoomPan,
  zoomEnvView,
  FULL_VIEW,
} from '../../state/env-axis';
import { computeEnvTimeScale } from '../env-time';
import { initVoice } from '@texed/dx7-format/cartridge';

const WIDTH = 200;
// Matches the envelope plot: a 2% margin inside the element on each side.
const INSET = 0.02;

/** Element fraction → axis fraction, the conversion the hook has to undo. */
const onAxis = (f: number) => (f - INSET) / (1 - 2 * INSET);

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  useEnvZoomPan(ref, INSET);
  return (
    <div ref={ref} data-testid="plot">
      <button className="env-node" data-testid="node" />
    </div>
  );
}

function setup() {
  // jsdom gives every element a zero-size rect, so the plot needs a real one.
  Element.prototype.getBoundingClientRect = function () {
    return {
      left: 0,
      top: 0,
      width: WIDTH,
      height: 100,
      right: WIDTH,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  } as typeof Element.prototype.getBoundingClientRect;
  const view = render(<Probe />);
  return {
    plot: view.getByTestId('plot'),
    node: view.getByTestId('node'),
  };
}

describe('envelope zoom and pan gestures', () => {
  beforeEach(() => resetEnvView());

  // Off-centre on purpose: the midpoint is the one place a zoom that ignored
  // the cursor entirely would still look anchored.
  it.each([0.2, 0.8])('zooms on the wheel around the cursor at %s', (at) => {
    const { plot } = setup();
    const before = computeEnvTimeScale(initVoice(), 'log');

    for (let i = 0; i < 10; i++) {
      fireEvent.wheel(plot, { deltaY: -120, clientX: at * WIDTH, clientY: 50 });
    }

    const after = computeEnvTimeScale(initVoice(), 'log', 60, 99, getEnvView());
    expect(getEnvView().zoom).toBeGreaterThan(2);
    // Exactly, and after ten notches: an anchor that is off by even the plot's
    // inset re-anchors on that error every notch and walks off the pointer.
    expect(after.t(onAxis(at))).toBeCloseTo(before.t(onAxis(at)), 6);
    expect(after.t(onAxis(1 - at))).not.toBeCloseTo(before.t(onAxis(1 - at)), 1);
  });

  it('pans on a horizontal wheel and on a background drag', () => {
    const { plot } = setup();
    zoomEnvView(8, 0.5);
    const start = getEnvView().pan;

    fireEvent.wheel(plot, { deltaX: 40, deltaY: 0, clientX: 10, clientY: 50 });
    const wheeled = getEnvView().pan;
    expect(wheeled).toBeGreaterThan(start);

    // Dragging right pulls the content along, so the window moves left.
    fireEvent.pointerDown(plot, { pointerId: 1, clientX: 50, clientY: 50, buttons: 1 });
    fireEvent.pointerMove(plot, { pointerId: 1, clientX: 90, clientY: 50, buttons: 1 });
    fireEvent.pointerUp(plot, { pointerId: 1 });
    expect(getEnvView().pan).toBeLessThan(wheeled);
  });

  it('leaves node drags alone', () => {
    const { plot, node } = setup();
    zoomEnvView(8, 0.5);
    const before = getEnvView();

    fireEvent.pointerDown(node, { pointerId: 1, clientX: 50, clientY: 50, buttons: 1 });
    fireEvent.pointerMove(plot, { pointerId: 1, clientX: 120, clientY: 50, buttons: 1 });
    fireEvent.pointerUp(plot, { pointerId: 1 });

    expect(getEnvView()).toEqual(before);
  });

  it('pinches to zoom and double-clicks back to the full axis', () => {
    const { plot } = setup();

    fireEvent.pointerDown(plot, { pointerId: 1, clientX: 80, clientY: 50, buttons: 1 });
    fireEvent.pointerDown(plot, { pointerId: 2, clientX: 120, clientY: 50, buttons: 1 });
    fireEvent.pointerMove(plot, { pointerId: 1, clientX: 40, clientY: 50, buttons: 1 });
    fireEvent.pointerMove(plot, { pointerId: 2, clientX: 160, clientY: 50, buttons: 1 });
    expect(getEnvView().zoom).toBeCloseTo(3, 1);

    fireEvent.pointerUp(plot, { pointerId: 1 });
    fireEvent.pointerUp(plot, { pointerId: 2 });
    fireEvent.dblClick(plot);
    expect(getEnvView()).toEqual(FULL_VIEW);
  });
});

describe('zoomed time scale', () => {
  it('maps the window onto the plot and labels only what is visible', () => {
    const voice = initVoice();
    const full = computeEnvTimeScale(voice, 'log');
    const zoomed = computeEnvTimeScale(voice, 'log', 60, 99, { zoom: 4, pan: 0.25 });

    // The window is the second quarter of the unzoomed axis, stretched to fill.
    expect(zoomed.t(0)).toBeCloseTo(full.t(0.25), 6);
    expect(zoomed.t(1)).toBeCloseTo(full.t(0.5), 6);
    expect(zoomed.x(zoomed.t(0.5))).toBeCloseTo(0.5, 6);

    for (const gl of zoomed.gridlines) {
      expect(gl.x01).toBeGreaterThanOrEqual(0);
      expect(gl.x01).toBeLessThanOrEqual(1);
    }
    expect(zoomed.gridlines.length).toBeGreaterThan(0);
  });
});
