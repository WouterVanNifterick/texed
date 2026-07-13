// Dexed AudioWorkletProcessor: hosts the SynthUnit and renders audio.

import { SynthUnit } from '../engine/synth-unit';
import { Cartridge } from '../engine/cartridge';
import { MsgType, type ToWorkletMessage, type FromWorkletMessage } from './protocol';

class DexedProcessor extends AudioWorkletProcessor {
  private synth: SynthUnit;
  private masterGain = 0.8;
  private mono = new Float32Array(128);

  constructor() {
    super();
    this.synth = new SynthUnit(sampleRate);
    this.port.onmessage = (e: MessageEvent<ToWorkletMessage>) => this.handleMessage(e.data);
    this.post({ type: 'ready' });
  }

  private post(msg: FromWorkletMessage): void {
    this.port.postMessage(msg);
  }

  private handleMessage(msg: ToWorkletMessage): void {
    switch (msg.type) {
      case MsgType.NoteOn:
        this.synth.noteOn(msg.note, msg.velocity, msg.channel ?? 1);
        break;
      case MsgType.NoteOff:
        this.synth.noteOff(msg.note, msg.channel ?? 1);
        break;
      case MsgType.Cc:
        this.synth.controlChange(msg.controller, msg.value);
        break;
      case MsgType.PitchBend:
        this.synth.pitchBend(msg.value);
        break;
      case MsgType.Aftertouch:
        this.synth.aftertouch(msg.value);
        break;
      case MsgType.LoadVoice:
        this.synth.loadVoice(new Uint8Array(msg.data));
        break;
      case MsgType.LoadCart: {
        const cart = Cartridge.fromSyx(new Uint8Array(msg.data));
        if (cart) {
          this.synth.loadCartridge(cart);
          this.synth.setProgram(0);
          this.post({ type: 'programNames', names: this.synth.cartridgeProgramNames() });
        }
        break;
      }
      case MsgType.SetProgram:
        this.synth.setProgram(msg.index);
        break;
      case MsgType.SetEngine:
        this.synth.setEngineType(msg.engine as 0 | 1 | 2);
        break;
      case MsgType.SetFx:
        this.synth.fxParams.uiCutoff = msg.cutoff;
        this.synth.fxParams.uiReso = msg.reso;
        this.synth.fxParams.uiGain = msg.gain;
        break;
      case MsgType.SetMasterGain:
        this.masterGain = msg.gain;
        break;
      case MsgType.Panic:
        this.synth.panic();
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const numFrames = output[0].length;

    if (this.mono.length !== numFrames) {
      this.mono = new Float32Array(numFrames);
    }
    const mono = this.mono;
    mono.fill(0);
    this.synth.render(mono, numFrames);

    const gain = this.masterGain;
    for (let ch = 0; ch < output.length; ch++) {
      const out = output[ch];
      for (let i = 0; i < numFrames; i++) {
        out[i] = mono[i] * gain;
      }
    }
    return true;
  }
}

registerProcessor('dexed-processor', DexedProcessor as unknown as AudioWorkletProcessorCtor);
