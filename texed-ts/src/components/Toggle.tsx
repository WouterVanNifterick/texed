import { helpProps } from '../state/help';

interface ToggleProps {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  /** Description shown in the help bar while hovered. */
  help?: string;
}

export function Toggle({ label, on, onChange, help }: ToggleProps) {
  return (
    <div className="cycle" {...(help ? helpProps(label, help) : undefined)}>
      <button type="button" className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <span className="led" />
        {label}
      </button>
    </div>
  );
}
