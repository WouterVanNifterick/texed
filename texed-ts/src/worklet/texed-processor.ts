// AudioWorkletProcessor: hosts a multi-timbral SynthRack and renders
// stereo audio. A fresh rack has only part 0 enabled (omni), so single-timbre
// use is unchanged; enabling more parts gives TX802/TX816 behavior.
//
// The command handling lives in SynthHost, which the JUCE plugin also uses.

import { SynthRack } from '@texed/dx7-engine/synth-rack';
import type { StatusMsg, SynthCommand, SynthEvent } from '@texed/synth-protocol/protocol';
import { SynthHost } from '../audio/synth-host';

const STATUS_INTERVAL = 12;

class TexedProcessor extends AudioWorkletProcessor {
  private rack = new SynthRack(sampleRate);
  private host: SynthHost;
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
    this.host = new SynthHost(this.rack, (msg) => this.post(msg));
    this.port.onmessage = (e: MessageEvent<SynthCommand>) => this.host.handle(e.data);
    this.host.sendInitialState();
  }

  private post(msg: SynthEvent): void {
    this.port.postMessage(msg);
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
