interface PatchSelectorProps {
  programNames: string[];
  selected: number;
  onSelect: (index: number) => void;
}

export function PatchSelector({ programNames, selected, onSelect }: PatchSelectorProps) {
  return (
    <label className="control">
      <span>Patch</span>
      <select
        value={selected}
        onChange={(e) => onSelect(Number(e.target.value))}
        disabled={programNames.length === 0}
      >
        {programNames.length === 0 ? (
          <option value={0}>INIT VOICE</option>
        ) : (
          programNames.map((name, i) => (
            <option key={i} value={i}>
              {i + 1}. {name}
            </option>
          ))
        )}
      </select>
    </label>
  );
}
