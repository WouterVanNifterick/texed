// DX7 voice, ported from msfa/dx7note.cc.
// Microtuning (MTS-ESP) is out of scope; only StandardTuning is supported, so
// the MTS_HasMaster path is never taken.

import { Env, scaleoutlevel } from './env';
import { PitchEnv } from './pitchenv';
import { FmOpParams } from './fm-op-kernel';
import { isCarrier } from './fm-core';
import { Freqlut } from './freqlut';
import { Exp2 } from './exp2';
import { Porta } from './porta';
import { sar64 } from './fixedpoint';
import { kControllerPitch, kControllerPitchRangeUp, kControllerPitchStep, kControllerPitchRangeDn } from './controllers';
import type { Controllers } from './controllers';
import type { TuningState } from './tuning';
import { VoiceSupplement, extendedAmsTable } from './amem';

const FEEDBACK_BITDEPTH = 8;

// prettier-ignore
const coarsemul = [
  -16777216, 0, 16777216, 26591258, 33554432, 38955489, 43368474, 47099600,
  50331648, 53182516, 55732705, 58039632, 60145690, 62083076, 63876816,
  65546747, 67108864, 68576247, 69959732, 71268397, 72509921, 73690858,
  74816848, 75892776, 76922906, 77910978, 78860292, 79773775, 80654032,
  81503396, 82323963, 83117622,
];

/** Quantize a Q24 log-frequency to `semis`-semitone steps (DX7II portamento step). */
function logfreqRoundSemi(freq: number, semis: number): number {
  const base = 50857777;
  const step = Math.trunc(((1 << 24) / 12) * semis);
  const rem = (freq - base) % step;
  return freq - rem;
}

// Random pitch fluctuation depth 0-7 → max deviation in cents (DX7II: off, 5c…41c).
const randomPitchCents = [0, 5, 11, 17, 23, 29, 35, 41];

// prettier-ignore
const velocityData = [
  0, 70, 86, 97, 106, 114, 121, 126, 132, 138, 142, 148, 152, 156, 160, 163,
  166, 170, 173, 174, 178, 181, 184, 186, 189, 190, 194, 196, 198, 200, 202,
  205, 206, 209, 211, 214, 216, 218, 220, 222, 224, 225, 227, 229, 230, 232,
  233, 235, 237, 238, 240, 241, 242, 243, 244, 246, 246, 248, 249, 250, 251,
  252, 253, 254,
];

export function scaleVelocity(velocity: number, sensitivity: number): number {
  const clampedVel = Math.max(0, Math.min(127, velocity));
  const velValue = velocityData[clampedVel >> 1] - 239;
  return ((sensitivity * velValue + 7) >> 3) << 4;
}

export function scaleRate(midinote: number, sensitivity: number): number {
  const x = Math.min(31, Math.max(0, Math.trunc(midinote / 3) - 7));
  return (sensitivity * x) >> 3;
}

// prettier-ignore
const expScaleData = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 14, 16, 19, 23, 27, 33, 39, 47, 56, 66,
  80, 94, 110, 126, 142, 158, 174, 190, 206, 222, 238, 250,
];

function scaleCurve(group: number, depth: number, curve: number): number {
  let scale: number;
  if (curve === 0 || curve === 3) {
    scale = (group * depth * 329) >> 12;
  } else {
    const rawExp = expScaleData[Math.min(group, expScaleData.length - 1)];
    scale = (rawExp * depth * 329) >> 15;
  }
  if (curve < 2) scale = -scale;
  return scale;
}

export function scaleLevel(
  midinote: number,
  breakPt: number,
  leftDepth: number,
  rightDepth: number,
  leftCurve: number,
  rightCurve: number,
): number {
  const offset = midinote - breakPt - 17;
  if (offset >= 0) {
    return scaleCurve(Math.trunc((offset + 1) / 3), rightDepth, rightCurve);
  }
  return scaleCurve(Math.trunc(-(offset - 1) / 3), leftDepth, leftCurve);
}

