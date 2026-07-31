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

export function Keyboard({
  startNote = 36,
  octaves = 5,
  onNoteOn,
  onNoteOff,
  activeNotes,
}: KeyboardProps) {
  // Keyed by pointerId so multiple simultaneous touches (multi-touch on
  // tablets/phones) each track and glide independently.
  const pressedByPointer = useRef<Map<number, number>>(new Map());

  const notes: number[] = [];
  for (let i = 0; i < octaves * 12; i++) notes.push(startNote + i);
  const whiteNotes = notes.filter((n) => !isBlack(n));
  // Precompute whites-below counts so black-key layout is O(n), not O(n²).
  const whitesBelow = new Map<number, number>();
  {
    let wi = 0;
    for (const note of notes) {
      while (wi < whiteNotes.length && whiteNotes[wi]! < note) wi++;
      if (isBlack(note)) whitesBelow.set(note, wi);
    }
  }

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
    const onDocPointerUp = (e: PointerEvent) => release(e.pointerId);
    const onDocPointerCancel = (e: PointerEvent) => release(e.pointerId);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('pointerup', onDocPointerUp);
    document.addEventListener('pointercancel', onDocPointerCancel);
    return () => {
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('pointerup', onDocPointerUp);
      document.removeEventListener('pointercancel', onDocPointerCancel);
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
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      release(e.pointerId);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      release(e.pointerId);
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
          const whiteBefore = whitesBelow.get(note) ?? 0;
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
