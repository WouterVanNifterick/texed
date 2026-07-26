// AudioWorkletProcessor: hosts a multi-timbral SynthRack and renders
// stereo audio. A fresh rack has only part 0 enabled (omni), so single-timbre
// use is unchanged; enabling more parts gives TX802/TX816 behavior.

import { SynthRack } from '@texed/dx7-engine/synth-rack';
import { AMEM_SLOT_SIZE } from '@texed/dx7-format/amem';
import { VOICE_SIZE, VOICES_PER_BANK } from '@texed/dx7-format/voice';
import { identifySysex, SysexKind, voiceFromVced } from '@texed/dx7-format/sysex';
import { loadSysexFile, applySystemSetupToParts } from '@texed/dx7-format/sysex-loader';
import {
  MsgType,
  type StatusMsg,
  type SynthCommand,
  type SynthEvent,
} from '@texed/synth-protocol/protocol';

const STATUS_INTERVAL = 12;

/** Split a concatenated dump into at most one bank's worth of fixed-size records. */
function splitRecords(raw: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i + size <= raw.length && out.length < VOICES_PER_BANK; i += size) {
    out.push(raw.subarray(i, i + size));
  }
  return out;
}

class TexedProcessor extends AudioWorkletProcessor {
  private rack: SynthRack;
  private statusCountdown = STATUS_INTERVAL;
  // Reused so the audio thread does not allocate to report state. See postStatus.
  private statusMsg: StatusMsg = {
    type: 'status',
    amps: [],
    steps: [],
    levels: [],
    pitchStep: 4,
    pitchLevel: 0,
    lfo: 0,
    lfoRestart: 0,
    selectedPart: 0,
    partActivity: [],
    totalActive: 0,
  };

  constructor() {
    super();
    this.rack = new SynthRack(sampleRate);
    this.port.onmessage = (e: MessageEvent<SynthCommand>) => this.handleMessage(e.data);
    this.postVoice();
    this.postParts();
    this.postProgramState();
    this.postSettings();
  }

  private post(msg: SynthEvent): void {
    this.port.postMessage(msg);
  }

  private postVoice(): void {
    this.post({
      type: 'voice',
      data: this.rack.getVoiceData(),
      supplement: this.rack.getSupplementData(),
    });
  }

  private postSettings(): void {
    this.post({
      type: 'settings',
      settings: this.rack.getGlobalSettings(),
      microtuningNames: this.rack.getMicrotuningNames(),
    });
  }

  private postParts(): void {
    this.post({
      type: 'parts',
      configs: this.rack.getPartConfigs(),
      selectedPart: this.rack.selectedPart,
      voiceNames: this.rack.getVoiceNames(),
    });
  }

  private postPerformances(): void {
    const { names, index, name } = this.rack.getPerformanceState();
    this.post({ type: 'performances', names, index, name });
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
      this.postSettings();
      return;
    }

    const voiceFrame = identifySysex(bytes).find((f) => f.kind === SysexKind.Voice);
    if (voiceFrame) {
      const v = voiceFromVced(voiceFrame.raw);
      if (v) {
        this.rack.loadVoiceForPart(this.rack.selectedPart, v);
        this.postVoice();
        this.postParts();
      }
      return;
    }

    if (result.singleVoice) {
      this.rack.loadVoiceForPart(this.rack.selectedPart, result.singleVoice);
      this.postVoice();
      this.postParts();
      return;
    }

    // Nothing recognized: surface the report so the UI can say why.
    if (result.report.skipped.length === 0) {
      result.report.skipped.push('no sysex data recognized');
    }
    this.post({ type: 'loadReport', report: result.report });
  }

  private handleMessage(msg: SynthCommand): void {
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
        // The edit-buffer name may have changed; refresh the rack view.
        this.postParts();
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
        this.postSettings();
        break;
      case MsgType.SetMicrotuning:
        this.rack.setMicrotuning(msg.index);
        this.postSettings();
        break;
      case MsgType.SetEngine:
        this.rack.setEngineType(msg.engine as 0 | 1 | 2);
        this.postSettings();
        break;
      case MsgType.SetVolume:
        this.rack.setVolume(msg.volume);
        this.postSettings();
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
        this.postSettings();
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
      case MsgType.LoadPerformance:
        this.rack.loadPerformance(
          msg.name,
          msg.parts,
          msg.voices.map((v) => (v ? new Uint8Array(v) : null)),
        );
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
        const voices = splitRecords(raw, VOICE_SIZE);
        const amems = msg.supplements
          ? splitRecords(new Uint8Array(msg.supplements), AMEM_SLOT_SIZE)
          : undefined;
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
          this.postSettings();
        } catch (err) {
          this.post({
            type: 'loadReport',
            report: {
              frames: 0,
              applied: [],
              skipped: [
                `session restore failed: ${err instanceof Error ? err.message : String(err)}`,
              ],
            },
          });
        }
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const left = outputs[0]?.[0];
    if (!left) return true;

    // Rendering straight into the output saves a full block copy per callback.
    // The node is always created with a stereo output; the fallback only keeps a
    // mono host from writing out of bounds.
    this.rack.render(left, outputs[0][1] ?? left, left.length);

    if (--this.statusCountdown <= 0) {
      this.statusCountdown = STATUS_INTERVAL;
      this.postStatus();
    }
    return true;
  }

  /**
   * Copy the rack's reused status object into a reused message. Spreading it
   * into a fresh literal here would have undone the point of getStatus() not
   * allocating. The arrays are the rack's own and are structure-cloned by
   * postMessage, so handing over the references is safe.
   */
  private postStatus(): void {
    const s = this.rack.getStatus();
    const m = this.statusMsg;
    m.amps = s.amps;
    m.steps = s.steps;
    m.levels = s.levels;
    m.pitchStep = s.pitchStep;
    m.pitchLevel = s.pitchLevel;
    m.lfo = s.lfo;
    m.lfoRestart = s.lfoRestart;
    m.selectedPart = s.selectedPart;
    m.partActivity = s.partActivity;
    m.totalActive = s.totalActive;
    this.post(m);
  }
}

registerProcessor('texed-processor', TexedProcessor as unknown as AudioWorkletProcessorCtor);