const pitchmodsenstab = [0, 10, 20, 33, 55, 92, 153, 255];

// DX7II pitch EG range (AMEM): 8va (full DX7 range), 2va, 1va, ½va, expressed
// as a right shift of the Q24 pitch EG output.
const pegRangeShift = [0, 2, 3, 4];

export interface VoiceStatus {
  amp: number[];
  ampStep: number[];
  pitchStep: number;
}

export class Dx7Note {
  private tuningState: TuningState;
  private supplement: VoiceSupplement | null = null;

  private params: FmOpParams[] = [];
  private env: Env[] = [];
  private pitchenv = new PitchEnv();

  private basepitch = new Int32Array(6);
  private portaCurpitch = new Int32Array(6);
  private opMode = new Int32Array(6);
  private ampmodsens = new Int32Array(6);
  private fbBuf = new Int32Array(2);

  private algorithm = 0;
  private fbShift = 0;
  private pitchmoddepth = 0;
  private pitchmodsens = 0;
  private ampmoddepth = 0;

  // DX7II supplement (AMEM) state, latched at note-on.
  private pegShift = 0;
  private pegVelScale = 1;
  private randPitchOffset = 0;

  private initialised = false;
  private mpePitchBend = 8192;

  /** Pitch-bend gate for DX7II bend modes (LOW/HIGH/K.ON); set by the Part. */
  bendGate = true;

  constructor(tuningState: TuningState) {
    this.tuningState = tuningState;
    for (let op = 0; op < 6; op++) {
      const p = new FmOpParams();
      p.phase = 0;
      p.gainOut = 0;
      this.params.push(p);
      this.env.push(new Env());
    }
  }

  setTuningState(state: TuningState): void {
    this.tuningState = state;
  }

  setSupplement(sup: VoiceSupplement | null): void {
    this.supplement = sup;
  }

  private amsForOp(op: number, patch: Uint8Array): number {
    const off = op * 21;
    let ams = patch[off + 14] & 3;
    if (this.supplement) {
      const ext = this.supplement.amsIndex(op);
      if (ext > 3) ams = ext;
    }
    return Math.min(7, ams);
  }

  private amsTableValue(ams: number): number {
    if (ams < extendedAmsTable.length) return extendedAmsTable[ams];
    return extendedAmsTable[extendedAmsTable.length - 1];
  }

  private oscFreq(midinote: number, mode: number, coarse: number, fine: number, detune: number): number {
    let logfreq: number;
    if (mode === 0) {
      logfreq = this.tuningState.midinoteToLogfreq(midinote);
      const detuneRatio = (0.0209 * Math.exp(-0.396 * (Math.fround(logfreq) / (1 << 24)))) / 7;
      logfreq = Math.trunc(logfreq + detuneRatio * logfreq * (detune - 7));
      logfreq += coarsemul[coarse & 31];
      if (fine) {
        logfreq += Math.floor(24204406.323123 * Math.log(1 + 0.01 * fine) + 0.5);
      }
    } else {
      logfreq = (4458616 * ((coarse & 3) * 100 + fine)) >> 3;
      logfreq += detune > 7 ? 13457 * (detune - 7) : 0;
    }
    return logfreq | 0;
  }

