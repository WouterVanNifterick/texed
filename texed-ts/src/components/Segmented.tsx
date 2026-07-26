import { helpProps } from '../state/help';

interface SegmentedProps<T extends string> {
  label?: string;
  value: T;
  options: { value: T; label: string; help?: string }[];
  onChange: (value: T) => void;
}

/** Two-or-more-segment button group (mutually exclusive), tab-strip styled. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="segmented">
      {label && <span className="segmented-label">{label}</span>}
      <div className="segmented-group" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`seg${value === o.value ? ' on' : ''}`}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            {...(o.help ? helpProps(o.label, o.help) : undefined)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
