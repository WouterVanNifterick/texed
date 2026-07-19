// Minimal Standard MIDI File reader: just enough to drive the SynthRack.
// Emits channel events with absolute times in seconds (tempo map applied).

export interface SmfEvent {
  time: number; // seconds
  kind: 'noteOn' | 'noteOff' | 'cc' | 'pitchBend' | 'aftertouch' | 'program';
  channel: number; // 1..16
  a: number; // note / controller / program / bend low 7 bits
  b: number; // velocity / value / bend high 7 bits
}

interface RawEvent {
  tick: number;
  order: number; // stable sort tiebreak: tempo changes before channel events
  tempo?: number; // microseconds per quarter note
  ev?: Omit<SmfEvent, 'time'>;
}

function u32(d: Uint8Array, o: number): number {
  return (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
}

export function parseSmf(data: Uint8Array): SmfEvent[] {
  if (u32(data, 0) !== 0x4d546864) throw new Error('not a MIDI file (missing MThd)');
  const ntrks = (data[10] << 8) | data[11];
  const division = (data[12] << 8) | data[13];
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');

  const raw: RawEvent[] = [];
  let order = 0;
  let off = 14;

  for (let t = 0; t < ntrks; t++) {
    if (u32(data, off) !== 0x4d54726b) throw new Error(`track ${t}: missing MTrk`);
    const len = u32(data, off + 4);
    let p = off + 8;
    const end = p + len;
    off = end;

    let tick = 0;
    let status = 0;

    const vlq = () => {
      let v = 0;
      for (;;) {
        const b = data[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
    };

    while (p < end) {
      tick += vlq();
      let b = data[p];
      if (b & 0x80) {
        p++;
        if (b < 0xf0) status = b;
      } else {
        b = status; // running status
      }

      if (b === 0xff) {
        const type = data[p++];
        const mlen = vlq();
        if (type === 0x51 && mlen === 3) {
          raw.push({
            tick,
            order: order++,
            tempo: (data[p] << 16) | (data[p + 1] << 8) | data[p + 2],
          });
        }
        p += mlen;
      } else if (b === 0xf0 || b === 0xf7) {
        p += vlq(); // skip SysEx payloads
      } else {
        const kind = b & 0xf0;
        const channel = (b & 0x0f) + 1;
        const a = data[p++];
        const two = kind !== 0xc0 && kind !== 0xd0;
        const v = two ? data[p++] : 0;
        const push = (k: SmfEvent['kind'], ea: number, eb: number) =>
          raw.push({ tick, order: order++, ev: { kind: k, channel, a: ea, b: eb } });
        if (kind === 0x90) push(v === 0 ? 'noteOff' : 'noteOn', a, v);
        else if (kind === 0x80) push('noteOff', a, v);
        else if (kind === 0xb0) push('cc', a, v);
        else if (kind === 0xe0) push('pitchBend', a, v);
        else if (kind === 0xd0) push('aftertouch', a, 0);
        else if (kind === 0xc0) push('program', a, 0);
      }
    }
  }

  raw.sort((x, y) => x.tick - y.tick || x.order - y.order);

  // Walk the tempo map, converting ticks to seconds.
  const out: SmfEvent[] = [];
  let usPerQuarter = 500_000; // 120 BPM default
  let lastTick = 0;
  let time = 0;
  for (const r of raw) {
    time += ((r.tick - lastTick) / division) * (usPerQuarter / 1e6);
    lastTick = r.tick;
    if (r.tempo !== undefined) usPerQuarter = r.tempo;
    else if (r.ev) out.push({ time, ...r.ev });
  }
  return out;
}
