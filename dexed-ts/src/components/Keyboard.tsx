import { useCallback, useEffect, useRef } from 'react';

interface KeyboardProps {
  startNote?: number;
  octaves?: number;
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  activeNotes: Set<number>;
}

const BLACK_SEMITONES = [1, 3, 6, 8, 10];

function isBlack(semitone: number): boolean {
  return BLACK_SEMITONES.includes(semitone % 12);
}

export function Keyboard({ startNote = 48, octaves = 4, onNoteOn, onNoteOff, activeNotes }: KeyboardProps) {
  const pressed = useRef<number | null>(null);
  const dragging = useRef(false);

  const notes: number[] = [];
  for (let i = 0; i < octaves * 12; i++) notes.push(startNote + i);
  const whiteNotes = notes.filter((n) => !isBlack(n));

  const press = useCallback(
    (note: number) => {
      pressed.current = note;
      onNoteOn(note, 100);
    },
    [onNoteOn],
  );

  const release = useCallback(
    (note: number) => {
      if (pressed.current === note) pressed.current = null;
      onNoteOff(note);
    },
    [onNoteOff],
  );

  // Release the held key when the pointer goes up anywhere or focus leaves
  // the window (e.g. program dropdown).
  useEffect(() => {
    const releaseHeld = () => {
      dragging.current = false;
      const note = pressed.current;
      if (note !== null) release(note);
    };
    window.addEventListener('blur', releaseHeld);
    document.addEventListener('pointerup', releaseHeld);
    return () => {
      window.removeEventListener('blur', releaseHeld);
      document.removeEventListener('pointerup', releaseHeld);
    };
  }, [release]);

  // No pointer capture, so a drag glides across keys (glissando); touch
  // captures implicitly, so release it explicitly.
  const keyHandlers = (note: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      dragging.current = true;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      press(note);
    },
    onPointerEnter: () => {
      if (!dragging.current || pressed.current === note) return;
      if (pressed.current !== null) release(pressed.current);
      press(note);
    },
    onPointerUp: () => {
      dragging.current = false;
      release(note);
    },
    onPointerCancel: () => {
      dragging.current = false;
      release(note);
    },
  });

  const whiteWidth = 100 / whiteNotes.length;

  return (
    <div className="keyboard" role="group" aria-label="On-screen keyboard">
      {/* White keys */}
      {whiteNotes.map((note, idx) => (
        <button
          key={note}
          type="button"
          className={`key white${activeNotes.has(note) ? ' active' : ''}`}
          style={{ left: `${idx * whiteWidth}%`, width: `${whiteWidth}%` }}
          aria-label={`Note ${note}`}
          {...keyHandlers(note)}
        />
      ))}
      {/* Black keys */}
      {notes
        .filter((n) => isBlack(n))
        .map((note) => {
          // position relative to the white key before it
          const whiteBefore = whiteNotes.filter((w) => w < note).length;
          const left = whiteBefore * whiteWidth - whiteWidth * 0.3;
          return (
            <button
              key={note}
              type="button"
              className={`key black${activeNotes.has(note) ? ' active' : ''}`}
              style={{ left: `${left}%`, width: `${whiteWidth * 0.6}%` }}
              aria-label={`Note ${note}`}
              {...keyHandlers(note)}
            />
          );
        })}
    </div>
  );
}
