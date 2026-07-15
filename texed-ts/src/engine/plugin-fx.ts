// Post filter, ported from Source/PluginFx.cpp (Obxd 4-pole multimode filter
// preceded by a DC blocker). Operates on mono float buffers, in place.

const PI = Math.PI;

function logsc(param: number, min: number, max: number, rolloff = 19.0): number {
  return ((Math.exp(param * Math.log(rolloff + 1)) - 1.0) / rolloff) * (max - min) + min;
}

export class PluginFx {
  // UI-facing parameters
  uiCutoff = 1;
  uiReso = 0;
  uiGain = 1;

  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private s4 = 0;
  private c = 0;
  private d = 0;
  private R24 = 0;
  private rcor24 = 0;
  private rcor24Inv = 0;
  private bright = 0;

  private mm = 0;
  private mmt = 0;
  private mmch = 0;

  private rCutoff = 0;
  private rReso = 0;

  private sampleRateInv = 1 / 44100;

  private pReso = -1;
  private pCutoff = -1;

  private dcId = 0;
  private dcOd = 0;
  private dcR = 0;

  init(sr: number): void {
    this.mm = 0;
    this.s1 = this.s2 = this.s3 = this.s4 = this.c = this.d = 0;
    this.R24 = 0;

    this.mmch = Math.trunc(this.mm * 3);
    this.mmt = this.mm * 3 - this.mmch;

    this.sampleRateInv = 1 / sr;
    const rcrate = Math.sqrt(44000 / sr);
    this.rcor24 = (970.0 / 44000) * rcrate;
    this.rcor24Inv = 1 / this.rcor24;

    this.bright = Math.tan((sr * 0.5 - 10) * PI * this.sampleRateInv);

    this.rReso = 0;
    this.pCutoff = -1;
    this.pReso = -1;

    this.dcR = 1.0 - 126.0 / sr;
    this.dcId = 0;
    this.dcOd = 0;
  }

  private nr24(sample: number, g: number, lpc: number): number {
    const S = (lpc * (lpc * (lpc * this.s1 + this.s2) + this.s3) + this.s4) / (1 + g);
    const G = lpc * lpc * lpc * lpc;
    const y = (sample - this.R24 * S) / (1 + this.R24 * G);
    return y + 1e-8;
  }

  process(work: Float32Array, sampleSize: number): void {
    if (sampleSize <= 0) return;

    // very basic DC filter
    let tFd = work[0];
    work[0] = work[0] - this.dcId + this.dcR * this.dcOd;
    this.dcId = tFd;
    for (let i = 1; i < sampleSize; i++) {
      tFd = work[i];
      work[i] = work[i] - this.dcId + this.dcR * work[i - 1];
      this.dcId = tFd;
    }
    this.dcOd = work[sampleSize - 1];

    if (this.uiGain !== 1) {
      for (let i = 0; i < sampleSize; i++) work[i] *= this.uiGain;
    }

    // don't apply the LPF if the cutoff is at maximum
    if (this.uiCutoff === 1) return;

    if (this.uiCutoff !== this.pCutoff || this.uiReso !== this.pReso) {
      this.rReso = 0.991 - logsc(1 - this.uiReso, 0, 0.991);
      this.R24 = 3.5 * this.rReso;

      const cutoffNorm = logsc(this.uiCutoff, 60, 19000);
      this.rCutoff = Math.tan(cutoffNorm * this.sampleRateInv * PI);

      this.pCutoff = this.uiCutoff;
      this.pReso = this.uiReso;
    }

    const g = this.rCutoff;
    const lpc = g / (1 + g);

    for (let i = 0; i < sampleSize; i++) {
      let s = work[i];

      // s = s - 0.45 * tptlpupw(c, s, 15, srInv)
      {
        const cutoff = 15 * this.sampleRateInv * PI;
        const v = ((s - this.c) * cutoff) / (1 + cutoff);
        const res = v + this.c;
        this.c = res + v;
        s = s - 0.45 * res;
      }
      // s = tptpc(d, s, bright)
      {
        const v = ((s - this.d) * this.bright) / (1 + this.bright);
        const res = v + this.d;
        this.d = res + v;
        s = res;
      }

      const y0 = this.nr24(s, g, lpc);

      // first low pass in cascade
      const v = (y0 - this.s1) * lpc;
      const res = v + this.s1;
      this.s1 = res + v;
      // damping
      this.s1 = Math.atan(this.s1 * this.rcor24) * this.rcor24Inv;
      const y1 = res;

      // y2 = tptpc(s2, y1, g)
      let y2: number;
      {
        const vv = ((y1 - this.s2) * g) / (1 + g);
        const rr = vv + this.s2;
        this.s2 = rr + vv;
        y2 = rr;
      }
      // y3 = tptpc(s3, y2, g)
      let y3: number;
      {
        const vv = ((y2 - this.s3) * g) / (1 + g);
        const rr = vv + this.s3;
        this.s3 = rr + vv;
        y3 = rr;
      }
      // y4 = tptpc(s4, y3, g)
      let y4: number;
      {
        const vv = ((y3 - this.s4) * g) / (1 + g);
        const rr = vv + this.s4;
        this.s4 = rr + vv;
        y4 = rr;
      }

      let mc = 0;
      switch (this.mmch) {
        case 0:
          mc = (1 - this.mmt) * y4 + this.mmt * y3;
          break;
        case 1:
          mc = (1 - this.mmt) * y3 + this.mmt * y2;
          break;
        case 2:
          mc = (1 - this.mmt) * y2 + this.mmt * y1;
          break;
        case 3:
          mc = y1;
          break;
      }

      // half volume comp
      work[i] = mc * (1 + this.R24 * 0.45);
    }
  }
}
