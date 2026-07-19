// Toolbar control for the reference note/velocity the envelope curves are
// painted at. Rate scaling, level scaling and velocity sensitivity all depend
// on the playing context, so the drawn shapes are pinned to one note+velocity.
// FOLLOW makes that context track the last note played.

import { helpProps } from '../state/help';
import { Toggle, noteLabel } from './ui';

interface RefKeyControlProps {
  note: number;
  velocity: number;
  follow: boolean;
  onNote: (n: number) => void;
  onVelocity: (v: number) => void;
  onToggleFollow: (on: boolean) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function RefKeyControl({ note, velocity, follow, onNote, onVelocity, onToggleFollow }: RefKeyControlProps) {
  return (
    <div className="ref-key">
      <span className="segmented-label">KEY</span>
      <label
        className="ref-key-field"
        {...helpProps('Paint note', 'MIDI note the envelope curves are drawn for — rate and level scaling depend on it.')}
      >
        <span className="ref-key-tag">NOTE</span>
        <input
          type="number"
          min={0}
          max={127}
          value={note}
          disabled={follow}
          onChange={(e) => onNote(clamp(Math.round(Number(e.target.value) || 0), 0, 127))}
        />
        <span className="ref-key-name">{noteLabel(note)}</span>
      </label>
      <label
        className="ref-key-field"
        {...helpProps('Paint velocity', 'Velocity the envelope curves are drawn for — velocity sensitivity depends on it.')}
      >
        <span className="ref-key-tag">VEL</span>
        <input
          type="number"
          min={1}
          max={127}
          value={velocity}
          disabled={follow}
          onChange={(e) => onVelocity(clamp(Math.round(Number(e.target.value) || 0), 1, 127))}
        />
      </label>
      <Toggle
        label="FOLLOW"
        on={follow}
        onChange={onToggleFollow}
        help="When on, the paint note and velocity track the last note you play."
      />
    </div>
  );
}
