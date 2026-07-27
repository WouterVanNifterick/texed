// What a hovered panel offers an operator drag.
//
// An operator panel is two drop zones, not one: the envelope graph takes the EG
// alone, everything around it takes the whole operator. Both are outlined for as
// long as the drag is over the panel, and the one under the cursor is filled in
// and named, so choosing between them is a matter of aiming rather than of
// knowing. The zones are tinted rather than covered - hiding the graph would
// hide the thing being aimed at.

import { useLayoutEffect, useRef, useState } from 'react';
import type { DropAction } from '../state/op-clipboard';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

export function DropHint({ action }: { action: DropAction }) {
  const root = useRef<HTMLDivElement>(null);
  const [envBox, setEnvBox] = useState<Box | null>(null);

  // Measured rather than mirrored in CSS: the envelope graph sits in a different
  // place in the 3x2 and 1x6 layouts, and is absent altogether in the combined
  // view, where the whole panel is the only zone.
  //
  // Measuring once per hint is enough. A hint is mounted only while the drag is
  // over this panel, and nothing can change the layout underneath it in that
  // time - the view toggles are not reachable with a drag in hand.
  useLayoutEffect(() => {
    // The wrapper is a direct child of the panel, which is also the positioned
    // ancestor the offsets are measured against - so they are already the
    // coordinates this overlay needs.
    const env = action.envZone
      ? root.current?.parentElement?.querySelector<HTMLElement>('.env-editor')
      : null;
    const next =
      env && env.offsetWidth > 0 && env.offsetHeight > 0
        ? {
            left: env.offsetLeft,
            top: env.offsetTop,
            width: env.offsetWidth,
            height: env.offsetHeight,
          }
        : null;
    setEnvBox((prev) => (sameBox(prev, next) ? prev : next));
  }, [action.envZone]);

  const split = envBox !== null;
  const envActive = action.kind === 'env';
  const allActive = !split || !envActive;

  const label = (
    <span className="drop-zone-label">
      {action.label}
      {action.note && <em> · {action.note}</em>}
    </span>
  );

  return (
    <div className="drop-zones" ref={root} aria-hidden>
      <div className={`drop-zone zone-all${allActive ? ' on' : ''}`}>
        {allActive ? label : <span className="drop-zone-tag">WHOLE OPERATOR</span>}
      </div>
      {envBox && (
        <div className={`drop-zone zone-env${envActive ? ' on' : ''}`} style={envBox}>
          {envActive ? label : <span className="drop-zone-tag">ENVELOPE ONLY</span>}
        </div>
      )}
    </div>
  );
}
