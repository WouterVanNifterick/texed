import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefKeyControl } from '../RefKeyControl';

function renderControl(overrides: Partial<Parameters<typeof RefKeyControl>[0]> = {}) {
  const props = {
    note: 60,
    velocity: 100,
    follow: false,
    onNote: vi.fn(),
    onVelocity: vi.fn(),
    onToggleFollow: vi.fn(),
    ...overrides,
  };
  render(<RefKeyControl {...props} />);
  return props;
}

describe('RefKeyControl', () => {
  it('shows the note name for the current paint note', () => {
    renderControl({ note: 60 });
    expect(screen.getByText('C4')).toBeInTheDocument();
  });

  it('clamps typed note values to the MIDI range', () => {
    const { onNote } = renderControl();
    const [noteInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(noteInput, { target: { value: '200' } });
    expect(onNote).toHaveBeenCalledWith(127);
  });

  it('clamps velocity to at least 1', () => {
    const { onVelocity } = renderControl();
    const [, velInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(velInput, { target: { value: '0' } });
    expect(onVelocity).toHaveBeenCalledWith(1);
  });

  it('disables both inputs while FOLLOW is on', () => {
    renderControl({ follow: true });
    for (const input of screen.getAllByRole('spinbutton')) {
      expect(input).toBeDisabled();
    }
  });

  it('toggles FOLLOW', async () => {
    const { onToggleFollow } = renderControl({ follow: false });
    await userEvent.click(screen.getByRole('button', { name: 'FOLLOW' }));
    expect(onToggleFollow).toHaveBeenCalledWith(true);
  });
});
