// Fixed status strip at the bottom of the rack: shows a description of
// whatever control the pointer is over.

import { useHelpEntry } from '../state/help';

const IDLE =
  'Hover a control for a description. Drag knobs vertically (hold Shift for fine control), scroll to step, or use arrow keys when focused.';

export function HelpBar() {
  const entry = useHelpEntry();
  return (
    <div className="help-bar">
      {entry ? (
        <>
          <span className="help-title">{entry.title}</span>
          <span className="help-text">{entry.text}</span>
        </>
      ) : (
        <span className="help-idle">{IDLE}</span>
      )}
    </div>
  );
}
