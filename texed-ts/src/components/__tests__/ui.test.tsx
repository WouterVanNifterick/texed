import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Cycle, Knob, Toggle, noteLabel } from '../ui';

describe('noteLabel', () => {
  it('maps MIDI notes to names', () => {
    expect(noteLabel(60)).toBe('C4');
    expect(noteLabel(0)).toBe('C-1');
    expect(noteLabel(127)).toBe('G9');
  });
});

describe('Knob', () => {
  function renderKnob(overrides: Partial<Parameters<typeof Knob>[0]> = {}) {
    const props = { label: 'LEVEL', value: 50, max: 99, onChange: vi.fn(), ...overrides };
    render(<Knob {...props} />);
    return props;
  }

  it('exposes a slider with the current value', () => {
    renderKnob();
    const slider = screen.getByRole('slider', { name: 'LEVEL' });
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '99');
  });

  it('steps with arrow keys and jumps with Home/End', () => {
    const { onChange } = renderKnob();
    const slider = screen.getByRole('slider', { name: 'LEVEL' });
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(51);
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(49);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(99);
  });

  it('clamps keyboard steps at the range bounds', () => {
    const { onChange } = renderKnob({ value: 99 });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'LEVEL' }), { key: 'ArrowUp' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses the format override for the displayed value', () => {
    renderKnob({ value: 7, format: (v) => `+${v}` });
    expect(screen.getByRole('slider', { name: 'LEVEL' })).toHaveAttribute('aria-valuetext', '+7');
  });
});

describe('Cycle', () => {
  it('cycles forward on click and wraps around', async () => {
    const onChange = vi.fn();
    render(<Cycle label="MODE" value={2} options={['A', 'B', 'C']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'C' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });
});

describe('Toggle', () => {
  it('reports the flipped state on click', async () => {
    const onChange = vi.fn();
    render(<Toggle label="SYNC" on={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'SYNC' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
