// MIDI controller state, ported from msfa/controllers.h.
// The `core` field selects the active FM engine (Modern / Mark I / OPL).

import type { FmCore } from './fm-core';

export const kControllerPitch = 128;
export const kControllerPitchRangeUp = 129;
export const kControllerPitchStep = 130;
export const kControllerPitchRangeDn = 131;

export class FmMod {
  range = 0;
  pitch = false;
  amp = false;
  eg = false;

  parseConfig(cfg: string): void {
    const parts = cfg.trim().split(/\s+/).map((s) => parseInt(s, 10) || 0);
    const [r = 0, p = 0, a = 0, e = 0] = parts;
    this.range = r < 0 || r > 127 ? 0 : r;
    this.pitch = p !== 0;
    this.amp = a !== 0;
    this.eg = e !== 0;
  }
}

export class Controllers {
  values_ = new Int32Array(132);

  // Six operator on/off flags as '0'/'1' characters, matching the C++ char[7].
  opSwitch = '111111';

  ampMod = 0;
  pitchMod = 0;
  egMod = 0;

  aftertouchCc = 0;
  breathCc = 0;
  footCc = 0;
  modwheelCc = 0;
  portamentoEnableCc = false;
  portamentoCc = 0;
  portamentoGlissCc = false;

  masterTune = 0;

  transpose12AsScale = true;

  mpeEnabled = false;
  mpePitchBendRange = 24;

  wheel = new FmMod();
  foot = new FmMod();
  breath = new FmMod();
  at = new FmMod();

  core!: FmCore;

  private applyMod(cc: number, mod: FmMod): void {
    const range = 0.01 * mod.range;
    const total = Math.trunc(cc * range);
    if (mod.amp) this.ampMod = Math.max(this.ampMod, total);
    if (mod.pitch) this.pitchMod = Math.max(this.pitchMod, total);
    if (mod.eg) this.egMod = Math.max(this.egMod, total);
  }

  refresh(): void {
    this.ampMod = 0;
    this.pitchMod = 0;
    this.egMod = 0;

    this.applyMod(this.modwheelCc, this.wheel);
    this.applyMod(this.breathCc, this.breath);
    this.applyMod(this.footCc, this.foot);
    this.applyMod(this.aftertouchCc, this.at);

    if (!((this.wheel.eg || this.foot.eg) || (this.breath.eg || this.at.eg))) {
      this.egMod = 127;
    }
  }
}
