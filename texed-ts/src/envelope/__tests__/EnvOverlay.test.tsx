// The combined view follows every envelope at once: the edited one draws its
// own dot in the editor, and the six background traces get theirs from a single
// status subscription.

import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { EnvOverlay } from '../EnvOverlay';
import { computeEnvTimeScale } from '../env-time';
import { initVoice } from '@texed/dx7-format/cartridge';
import type { SynthStatus } from '../../audio/useSynth';

const IDLE_STAGE = 4;

function status(over: Partial<SynthStatus> = {}): SynthStatus {
  return {
    amps: [0, 0, 0, 0, 0, 0],
    steps: [1, 1, 1, 1, 1, 1],
    levels: [1 << 23, 1 << 23, 1 << 23, 1 << 23, 1 << 23, 1 << 23],
    pitchStep: 1,
    pitchLevel: 0,
    lfo: 0,
    lfoRestart: 0,
    selectedPart: 0,
    partActivity: [0],
    totalActive: 1,
    ...over,
  };
}

function setup() {
  const voice = initVoice();
  // The editor subscribes too, so the fake stream has to fan out like the real one.
  const subs = new Set<(s: SynthStatus) => void>();
  const view = render(
    <EnvOverlay
      voice={voice}
      timeScale={computeEnvTimeScale(voice, 'log')}
      yMode="db"
      selected={1}
      onSelect={() => {}}
      setParam={() => {}}
      subscribeStatus={(cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
      }}
      hoverOp={null}
      onHoverOp={() => {}}
      note={60}
      velocity={99}
    />,
  );
  return {
    send: (s: SynthStatus) => act(() => subs.forEach((cb) => cb(s))),
    dots: () => view.container.querySelectorAll('.env-playhead.bg').length,
  };
}

describe('EnvOverlay playback dots', () => {
  it('follows every envelope except the one being edited', () => {
    const { send, dots } = setup();
    expect(dots()).toBe(0); // nothing playing yet

    send(status());
    // Five unselected operators plus the pitch EG; OP1 is the editor's own dot.
    expect(dots()).toBe(6);
  });

  it('drops the dots for envelopes that have finished', () => {
    const { send, dots } = setup();

    // Engine order is the reverse of the UI numbering, so this leaves OP6 and
    // OP1 sounding - and OP1 is the edited one, which draws its own dot.
    send(status({ steps: [1, IDLE_STAGE, IDLE_STAGE, IDLE_STAGE, IDLE_STAGE, 1] }));
    expect(dots()).toBe(2); // OP6 plus the pitch EG

    send(status({ steps: Array(6).fill(IDLE_STAGE), pitchStep: IDLE_STAGE }));
    expect(dots()).toBe(0);
  });
});
