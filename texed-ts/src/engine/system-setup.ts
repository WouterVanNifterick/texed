// DX7II system setup memory (8973S / SYCED format).

export interface SystemSetup {
  memoryProtect: number;
  prxChannel: number;
  deviceNo: number;
  voiceBulkBlock: number;
  pgmChangeSw: number;
  aftertouchSw: number;
  pitchBendSw: number;
  noteSw: number;
  prtSw: number;
  bnk802: number;
  bnkFrac: number;
  bnkMct: number;
  masterTuning: number;
  contSw: number;
  raw: Uint8Array;
}

/** Parse 8973S payload (95 or 112 data bytes; we read the leading SYCED fields). */
export function parseSystemSetup(data: Uint8Array): SystemSetup {
  const d = data;
  return {
    memoryProtect: d[0] & 0x7f,
    prxChannel: d[1] & 0x7f,
    deviceNo: d[2] & 0x0f,
    voiceBulkBlock: d[3] & 0x7f,
    pgmChangeSw: d[4] & 0x7f,
    aftertouchSw: d[5] & 0x7f,
    pitchBendSw: d[6] & 0x7f,
    noteSw: d[7] & 0x7f,
    prtSw: d[8] & 0x7f,
    bnk802: d[9] & 0x0f,
    bnkFrac: d[10] & 0x0f,
    bnkMct: d[11] & 0x0f,
    masterTuning: d[12] & 0x7f,
    contSw: d[13] & 0x7f,
    raw: d.slice(),
  };
}

/** Convert DX7II master tuning byte (0–127, center 64) to cent offset. */
export function masterTuningCents(byte: number): number {
  return (byte - 64) * 0.78;
}

/** Extract payload from a 8973S SysEx frame. */
export function systemSetupPayloadFromFrame(raw: Uint8Array): Uint8Array | null {
  if (raw.length < 8) return null;
  const size = (raw[4] << 7) | raw[5];
  if (size <= 0 || 6 + size > raw.length) return null;
  let data = raw.subarray(6, 6 + size);
  if (raw[3] === 0x7e && data.length > 10) data = data.subarray(10);
  return data;
}
