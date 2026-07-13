// Dexed AudioWorkletProcessor: hosts a multi-timbral SynthRack and renders
// stereo audio. A fresh rack has only part 0 enabled (omni), so single-timbre
// use is unchanged; enabling more parts gives TX802/TX816 behavior.

import { SynthRack } from '../engine/synth-rack';
import { identifySysex, SysexKind, cartridgeFromSyx, voiceFromVced } from '../engine/sysex';
import { MsgType, type ToWorkletMessage, type FromWorkletMessage } from './protocol';

// Status messages every 12 process() calls: ~31 Hz at 48 kHz / 128 frames.
const STATUS_INTERVAL = 12;

class DexedProcessor extends AudioWorkletProcessor {
  private rack: SynthRack;
  private outL = new Float32Array(128);
  private outR = new Float32Array(128);
  private statusCountdown = STATUS_INTERVAL;

  constructor() {
    super();
    this.rack = new SynthRack(sampleRate);
    this.port.onmessage = (e: MessageEvent<ToWorkletMessage>) => this.handleMessage(e.data);
    this.post({ type: 'ready' });
    this.postVoice();
    this.postParts();
  }

  private post(msg: FromWorkletMessage): void {
    this.port.postMessage(msg);
  }

  private postVoice(): void {
    this.post({ type: 'voice', data: this.rack.getVoiceData() });
  }

  private postParts(): void {
    this.post({ type: 'parts', configs: this.rack.getPartConfigs(), selectedPart: this.rack.selectedPart });
  }

  /** Dispatch a loaded .syx file: cartridge -> shared bank, voice -> selected part. */
  private handleLoad(bytes: Uint8Array): void {
    const frames = identifySysex(bytes);
    const cartFrame = frames.find((f) => f.kind === SysexKind.Cartridge);
    if (cartFrame) {
      const cart = cartridgeFromSyx(cartFrame.raw);
      if (cart) {
        this.rack.loadCartridge(cart);
        this.post({ type: 'programNames', names: this.rack.cartridgeProgramNames() });
        this.postParts();
        this.postVoice();
        return;
      }
    }
    const voiceFrame = frames.find((f) => f.kind === SysexKind.Voice);
    if (voiceFrame) {
      const v = voiceFromVced(voiceFrame.raw);
      if (v) {
        this.rack.loadVoiceForPart(this.rack.selectedPart, v);
        this.postVoice();
      }
    }
  }

  private handleMessage(msg: ToWorkletMessage): void {
    switch (msg.type) {
      case MsgType.NoteOn:
        this.rack.noteOn(msg.note, msg.velocity, msg.channel ?? 1);
        break;
      case MsgType.NoteOff:
        this.rack.noteOff(msg.note, msg.channel ?? 1);
        break;
      case MsgType.Cc:
        if (msg.channel === undefined) this.rack.controlChangeSelected(msg.controller, msg.value);
        else this.rack.controlChange(msg.controller, msg.value, msg.channel);
        break;
      case MsgType.PitchBend:
        if (msg.channel === undefined) this.rack.pitchBendSelected(msg.value);
        else this.rack.pitchBend(msg.value, msg.channel);
        break;
      case MsgType.Aftertouch:
        if (msg.channel === undefined) this.rack.aftertouchSelected(msg.value);
        else this.rack.aftertouch(msg.value, msg.channel);
        break;
      case MsgType.LoadVoice:
        this.rack.loadVoiceForPart(this.rack.selectedPart, new Uint8Array(msg.data));
        this.postVoice();
        break;
      case MsgType.LoadCart:
        this.handleLoad(new Uint8Array(msg.data));
        break;
      case MsgType.SetProgram:
        this.rack.setProgramForPart(this.rack.selectedPart, msg.index);
        this.postVoice();
        break;
      case MsgType.SetParam:
        this.rack.setVoiceParamForPart(this.rack.selectedPart, msg.offset, msg.value);
        break;
      case MsgType.SetEngine:
        this.rack.setEngineType(msg.engine as 0 | 1 | 2);
        break;
      case MsgType.SetFx:
        this.rack.setFx(msg.cutoff, msg.reso, msg.gain);
        break;
      case MsgType.SetMasterGain:
        this.rack.setMasterGain(msg.gain);
        break;
      case MsgType.Panic:
        this.rack.panic();
        break;
      case MsgType.SelectPart:
        this.rack.selectPart(msg.index);
        this.post({ type: 'programNames', names: this.rack.cartridgeProgramNames() });
        this.postParts();
        this.postVoice();
        break;
      case MsgType.SetPart:
        this.rack.setPartConfig(msg.index, msg.config);
        if (msg.config.voiceNumber !== undefined && msg.index === this.rack.selectedPart) this.postVoice();
        this.postParts();
        break;
      case MsgType.SetPolyphonyCap:
        this.rack.setPolyphonyCap(msg.cap);
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const numFrames = output[0].length;

    if (this.outL.length !== numFrames) {
      this.outL = new Float32Array(numFrames);
      this.outR = new Float32Array(numFrames);
    }
    this.rack.render(this.outL, this.outR, numFrames);

    const left = output[0];
    const right = output[1] ?? output[0];
    for (let i = 0; i < numFrames; i++) {
      left[i] = this.outL[i];
      right[i] = this.outR[i];
    }

    if (--this.statusCountdown <= 0) {
      this.statusCountdown = STATUS_INTERVAL;
      this.post({ type: 'status', ...this.rack.getStatus() });
    }
    return true;
  }
}

registerProcessor('dexed-processor', DexedProcessor as unknown as AudioWorkletProcessorCtor);
