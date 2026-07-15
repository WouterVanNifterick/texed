// Per-operator display colors (OP1..OP6), keyed by the UI operator number
// (1..6). Single source of truth, used consistently across the algorithm
// diagram, the operator panel headers, and the envelope visualizations.

export const OP_COLORS = ['#ff7a7a', '#ffb454', '#f4e46b', '#7be08a', '#5ec8ff', '#c08bff'];

/** Pitch EG color (no operator node in the algorithm). */
export const PITCH_COLOR = '#b9d8ff';

/** Color for UI operator number 1..6. */
export function opColor(opNum: number): string {
  return OP_COLORS[(opNum - 1) % OP_COLORS.length];
}