  init(
    patch: Uint8Array,
    midinote: number,
    velocity: number,
    _channel: number,
    continueEnv = false,
  ): void {
    this.initialised = true;
    this.bendGate = true;
    const rates = new Int32Array(4);
    const levels = new Int32Array(4);

    const sup = this.supplement;
    this.pegShift = sup ? pegRangeShift[sup.pitchEgRange & 3] : 0;
    this.pegVelScale = sup?.pitchEgVelSens ? Math.max(1, velocity) / 127 : 1;
    // Random pitch fluctuation: depth-scaled cents offset per note-on.
    const rndCents = randomPitchCents[sup ? sup.randomPitchDepth & 7 : 0];
    this.randPitchOffset = rndCents
      ? Math.trunc((Math.random() * 2 - 1) * (((1 << 24) / 1200) * rndCents))
      : 0;

    for (let op = 0; op < 6; op++) {
      const off = op * 21;
      for (let i = 0; i < 4; i++) {
        rates[i] = patch[off + i];
        levels[i] = patch[off + 4 + i];
      }
      let outlevel = patch[off + 16];
      outlevel = scaleoutlevel(outlevel);
      const levelScaling = scaleLevel(
        midinote,
        patch[off + 8],
        patch[off + 9],
        patch[off + 10],
        patch[off + 11],
        patch[off + 12],
      );
      outlevel += levelScaling;
      outlevel = Math.min(127, outlevel);
      outlevel = outlevel << 5;
      outlevel += scaleVelocity(velocity, patch[off + 15]);
      outlevel = Math.max(0, outlevel);
      const rateScaling = scaleRate(midinote, patch[off + 13]);
      this.env[op].init(rates, levels, outlevel, rateScaling, continueEnv);

      const mode = patch[off + 17];
      const coarse = patch[off + 18];
      const fine = patch[off + 19];
      const detune = patch[off + 20];
      const freq = this.oscFreq(midinote, mode, coarse, fine, detune) + (mode === 0 ? this.randPitchOffset : 0);
      this.opMode[op] = mode;
      this.basepitch[op] = freq;
      this.portaCurpitch[op] = freq;
      this.ampmodsens[op] = this.amsTableValue(this.amsForOp(op, patch));
    }
    const pegRateAdj = sup && sup.pitchEgScaleRate ? scaleRate(midinote, sup.pitchEgScaleRate & 7) : 0;
    for (let i = 0; i < 4; i++) {
      rates[i] = Math.min(99, patch[126 + i] + pegRateAdj);
      levels[i] = patch[130 + i];
    }
    this.pitchenv.set(rates, levels);
    this.algorithm = patch[134];
    const feedback = patch[135];
    this.fbShift = feedback !== 0 ? FEEDBACK_BITDEPTH - feedback : 16;
    this.pitchmoddepth = (patch[139] * 165) >> 6;
    this.pitchmodsens = pitchmodsenstab[patch[143] & 7];
    this.ampmoddepth = (patch[140] * 165) >> 6;

    this.mpePitchBend = 8192;
  }

  initPortamento(src: Dx7Note): void {
    for (let i = 0; i < 6; i++) {
      this.portaCurpitch[i] = src.portaCurpitch[i];
    }
  }

