// Everything a Texed synth does apart from rendering audio: it owns a
// SynthRack, applies SynthCommands to it and emits the SynthEvents the UI
// reconciles from.
//
// Two things host it. The AudioWorklet adds `process()` and is the whole synth.
// The JUCE plugin runs one in the page with the rack never rendered, as the
// librarian: the C++ side owns the audio and the automatable values, and this
// keeps the file formats, the voice library and the performances here, where
// they already work, instead of a second implementation in C++.

import type { SynthRack } from '@texed/dx7-engine/synth-rack';
import { AMEM_SLOT_SIZE } from '@texed/dx7-format/amem';
import { NUM_PARTS } from '@texed/dx7-format/part-config';
import { VOICE_SIZE, VOICES_PER_BANK } from '@texed/dx7-format/voice';
import {
  identifySysex,
  splitSysex,
  parseMasterVolume,
  parseParamChange,
  ParamGroup,
  SysexKind,
  voiceFromVced,
} from '@texed/dx7-format/sysex';
import { loadSysexFile, applySystemSetupToParts } from '@texed/dx7-format/sysex-loader';
import { MsgType, type SynthCommand, type SynthEvent } from '@texed/synth-protocol/protocol';

/** Split a concatenated dump into at most one bank's worth of fixed-size records. */
function splitRecords(raw: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i + size <= raw.length && out.length < VOICES_PER_BANK; i += size) {
    out.push(raw.subarray(i, i + size));
  }
  return out;
}

export class SynthHost {
  readonly rack: SynthRack;
  private readonly post: (msg: SynthEvent) => void;

  constructor(rack: SynthRack, post: (msg: SynthEvent) => void) {
    this.rack = rack;
    this.post = post;
  }

  /** The four messages a fresh connection needs to draw the whole UI. */
  sendInitialState(): void {
    this.postVoice();
    this.postParts();
    this.postProgramState();
    this.postSettings();
  }

  postVoice(): void {
    this.post({
      type: 'voice',
      data: this.rack.getVoiceData(),
      supplement: this.rack.getSupplementData(),
    });
  }

  postSettings(): void {
    this.post({
      type: 'settings',
      settings: this.rack.getGlobalSettings(),
      microtuningNames: this.rack.getMicrotuningNames(),
    });
  }

  postParts(): void {
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

  /**
   * Route live SysEx from a MIDI port. Single-parameter and master-volume
   * frames are applied directly; everything else (voice, bank and performance
   * dumps) is concatenated and handed to the file loader, so a hardware bulk
   * dump lands exactly where a dropped .syx would.
   */
  private handleSysex(bytes: Uint8Array): void {
    const bulk: Uint8Array[] = [];
    let voiceDirty = false;
    let settingsDirty = false;

    for (const frame of splitSysex(bytes)) {
      const volume = parseMasterVolume(frame);
      if (volume !== null) {
        this.rack.setVolume(volume * 99);
        settingsDirty = true;
        continue;
      }
      const p = parseParamChange(frame);
      // The sub-status nibble addresses a part rather than a channel, which is
      // how MiniDexed reaches all eight tone generators down one cable.
      if (p && p.device < NUM_PARTS) {
        if (p.group === ParamGroup.Voice || p.group === ParamGroup.VoiceHigh) {
          this.rack.setVoiceParamForPart(p.device, p.group * 128 + p.param, p.value);
        } else if (p.group === ParamGroup.Supplement) {
          this.rack.setSupplementParamForPart(p.device, p.param, p.value);
        } else {
          continue;
        }
        voiceDirty ||= p.device === this.rack.selectedPart;
        continue;
      }
      bulk.push(frame);
    }

    if (voiceDirty) this.postVoice();
    if (settingsDirty) this.postSettings();
    if (bulk.length === 0) return;

    const total = bulk.reduce((n, f) => n + f.length, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const f of bulk) {
      joined.set(f, at);
      at += f.length;
    }
    this.handleLoad(joined);
  }

  handle(msg: SynthCommand): void {
    switch (msg.type) {
      case MsgType.NoteOn:
        this.rack.noteOn(msg.note, msg.velocity, msg.channel ?? 1);
        break;
      case MsgType.NoteOff:
        this.rack.noteOff(msg.note, msg.channel ?? 1);
        break;
      case MsgType.Cc:
        if (msg.channel === undefined) this.rack.controlChangeSelected(msg.controller, msg.value);
        else if (this.rack.controlChange(msg.controller, msg.value, msg.channel)) this.postParts();
        break;
      case MsgType.ProgramChange:
        this.rack.programChange(msg.program, msg.channel ?? 1);
        this.postParts();
        this.postVoice();
        break;
      case MsgType.Sysex:
        this.handleSysex(new Uint8Array(msg.data));
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
          this.postFailure('load failed', err);
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
      case MsgType.SetAccuracy:
        this.rack.setAccuracy(msg.accuracy);
        this.postSettings();
        break;
      case MsgType.SetVolume:
        this.rack.setVolume(msg.volume);
        this.postSettings();
        break;
      case MsgType.SetGlobal:
        this.rack.applyGlobalSettings(msg.settings);
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
          this.postFailure('session restore failed', err);
        }
        break;
      case MsgType.ParamGesture:
        // Only a plugin host cares; a synth that owns its own state does not.
        break;
    }
  }

  private postFailure(what: string, err: unknown): void {
    this.post({
      type: 'loadReport',
      report: {
        frames: 0,
        applied: [],
        skipped: [`${what}: ${err instanceof Error ? err.message : String(err)}`],
      },
    });
  }
}
