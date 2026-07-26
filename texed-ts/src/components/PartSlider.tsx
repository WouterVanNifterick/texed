interface PartSliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
  /** Fill grows from center (for pan); default fills from the left (volume). */
  center?: boolean;
  label?: string;
}

/** Compact rack fader styled to match knobs. */
export function PartSlider({
  value,
  min,
  max,
  onChange,
  onClick,
  center = false,
  label,
}: PartSliderProps) {
  const span = max - min || 1;
  const pct = ((value - min) / span) * 100;
  const fillStyle = center
    ? { left: `${Math.min(pct, 50)}%`, width: `${Math.abs(pct - 50)}%` }
    : { left: '0%', width: `${pct}%` };

  return (
    <div className="part-slider">
      <div className="part-slider-track" aria-hidden />
      {center ? <div className="part-slider-center" aria-hidden /> : null}
      <div className="part-slider-fill" aria-hidden style={fillStyle} />
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onClick={onClick}
      />
    </div>
  );
}