  compute(buf: Int32Array, lfoVal: number, lfoDelay: number, ctrls: Controllers): void {
    // ==== PITCH ====
    const pmd = (this.pitchmoddepth * lfoDelay) >>> 0; // Q32 (fits uint32)
    const senslfo = (this.pitchmodsens * (lfoVal - (1 << 23))) | 0;
    // product can reach ~9.2e18 (> 2^53), so BigInt is required here.
    const pmod1 = Math.abs(Number((BigInt(pmd) * BigInt(senslfo)) >> 39n));
    const pmod2 = Math.abs(sar64(ctrls.pitchMod * senslfo, 14) | 0);
    let pitchMod = Math.max(pmod1, pmod2);
    let peg = this.pitchenv.getsample();
    if (this.pegShift) peg >>= this.pegShift;
    if (this.pegVelScale !== 1) peg = Math.trunc(peg * this.pegVelScale);
    pitchMod = peg + pitchMod * (senslfo < 0 ? -1 : 1);

    // ---- PITCH BEND ----
    const pitchbend = ctrls.values_[kControllerPitch];
    // DX7II bend modes: the Part gates which notes respond (LOW/HIGH/K.ON).
    let pb = this.bendGate ? pitchbend - 0x2000 : 0;
    if (pb !== 0) {
      if (ctrls.values_[kControllerPitchStep] === 0) {
        if (pb >= 0) {
          pb = Math.trunc((pb << 11) * ctrls.values_[kControllerPitchRangeUp] / 12.0);
        } else {
          pb = Math.trunc((pb << 11) * ctrls.values_[kControllerPitchRangeDn] / 12.0);
        }
      } else {
        const stp = Math.trunc(12 / ctrls.values_[kControllerPitchStep]);
        pb = Math.trunc((pb * stp) / 8191);
        pb = (pb * Math.trunc(8191 / stp)) << 11;
      }
    }

    if (ctrls.mpeEnabled) {
      const d = Math.trunc(((this.mpePitchBend - 0x2000) << 11) * ctrls.mpePitchBendRange / 12.0);
      pb += d;
    }

    // BC/AT pitch bias shifts pitch like a bend (applies to fixed ops too).
    const pitchBase = (pb + ctrls.masterTune + ctrls.pitchBiasMod) | 0;
    pitchMod += pitchBase;

    // ==== AMP MOD ====
    const lfoValAmp = (1 << 24) - lfoVal;
    let amod1 = sar64(this.ampmoddepth * lfoDelay, 8); // Q24
    amod1 = sar64(amod1 * lfoValAmp, 24);
    const amod2 = sar64(ctrls.ampMod * lfoValAmp, 7);
    let amdMod = Math.max(amod1, amod2);

    // ==== EG AMP MOD ====
    const amod3 = (ctrls.egMod + 1) << 17;
    amdMod = Math.max((1 << 24) - amod3, amdMod);

    let portaRate: number;
    if (ctrls.portamentoEnableCc) {
      portaRate = ctrls.portamentoGlissCc
        ? Porta.ratesGlissando[ctrls.portamentoCc]
        : Porta.rates[ctrls.portamentoCc];
    } else {
      portaRate = Porta.rates[0];
    }

    // ==== OP RENDER ====
    for (let op = 0; op < 6; op++) {
      if (ctrls.opSwitch[op] === '0') {
        this.env[op].getsample(); // advance envelope even when not playing
        this.params[op].levelIn = 0;
      } else {
        let basepitch = this.basepitch[op];

        if (this.opMode[op]) {
          this.params[op].freq = Freqlut.lookup(basepitch + pitchBase);
        } else {
          if (this.portaCurpitch[op] !== this.basepitch[op]) {
            basepitch = this.portaCurpitch[op];
            if (ctrls.portamentoGlissCc) {
              basepitch = logfreqRoundSemi(basepitch, Math.max(1, ctrls.portamentoStepCc));
            }

            const cur = this.portaCurpitch[op];
            const dst = this.basepitch[op];
            const goingUp = cur < dst;
            let newpitch = cur + (goingUp ? portaRate : -portaRate);
            if ((goingUp && newpitch > dst) || (!goingUp && newpitch < dst)) newpitch = dst;
            this.portaCurpitch[op] = newpitch;
          }
          this.params[op].freq = Freqlut.lookup(basepitch + pitchMod);
        }

        let level = this.env[op].getsample();
        if (this.ampmodsens[op] !== 0) {
          const sensamp = sar64(amdMod * this.ampmodsens[op], 24);
          // Match C++ `uint32_t pt = exp(...)` (saturate instead of UB on huge values).
          const pt = Math.min(
            0xffff_ffff,
            Math.trunc(Math.exp((Math.fround(sensamp) / 262144) * 0.07 + 12.2)),
          );
          // level * (pt << 4) can exceed 2^53, so use BigInt.
          const ldiff = Number(((BigInt(level) * BigInt(pt)) << 4n) >> 28n);
          level -= ldiff;
          // msfa's exp curve can slightly overshoot at AMS=max; negative level
          // wraps inside Exp2 and sounds like clipping/noise.
          if (level < 0) level = 0;
        }
        this.params[op].levelIn = level;
      }
    }
    ctrls.core.render(buf, this.params, this.algorithm, this.fbBuf, this.fbShift);
  }

