// Ambient declarations for the AudioWorklet global scope.

declare const sampleRate: number;

interface AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

type AudioWorkletProcessorCtor = new (
  options?: AudioWorkletNodeOptions,
) => AudioWorkletProcessor & {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
};

declare function registerProcessor(name: string, processorCtor: AudioWorkletProcessorCtor): void;
