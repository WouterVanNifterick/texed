import { helpProps } from '../state/help';

interface CycleProps {
  label: string;
  value: number;
  options: string[];
  onChange: (value: number) => void;
  /** Description shown in the help bar while hovered. */
  help?: string;
}

/** Compact enumerated selector: click cycles forward, wheel steps both ways. */
export function Cycle({ label, value, options, onChange, help }: CycleProps) {
  return (
    <div className="cycle" {...(help ? helpProps(label, help) : undefined)}>
      <div className="ctl-label">{label}</div>
      <button
        type="button"
        onClick={() => onChange((value + 1) % options.length)}
        onWheel={(e) =>
          onChange((value + (e.deltaY < 0 ? 1 : options.length - 1)) % options.length)
        }
      >
        {options[value] ?? '?'}
      </button>
    </div>
  );
}