  keyup(): void {
    for (let op = 0; op < 6; op++) {
      this.env[op].keydown(false);
    }
    this.pitchenv.keydown(false);
  }

  /** TX802 forced damp: ramp all operators quickly to silence (see Env.forceDamp). */
  forceDamp(): void {
    for (let op = 0; op < 6; op++) {
      this.env[op].forceDamp();
    }
  }

  update(patch: Uint8Array, midinote: number, velocity: number, _channel: number): void {
    const rates = new Int32Array(4);
    const levels = new Int32Array(4);

    for (let op = 0; op < 6; op++) {
      const off = op * 21;
      const mode = patch[off + 17];
      const coarse = patch[off + 18];
      const fine = patch[off + 19];
      const detune = patch[off + 20];
      this.basepitch[op] =
        this.oscFreq(midinote, mode, coarse, fine, detune) + (mode === 0 ? this.randPitchOffset : 0);
      this.ampmodsens[op] = this.amsTableValue(this.amsForOp(op, patch));
      this.opMode[op] = mode;

      for (let i = 0; i < 4; i++) {
        rates[i] = patch[off + i];
        levels[i] = patch[off + 4 + i];
      }
      let outlevel = patch[off + 16];
      outlevel = scaleoutlevel(outlevel);
      const levelScaling = scaleLevel(
        midinote,
        patch[off + 8],
        patch[off + 9],
        patch[off + 10],
        patch[off + 11],
        patch[off + 12],
      );
      outlevel += levelScaling;
      outlevel = Math.min(127, outlevel);
      outlevel = outlevel << 5;
      outlevel += scaleVelocity(velocity, patch[off + 15]);
      outlevel = Math.max(0, outlevel);
      const rateScaling = scaleRate(midinote, patch[off + 13]);
      this.env[op].update(rates, levels, outlevel, rateScaling);
    }
    this.algorithm = patch[134];
    const feedback = patch[135];
    this.fbShift = feedback !== 0 ? FEEDBACK_BITDEPTH - feedback : 16;
    this.pitchmoddepth = (patch[139] * 165) >> 6;
    this.pitchmodsens = pitchmodsenstab[patch[143] & 7];
    this.ampmoddepth = (patch[140] * 165) >> 6;
  }

  peekVoiceStatus(status: VoiceStatus): void {
    for (let i = 0; i < 6; i++) {
      status.amp[i] = Exp2.lookup(this.params[i].levelIn - 14 * (1 << 24));
      status.ampStep[i] = this.env[i].getPosition();
    }
    status.pitchStep = this.pitchenv.getPosition();
  }

  transferState(src: Dx7Note): void {
    for (let i = 0; i < 6; i++) {
      this.env[i].transfer(src.env[i]);
      this.params[i].gainOut = src.params[i].gainOut;
      this.params[i].phase = src.params[i].phase;
    }
  }

  transferSignal(src: Dx7Note): void {
    for (let i = 0; i < 6; i++) {
      this.params[i].gainOut = src.params[i].gainOut;
      this.params[i].phase = src.params[i].phase;
    }
  }

  transferPhase(src: Dx7Note): void {
    for (let i = 0; i < 6; i++) {
      this.params[i].phase = src.params[i].phase;
    }
  }

  oscSync(): void {
    for (let i = 0; i < 6; i++) {
      this.params[i].gainOut = 0;
      this.params[i].phase = 0;
    }
  }

  isPlaying(): boolean {
    if (!this.initialised) return false;
    for (let i = 0; i < 6; i++) {
      if (isCarrier(this.algorithm, i) && this.env[i].isActive()) {
        return true;
      }
    }
    return false;
  }
}
