// Dexed AudioWorkletProcessor: hosts a multi-timbral SynthRack and renders
// stereo audio. A fresh rack has only part 0 enabled (omni), so single-timbre
// use is unchanged; enabling more parts gives TX802/TX816 behavior.

import { SynthRack } from '../engine/synth-rack';
import { identifySysex, SysexKind, voiceFromVced } from '../engine/sysex';
import { loadSysexFile, applySystemSetupToParts } from '../engine/sysex-loader';
import { MsgType, type ToWorkletMessage, type FromWorkletMessage } from './protocol';

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
    this.postVoice();
    this.postParts();
    this.postProgramState();
    this.postMasterTune();
  }

  private post(msg: FromWorkletMessage): void {
    this.port.postMessage(msg);
  }

  private postVoice(): void {
    this.post({ type: 'voice', data: this.rack.getVoiceData(), supplement: this.rack.getSupplementData() });
  }

  private postMasterTune(): void {
    this.post({ type: 'masterTune', cents: this.rack.masterTuneCents });
  }

  private postParts(): void {
    this.post({ type: 'parts', configs: this.rack.getPartConfigs(), selectedPart: this.rack.selectedPart });
  }

  private postPerformances(): void {
    const { names, index } = this.rack.getPerformanceState();
    this.post({ type: 'performances', names, index });
  }

  private postProgramState(): void {
    this.post({
      type: 'programState',
      options: this.rack.programOptions(),
      banks: this.rack.getBankInfos(),
    });
  }

  private handleLoad(bytes: Uint8Array): void {
    const result = loadSysexFile(bytes);

    if (result.loaded) {
      this.rack.loadLibrary(result.library, result.report);
      applySystemSetupToParts(result.library, (cents) => this.rack.applyMasterTuneCents(cents));
      this.post({ type: 'loadReport', report: result.report });
      this.postProgramState();
      this.postParts();
      if (this.rack.voiceLibrary.performances.length > 0) {
        this.postPerformances();
      }
      if (result.singleVoice) {
        this.rack.loadVoiceForPart(this.rack.selectedPart, result.singleVoice);
      }
      this.postVoice();
      this.postMasterTune();
      return;
    }

    const voiceFrame = identifySysex(bytes).find((f) => f.kind === SysexKind.Voice);
    if (voiceFrame) {
      const v = voiceFromVced(voiceFrame.raw);
      if (v) {
        this.rack.loadVoiceForPart(this.rack.selectedPart, v);
        this.postVoice();
      }
      return;
    }

    if (result.singleVoice) {
      this.rack.loadVoiceForPart(this.rack.selectedPart, result.singleVoice);
      this.postVoice();
      return;
    }

    // Nothing recognized: surface the report so the UI can say why.
    if (result.report.skipped.length === 0) {
      result.report.skipped.push('no sysex data recognized');
    }
    this.post({ type: 'loadReport', report: result.report });
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
      case MsgType.LoadVoice: {
        const target = msg.partIndex ?? this.rack.selectedPart;
        this.rack.loadVoiceForPart(
          target,
          new Uint8Array(msg.data),
          msg.supplement ? new Uint8Array(msg.supplement) : undefined,
        );
        if (target === this.rack.selectedPart) this.postVoice();
        break;
      }
      case MsgType.LoadCart:
        try {
          this.handleLoad(new Uint8Array(msg.data));
        } catch (err) {
          this.post({
            type: 'loadReport',
            report: {
              frames: 0,
              applied: [],
              skipped: [`load failed: ${err instanceof Error ? err.message : String(err)}`],
            },
          });
        }
        break;
      case MsgType.SetVoiceRef:
        this.rack.setVoiceRefForPart(msg.partIndex ?? this.rack.selectedPart, msg.voice);
        this.postVoice();
        this.postParts();
        break;
      case MsgType.SetParam:
        this.rack.setVoiceParamForPart(this.rack.selectedPart, msg.offset, msg.value);
        break;
      case MsgType.SetSupplementParam:
        this.rack.setSupplementParamForPart(this.rack.selectedPart, msg.offset, msg.value);
        break;
      case MsgType.SetMasterTune:
        this.rack.applyMasterTuneCents(msg.cents);
        this.postMasterTune();
        break;
      case MsgType.SetEngine:
        this.rack.setEngineType(msg.engine as 0 | 1 | 2);
        break;
      case MsgType.SetMasterGain:
        this.rack.setMasterGain(msg.gain);
        break;
      case MsgType.Panic:
        this.rack.panic();
        break;
      case MsgType.SelectPart:
        this.rack.selectPart(msg.index);
        this.postProgramState();
        this.postParts();
        this.postVoice();
        break;
      case MsgType.SetPart:
        this.rack.setPartConfig(msg.index, msg.config);
        if (msg.config.voice !== undefined && msg.index === this.rack.selectedPart) {
          this.postVoice();
        }
        this.postParts();
        break;
      case MsgType.SetPolyphonyCap:
        this.rack.setPolyphonyCap(msg.cap);
        break;
      case MsgType.RequestBankDump:
        this.post({
          type: 'bankDump',
          bank: msg.bank,
          data: this.rack.voiceLibrary.dumpBankSysex(msg.bank),
        });
        break;
      case MsgType.SelectPerformance:
        this.rack.selectPerformance(msg.index);
        this.postParts();
        this.postPerformances();
        this.postVoice();
        break;
      case MsgType.StoreVoice:
        this.rack.storeSelectedVoice(msg.dest);
        // Re-emit program state so the updated slot name shows in the UI.
        this.postProgramState();
        this.postParts();
        break;
      case MsgType.LoadBankInto: {
        const raw = new Uint8Array(msg.voices);
        const voices: Uint8Array[] = [];
        for (let i = 0; i + 156 <= raw.length && voices.length < 32; i += 156) {
          voices.push(raw.subarray(i, i + 156));
        }
        let amems: Uint8Array[] | undefined;
        if (msg.supplements) {
          const rawA = new Uint8Array(msg.supplements);
          amems = [];
          for (let i = 0; i + 35 <= rawA.length && amems.length < 32; i += 35) {
            amems.push(rawA.subarray(i, i + 35));
          }
        }
        this.rack.loadBankInto(msg.bank, voices, amems);
        this.postProgramState();
        this.postParts();
        this.postVoice();
        break;
      }
      case MsgType.GetFullState:
        this.post({ type: 'fullState', state: this.rack.getFullState() });
        break;
      case MsgType.SetFullState:
        try {
          this.rack.restoreFullState(msg.state);
          this.postProgramState();
          this.postParts();
          this.postPerformances();
          this.postVoice();
          this.postMasterTune();
        } catch (err) {
          this.post({
            type: 'loadReport',
            report: {
              frames: 0,
              applied: [],
              skipped: [`session restore failed: ${err instanceof Error ? err.message : String(err)}`],
            },
          });
        }
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
