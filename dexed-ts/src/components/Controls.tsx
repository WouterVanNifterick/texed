import { useRef } from 'react';

interface ControlsProps {
  engine: number;
  onEngine: (engine: number) => void;
  masterGain: number;
  onMasterGain: (gain: number) => void;
  cutoff: number;
  reso: number;
  fxGain: number;
  onFx: (cutoff: number, reso: number, gain: number) => void;
  onLoadCart: (data: ArrayBuffer) => void;
  onPanic: () => void;
}

const ENGINES = [
  { value: 0, label: 'Modern' },
  { value: 1, label: 'Mark I' },
  { value: 2, label: 'OPL' },
];

export function Controls({
  engine,
  onEngine,
  masterGain,
  onMasterGain,
  cutoff,
  reso,
  fxGain,
  onFx,
  onLoadCart,
  onPanic,
}: ControlsProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    onLoadCart(buf);
  };

  return (
    <div className="controls">
      <label className="control">
        <span>Engine</span>
        <select value={engine} onChange={(e) => onEngine(Number(e.target.value))}>
          {ENGINES.map((en) => (
            <option key={en.value} value={en.value}>
              {en.label}
            </option>
          ))}
        </select>
      </label>

      <label className="control">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterGain}
          onChange={(e) => onMasterGain(Number(e.target.value))}
        />
      </label>

      <label className="control">
        <span>Cutoff</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={cutoff}
          onChange={(e) => onFx(Number(e.target.value), reso, fxGain)}
        />
      </label>

      <label className="control">
        <span>Reso</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={reso}
          onChange={(e) => onFx(cutoff, Number(e.target.value), fxGain)}
        />
      </label>

      <div className="control">
        <span>Cartridge</span>
        <input
          ref={fileRef}
          type="file"
          accept=".syx"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      <button type="button" className="panic" onClick={onPanic}>
        Panic
      </button>
    </div>
  );
}
