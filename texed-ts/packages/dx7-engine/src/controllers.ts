// MIDI controller state, ported from msfa/controllers.h and extended to the
// DX7II per-destination modulation model: each physical controller has
// independent 0-99 ranges for pitch mod, amp mod, EG bias, plus volume
// (FC1/FC2/MIDI-ctrl) and pitch bias (BC/AT).
// The `core` field selects the active FM engine (Modern / Mark I / OPL).

import type { FmCore } from './fm-core';
import type { VoiceSupplement, CtrlRanges } from '@texed/dx7-format/amem';

export const kControllerPitch = 128;
export const kControllerPitchRangeUp = 129;
export const kControllerPitchStep = 130;
export const kControllerPitchRangeDn = 131;

/** DX7II modulation routing for one physical controller. */
export class FmMod {
  /** Pitch modulation range 0-99 (adds LFO pitch mod). */
  pitchRange = 0;
  /** Amplitude modulation range 0-99 (adds LFO amp mod). */
  ampRange = 0;
  /** EG bias range 0-99 (controller gates operator level). */
  egRange = 0;
  /** Volume range 0-99 (controller attenuates part output; FC1/FC2/MC). */
  volRange = 0;
  /** Pitch bias 0-99, 50 = center/off (BC/AT): directly shifts pitch. */
  pitchBiasRange = 50;
}

export class Controllers {
  values_ = new Int32Array(132);

  // Six operator on/off flags as '0'/'1' characters, matching the C++ char[7].
  opSwitch = '111111';

  ampMod = 0;
  pitchMod = 0;
  egMod = 0;
  /** Q24 log-frequency offset from BC/AT pitch bias (±1 octave full scale). */
  pitchBiasMod = 0;
  /** 0..1 gain factor from FC1/FC2/MIDI-ctrl volume ranges. */
  volMod = 1;

  aftertouchCc = 0;
  breathCc = 0;
  footCc = 0;
  /** Foot controller 2 (CC 11). Defaults high: an unplugged pedal reads max. */
  foot2Cc = 127;
  /** "MIDI IN controller" (CC 13 by default on this implementation). */
  midiCsCc = 127;
  modwheelCc = 0;
  portamentoEnableCc = false;
  portamentoCc = 0;
  portamentoGlissCc = false;
  /** Portamento step 0-12: 0 = smooth, n = glissando in n-semitone steps. */
  portamentoStepCc = 0;
  /** When set, FC1 acts as CS1 (panel slider) and its mod routings are bypassed. */
  fc1AsCs1 = false;

  masterTune = 0;

  transpose12AsScale = true;

  mpeEnabled = false;
  mpePitchBendRange = 24;

  wheel = new FmMod();
  foot = new FmMod();
  breath = new FmMod();
  at = new FmMod();
  foot2 = new FmMod();
  midiCs = new FmMod();

  core!: FmCore;

  private applyMod(cc: number, mod: FmMod): void {
    if (mod.pitchRange) this.pitchMod = Math.max(this.pitchMod, Math.trunc(cc * 0.01 * mod.pitchRange));
    if (mod.ampRange) this.ampMod = Math.max(this.ampMod, Math.trunc(cc * 0.01 * mod.ampRange));
    if (mod.egRange) this.egMod = Math.max(this.egMod, Math.trunc(cc * 0.01 * mod.egRange));
  }

  /** Volume factor for one controller: range 0 → 1.0, full range + cc 0 → 0. */
  private volFactor(cc: number, mod: FmMod): number {
    if (!mod.volRange) return 1;
    return 1 - (mod.volRange / 99) * (1 - cc / 127);
  }

  /** Signed pitch bias contribution −1..1 (0-99 range, 50 = center). */
  private biasFactor(cc: number, mod: FmMod): number {
    if (mod.pitchBiasRange === 50) return 0;
    return ((mod.pitchBiasRange - 50) / 50) * (cc / 127);
  }

  refresh(): void {
    this.ampMod = 0;
    this.pitchMod = 0;
    this.egMod = 0;

    this.applyMod(this.modwheelCc, this.wheel);
    this.applyMod(this.breathCc, this.breath);
    if (!this.fc1AsCs1) this.applyMod(this.footCc, this.foot);
    this.applyMod(this.aftertouchCc, this.at);
    this.applyMod(this.foot2Cc, this.foot2);
    this.applyMod(this.midiCsCc, this.midiCs);

    // No EG bias assigned anywhere: operators play at full level.
    const egAssigned =
      this.wheel.egRange || this.breath.egRange || (this.fc1AsCs1 ? 0 : this.foot.egRange) ||
      this.at.egRange || this.foot2.egRange || this.midiCs.egRange;
    if (!egAssigned) {
      this.egMod = 127;
    }

    // BC/AT pitch bias: full range shifts pitch by ±1 octave (Q24 per octave).
    const bias = this.biasFactor(this.breathCc, this.breath) + this.biasFactor(this.aftertouchCc, this.at);
    this.pitchBiasMod = Math.trunc(Math.max(-1, Math.min(1, bias)) * (1 << 24));

    let vol = this.volFactor(this.foot2Cc, this.foot2) * this.volFactor(this.midiCsCc, this.midiCs);
    if (!this.fc1AsCs1) vol *= this.volFactor(this.footCc, this.foot);
    this.volMod = Math.max(0, Math.min(1, vol));
  }
}

/** Apply per-voice controller settings from an AMEM supplement into a Part's Controllers. */
export function applySupplementToControllers(supp: VoiceSupplement, ctrls: Controllers): void {
  const setMod = (dst: FmMod, src: CtrlRanges) => {
    dst.pitchRange = src.pitch;
    dst.ampRange = src.amp;
    dst.egRange = src.eg;
    dst.volRange = src.vol;
    dst.pitchBiasRange = src.pitchBias;
  };
  setMod(ctrls.wheel, supp.wheel);
  setMod(ctrls.foot, supp.foot);
  setMod(ctrls.breath, supp.breath);
  setMod(ctrls.at, supp.at);
  setMod(ctrls.foot2, supp.foot2);
  setMod(ctrls.midiCs, supp.midiCtrl);
  ctrls.fc1AsCs1 = supp.fc1AsCs1;

  // Portamento from AMEM
  ctrls.portamentoStepCc = supp.portamentoStep;
  ctrls.portamentoGlissCc = supp.portamentoStep > 0;
  if (supp.portamentoTime > 0) {
    ctrls.portamentoCc = supp.portamentoTime;
    ctrls.portamentoEnableCc = true;
  } else {
    ctrls.portamentoCc = 0;
    ctrls.portamentoEnableCc = false;
  }

  // Pitch bend range / step / mode from AMEM
  if (supp.pitchBendRange > 0) {
    ctrls.values_[128] = 0x2000;
    ctrls.values_[129] = supp.pitchBendRange;
    ctrls.values_[131] = supp.pitchBendRange;
  }
  ctrls.values_[130] = Math.min(12, supp.pitchBendStep);
  ctrls.refresh();
}
