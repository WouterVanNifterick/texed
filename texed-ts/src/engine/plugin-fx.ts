export class PluginFx {
  private dcId = 0;
  private dcOd = 0;
  private dcR = 0;

  init(sr: number): void {
    this.dcR = 1.0 - 126.0 / sr;
    this.dcId = 0;
    this.dcOd = 0;
  }

  process(work: Float32Array, sampleSize: number): void {
    if (sampleSize <= 0) return;

    let tFd = work[0];
    work[0] = work[0] - this.dcId + this.dcR * this.dcOd;
    this.dcId = tFd;
    for (let i = 1; i < sampleSize; i++) {
      tFd = work[i];
      work[i] = work[i] - this.dcId + this.dcR * work[i - 1];
      this.dcId = tFd;
    }
    this.dcOd = work[sampleSize - 1];
  }
}
