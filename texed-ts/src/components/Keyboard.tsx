import { useCallback, useEffect, useRef } from 'react';

interface KeyboardProps {
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  activeNotes: Set<number>;
}

const BLACK_SEMITONES = [1, 3, 6, 8, 10];

// Five octaves from MIDI note 36. A black key is placed by the number of white
// keys below it.
const START_NOTE = 36;
const OCTAVES = 5;
const WHITE_NOTES: number[] = [];
const BLACK_KEYS: { note: number; whitesBelow: number }[] = [];
for (let note = START_NOTE; note < START_NOTE + OCTAVES * 12; note++) {
  if (BLACK_SEMITONES.includes(note % 12)) {
    BLACK_KEYS.push({ note, whitesBelow: WHITE_NOTES.length });
  } else {
    WHITE_NOTES.push(note);
  }
}
const WHITE_WIDTH = 100 / WHITE_NOTES.length;

export function Keyboard({ onNoteOn, onNoteOff, activeNotes }: KeyboardProps) {
  // Keyed by pointerId so multiple simultaneous touches (multi-touch on
  // tablets/phones) each track and glide independently.
  const pressedByPointer = useRef<Map<number, number>>(new Map());

  const press = useCallback(
    (pointerId: number, note: number) => {
      pressedByPointer.current.set(pointerId, note);
      onNoteOn(note, 100);
    },
    [onNoteOn],
  );

  const release = useCallback(
    (pointerId: number) => {
      const note = pressedByPointer.current.get(pointerId);
      if (note === undefined) return;
      pressedByPointer.current.delete(pointerId);
      onNoteOff(note);
    },
    [onNoteOff],
  );

  // Release every held key when focus leaves the window (e.g. program
  // dropdown), and release an individual pointer's key when it goes up or
  // is cancelled anywhere (not just over the key it started on).
  useEffect(() => {
    const releaseAll = () => {
      for (const note of pressedByPointer.current.values()) onNoteOff(note);
      pressedByPointer.current.clear();
    };
    const releasePointer = (e: PointerEvent) => release(e.pointerId);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('pointerup', releasePointer);
    document.addEventListener('pointercancel', releasePointer);
    return () => {
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('pointerup', releasePointer);
      document.removeEventListener('pointercancel', releasePointer);
    };
  }, [release, onNoteOff]);

  // No pointer capture, so a drag glides across keys (glissando); touch
  // captures implicitly, so release it explicitly. Each pointerId glides
  // independently, so two fingers can glissando two different keys at once.
  const keyHandlers = (note: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      press(e.pointerId, note);
    },
    onPointerEnter: (e: React.PointerEvent<HTMLButtonElement>) => {
      const current = pressedByPointer.current.get(e.pointerId);
      if (current === undefined || current === note) return;
      release(e.pointerId);
      press(e.pointerId, note);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => release(e.pointerId),
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => release(e.pointerId),
  });

  return (
    <div className="keyboard" role="group" aria-label="On-screen keyboard">
      {WHITE_NOTES.map((note, idx) => (
        <button
          key={note}
          type="button"
          className={`key white${activeNotes.has(note) ? ' active' : ''}`}
          style={{ left: `${idx * WHITE_WIDTH}%`, width: `${WHITE_WIDTH}%` }}
          aria-label={`Note ${note}`}
          {...keyHandlers(note)}
        />
      ))}
      {BLACK_KEYS.map(({ note, whitesBelow }) => (
        <button
          key={note}
          type="button"
          className={`key black${activeNotes.has(note) ? ' active' : ''}`}
          style={{
            left: `${whitesBelow * WHITE_WIDTH - WHITE_WIDTH * 0.3}%`,
            width: `${WHITE_WIDTH * 0.6}%`,
          }}
          aria-label={`Note ${note}`}
          {...keyHandlers(note)}
        />
      ))}
    </div>
  );
}
