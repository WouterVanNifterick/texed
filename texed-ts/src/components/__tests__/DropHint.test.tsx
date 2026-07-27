// The hint has to make the two drops distinguishable before either is made:
// the zone under the cursor is named, and the other one stays visible as the
// alternative rather than being hidden by whichever is active.

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DropHint } from '../DropHint';
import { readClip, resolveDrop, type DropAction } from '../../state/op-clipboard';
import { initVoice } from '@texed/dx7-format/cartridge';

const CLIP = readClip(initVoice(), new Uint8Array(35), 5);

const ENV_BOX = { offsetLeft: 8, offsetTop: 24, offsetWidth: 180, offsetHeight: 60 };

/**
 * jsdom has no layout engine, so the envelope graph's box has to be declared
 * for the hint's measurement to find one. Refs attach before layout effects, so
 * this lands in time.
 */
function sizeEnv(el: HTMLDivElement | null) {
  if (!el) return;
  for (const [prop, value] of Object.entries(ENV_BOX)) {
    Object.defineProperty(el, prop, { value, configurable: true });
  }
}

/** An operator panel laid out the way OperatorPanel lays one out. */
function panel(action: DropAction, withEnv = true) {
  const view = render(
    <section className="panel op-panel">
      {withEnv && <div className="env-editor" ref={sizeEnv} />}
      <DropHint action={action} />
    </section>,
  );
  const read = (cls: string) => {
    const el = view.container.querySelector(`.${cls}`);
    if (!el) return null;
    return {
      active: el.classList.contains('on'),
      label: el.querySelector('.drop-zone-label')?.textContent ?? null,
      tag: el.querySelector('.drop-zone-tag')?.textContent ?? null,
    };
  };
  return { view, all: read('zone-all'), env: read('zone-env') };
}

describe('DropHint zones', () => {
  it('names the panel and offers the envelope when aimed at the body', () => {
    const { all, env } = panel(resolveDrop(CLIP, 2, false, false)!);
    expect(all).toMatchObject({ active: true, label: 'Copy OP5 → OP2 · hold Alt to swap' });
    expect(env).toMatchObject({ active: false, tag: 'ENVELOPE ONLY' });
  });

  it('swaps which zone is named when aimed at the envelope', () => {
    const { all, env } = panel(resolveDrop(CLIP, 2, true, false)!);
    expect(all).toMatchObject({ active: false, tag: 'WHOLE OPERATOR' });
    expect(env).toMatchObject({ active: true, label: 'Copy OP5 envelope → OP2' });
  });

  it('keeps both zones drawn whichever one is active', () => {
    for (const overEnv of [false, true]) {
      const { view } = panel(resolveDrop(CLIP, 2, overEnv, false)!);
      expect(view.container.querySelectorAll('.drop-zone')).toHaveLength(2);
    }
  });

  it('positions the envelope zone over the graph it stands for', () => {
    const { view } = panel(resolveDrop(CLIP, 2, false, false)!);
    const style = view.container.querySelector<HTMLElement>('.zone-env')!.style;
    expect([style.left, style.top, style.width, style.height]).toEqual([
      '8px',
      '24px',
      '180px',
      '60px',
    ]);
  });

  it('stays one undivided zone when both drops would do the same thing', () => {
    // The pitch EG has no operator parameters to receive, so aiming at its graph
    // rather than its panel changes nothing and must not suggest that it does.
    const { all, env } = panel(resolveDrop(CLIP, 'pitch', false, false)!);
    expect(env).toBeNull();
    expect(all).toMatchObject({ active: true, label: 'Copy OP5 envelope → PITCH EG' });
  });

  it('falls back to one zone in the combined view, where panels have no graph', () => {
    const { all, env } = panel(resolveDrop(CLIP, 2, false, false)!, false);
    expect(env).toBeNull();
    expect(all).toMatchObject({ active: true, label: 'Copy OP5 → OP2 · hold Alt to swap' });
  });
});
