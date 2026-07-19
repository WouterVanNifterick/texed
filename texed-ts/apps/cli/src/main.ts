// Headless Texed host: render a Standard MIDI File through the DX7 engine to WAV.
//
//   pnpm cli <file.mid> [--syx bank.syx] [--out out.wav] [--rate 48000] [--program n]
//
// The same SynthRack that runs in the browser's AudioWorklet renders here in
// Node - no DOM, no audio device, just Float32Arrays in and a WAV out.

import { readFileSync, writeFileSync } from 'node:fs';
import { SynthRack, NUM_PARTS } from '@texed/dx7-engine/synth-rack';
import { loadSysexFile } from '@texed/dx7-format/sysex-loader';
import { parseSmf } from './smf';
import { encodeWavStereo16 } from './wav';

const BLOCK = 128;
const MAX_TAIL_SEC = 20;

function fail(msg: string): never {
  console.error(`texed-cli: ${msg}`);
  process.exit(1);
}

// --- args ---
const args = process.argv.slice(2);
let midiPath = '';
let syxPath = '';
let outPath = '';
let rate = 48000;
let initialProgram = -1;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--syx') syxPath = args[++i] ?? '';
  else if (a === '--out') outPath = args[++i] ?? '';
  else if (a === '--rate') rate = Number(args[++i]) || 48000;
  else if (a === '--program') initialProgram = Number(args[++i]) || 0;
  else if (!a.startsWith('-')) midiPath = a;
  else fail(`unknown option ${a}`);
}
if (!midiPath)
  fail('usage: texed-cli <file.mid> [--syx bank.syx] [--out out.wav] [--rate 48000] [--program n]');
if (!outPath) outPath = midiPath.replace(/\.midi?$/i, '') + '.wav';

// --- engine setup ---
const rack = new SynthRack(rate);

if (syxPath) {
  const result = loadSysexFile(new Uint8Array(readFileSync(syxPath)));
  if (result.loaded) {
    rack.loadLibrary(result.library, result.report);
    for (const line of result.report.applied) console.log(`syx: ${line}`);
  } else if (result.singleVoice) {
    rack.loadVoiceForPart(0, result.singleVoice);
    console.log('syx: loaded single voice');
  } else {
    fail(`nothing recognized in ${syxPath}: ${result.report.skipped.join('; ')}`);
  }
}

const events = parseSmf(new Uint8Array(readFileSync(midiPath)));
if (events.length === 0) fail('MIDI file contains no channel events');

// One part per MIDI channel present (first 8 channels win), like a TX816.
const channels: number[] = [];
for (const e of events) if (!channels.includes(e.channel)) channels.push(e.channel);
const partForChannel = new Map<number, number>();
for (let i = 0; i < NUM_PARTS; i++) {
  const ch = channels[i];
  rack.setPartConfig(i, ch !== undefined ? { enabled: true, rxChannel: ch } : { enabled: false });
  if (ch !== undefined) partForChannel.set(ch, i);
}
if (channels.length > NUM_PARTS) {
  console.warn(`warning: ${channels.length} MIDI channels, only the first ${NUM_PARTS} are played`);
}

const programs = rack.programOptions();
const setProgram = (part: number, program: number) => {
  const opt = programs[program];
  if (opt) rack.setVoiceRefForPart(part, opt.ref);
};
if (initialProgram >= 0)
  for (const part of partForChannel.values()) setProgram(part, initialProgram);

// --- render ---
const lastEventTime = events[events.length - 1].time;
const outL: Float32Array[] = [];
const outR: Float32Array[] = [];
const bufL = new Float32Array(BLOCK);
const bufR = new Float32Array(BLOCK);
let peak = 0;
let frames = 0;
let eventIndex = 0;

const renderBlock = () => {
  rack.render(bufL, bufR, BLOCK);
  outL.push(bufL.slice());
  outR.push(bufR.slice());
  for (let i = 0; i < BLOCK; i++) {
    const m = Math.max(Math.abs(bufL[i]), Math.abs(bufR[i]));
    if (m > peak) peak = m;
  }
  frames += BLOCK;
};

while (eventIndex < events.length) {
  const blockEnd = (frames + BLOCK) / rate;
  while (eventIndex < events.length && events[eventIndex].time < blockEnd) {
    const e = events[eventIndex++];
    if (e.kind === 'noteOn') rack.noteOn(e.a, e.b, e.channel);
    else if (e.kind === 'noteOff') rack.noteOff(e.a, e.channel);
    else if (e.kind === 'cc') rack.controlChange(e.a, e.b, e.channel);
    else if (e.kind === 'pitchBend') rack.pitchBend(e.a | (e.b << 7), e.channel);
    else if (e.kind === 'aftertouch') rack.aftertouch(e.a, e.channel);
    else if (e.kind === 'program') setProgram(partForChannel.get(e.channel) ?? 0, e.a);
  }
  renderBlock();
}

// Let releases ring out, then pad a touch of silence.
const tailLimit = frames + MAX_TAIL_SEC * rate;
while (rack.getStatus().totalActive > 0 && frames < tailLimit) renderBlock();
for (let i = 0; i < Math.ceil((0.2 * rate) / BLOCK); i++) renderBlock();

// --- write ---
const left = new Float32Array(frames);
const right = new Float32Array(frames);
for (let i = 0; i < outL.length; i++) {
  left.set(outL[i], i * BLOCK);
  right.set(outR[i], i * BLOCK);
}
writeFileSync(outPath, encodeWavStereo16(left, right, rate));
console.log(
  `${outPath}: ${(frames / rate).toFixed(2)}s (${lastEventTime.toFixed(2)}s of MIDI), ` +
    `${channels.length} channel(s), peak ${peak.toFixed(3)}${peak >= 1 ? ' (CLIPPED)' : ''}`,
);
