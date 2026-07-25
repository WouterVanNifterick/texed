// DX7II micro-tuning bulk data ("LM  MCRYE" edit / "LM  MCRYM" memory).
//
// Format (verified against a factory DX7II dump and equal-temperament ground
// truth): the 256-byte payload is 128 per-key entries, each a 14-bit big-endian
// value split into two 7-bit bytes — hi = value >> 7, lo = value & 0x7F. The
// value is the key's pitch in units of 1/1024 of an octave. Equal temperament
// is therefore value[n] = round(n * 1024 / 12); decoding it reproduces the
// engine's StandardTuning within the format's ~0.4-cent quantization.

/** Payload size of one micro-tuning table: 128 keys × 2 bytes. */
export const MICROTUNING_DATA_BYTES = 256;

/** Pitch resolution of the format: steps per octave. */
export const MICRO_UNITS_PER_OCTAVE = 1024;

/**
 * Decode a 256-byte MCRYE/MCRYM payload (name already stripped) into 128
 * per-key values in units of 1/1024 octave. Returns null if the blob is too
 * short to be a full-keyboard table.
 */
export function decodeMicrotuning(data: Uint8Array): Int32Array | null {
  if (data.length < MICROTUNING_DATA_BYTES) return null;
  const units = new Int32Array(128);
  for (let n = 0; n < 128; n++) {
    units[n] = ((data[2 * n] & 0x7f) << 7) | (data[2 * n + 1] & 0x7f);
  }
  return units;
}

/** Equal-temperament reference table in the same 1/1024-octave units. */
export function equalTemperamentUnits(): Int32Array {
  const units = new Int32Array(128);
  for (let n = 0; n < 128; n++) units[n] = Math.round((n * MICRO_UNITS_PER_OCTAVE) / 12);
  return units;
}

/** Encode 128 per-key units back into a 256-byte payload (inverse of decode). */
export function encodeMicrotuning(units: Int32Array): Uint8Array {
  const data = new Uint8Array(MICROTUNING_DATA_BYTES);
  for (let n = 0; n < 128; n++) {
    const v = units[n] ?? 0;
    data[2 * n] = (v >> 7) & 0x7f;
    data[2 * n + 1] = v & 0x7f;
  }
  return data;
}
