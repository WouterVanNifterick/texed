// The main-thread mirror of the rack: holds React state, applies the events the
// synth sends back, and exposes the action object built in synth-actions.ts.
//
// The authoritative patch state lives in the worklet, not here. See
// docs/architecture.md for why, and for the edit round trip.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RackState } from '@texed/synth-protocol/protocol';
import type { SynthPort } from '@texed/synth-protocol/port';
import type { PartConfig, ProgramOption } from '@texed/dx7-format/part-config';
import { voiceRefEquals, type VoiceRef } from '@texed/dx7-format/voice-library';
import type { LoadReport } from '@texed/dx7-format/sysex-loader';
import { initVoice } from '@texed/dx7-format/cartridge';
import { createDefaultAmem } from '@texed/dx7-format/amem';
import { DEFAULT_GLOBAL_SETTINGS, type GlobalSettings } from '@texed/dx7-format/global-settings';
import { setEngineAccuracy } from '@texed/dx7-engine/synth-unit';
import { WorkletPort } from './worklet-port';
import { createSynthActions } from './synth-actions';
import type { BankInfo, Synth, SynthStatus } from './synth-types';

export type { BankInfo, Synth, SynthActions, SynthData, SynthStatus } from './synth-types';

/** Subscribe to one slice of the ~31 Hz status stream without re-rendering a parent. */
export function useStatus<T>(
  subscribe: (cb: (s: SynthStatus) => void) => () => void,
  selector: (s: SynthStatus) => T,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  const sel = useRef(selector);
  sel.current = selector;
  useEffect(() => subscribe((s) => setValue(sel.current(s))), [subscribe]);
  return value;
}

export function useSynth(externalPort?: SynthPort): Synth {
  // The transport is swappable: the default WorkletPort runs the TS engine
  // locally; a hardware-MIDI or native-bridge port can be passed in instead.
  const portRef = useRef<SynthPort | null>(externalPort ?? null);
  if (portRef.current === null) portRef.current = new WorkletPort();
  const port = portRef.current;

  const [programOptions, setProgramOptions] = useState<ProgramOption[]>([]);
  const [banks, setBanks] = useState<BankInfo[]>([]);
  const [loadReport, setLoadReport] = useState<LoadReport | null>(null);
  const [voice, setVoice] = useState<Uint8Array>(initVoice);
  const [supplement, setSupplement] = useState<Uint8Array>(createDefaultAmem);
  const [settings, setSettings] = useState<GlobalSettings>(DEFAULT_GLOBAL_SETTINGS);
  const [microtuningNames, setMicrotuningNames] = useState<string[]>([]);
  const [partConfigs, setPartConfigs] = useState<PartConfig[]>([]);
  const [partVoiceNames, setPartVoiceNames] = useState<string[]>([]);
  const [selectedPart, setSelectedPart] = useState(0);
  const [performanceNames, setPerformanceNames] = useState<string[]>([]);
  const [performanceIndex, setPerformanceIndex] = useState(0);
  const [performanceName, setPerformanceName] = useState('');

  const supplementRef = useRef(supplement);
  supplementRef.current = supplement;
  const programOptionsRef = useRef(programOptions);
  programOptionsRef.current = programOptions;
  const bankDumpCbs = useRef<((data: Uint8Array | null) => void)[]>([]);
  const fullStateCbs = useRef<((state: RackState) => void)[]>([]);
  const statusSubs = useRef<Set<(s: SynthStatus) => void>>(new Set());

  // Meter frames arrive faster than they can usefully be drawn, so only the
  // newest is kept and fanned out once per animation frame. A hidden tab stops
  // getting frames, so the meter components stop re-rendering with it.
  const pendingStatus = useRef<SynthStatus | null>(null);
  const statusFrame = useRef(0);

  const actions = useMemo(
    () =>
      createSynthActions(port, {
        setVoice,
        setSupplement,
        setSettings,
        supplement: supplementRef,
        programOptions: programOptionsRef,
        bankDumpCbs,
        fullStateCbs,
        statusSubs,
      }),
    [port],
  );

  useEffect(() => {
    const flushStatus = () => {
      statusFrame.current = 0;
      const s = pendingStatus.current;
      if (!s) return;
      pendingStatus.current = null;
      for (const cb of statusSubs.current) cb(s);
    };

    const unsubscribe = port.onEvent((m) => {
      switch (m.type) {
        case 'programState':
          setProgramOptions(m.options);
          setBanks(m.banks);
          break;
        case 'loadReport':
          setLoadReport(m.report);
          break;
        case 'voice':
          setVoice(new Uint8Array(m.data));
          setSupplement(new Uint8Array(m.supplement));
          break;
        case 'settings':
          setSettings(m.settings);
          setMicrotuningNames(m.microtuningNames);
          // The scaling and envelope graphs call into the engine's own scaling
          // functions from the main thread, which has a separate copy of the
          // module state. Mirror the worklet's mode so the pictures keep
          // matching the sound.
          setEngineAccuracy(m.settings.accuracy);
          break;
        case 'parts':
          setPartConfigs(m.configs);
          setPartVoiceNames(m.voiceNames);
          setSelectedPart(m.selectedPart);
          break;
        case 'performances':
          setPerformanceNames(m.names);
          setPerformanceIndex(m.index);
          setPerformanceName(m.name);
          break;
        case 'bankDump':
          bankDumpCbs.current.shift()?.(m.data ? new Uint8Array(m.data) : null);
          break;
        case 'fullState':
          fullStateCbs.current.shift()?.(m.state);
          break;
        case 'status':
          pendingStatus.current = m;
          statusFrame.current ||= requestAnimationFrame(flushStatus);
          break;
      }
    });
    return () => {
      unsubscribe();
      if (statusFrame.current) cancelAnimationFrame(statusFrame.current);
      statusFrame.current = 0;
    };
  }, [port]);

  return useMemo(
    () => ({
      ...actions,
      programOptions,
      banks,
      loadReport,
      voice,
      supplement,
      settings,
      microtuningNames,
      partConfigs,
      partVoiceNames,
      selectedPart,
      performanceNames,
      performanceIndex,
      performanceName,
    }),
    [
      actions,
      programOptions,
      banks,
      loadReport,
      voice,
      supplement,
      settings,
      microtuningNames,
      partConfigs,
      partVoiceNames,
      selectedPart,
      performanceNames,
      performanceIndex,
      performanceName,
    ],
  );
}

export function programIndexForVoice(options: ProgramOption[], voice: VoiceRef): number {
  return options.findIndex((o) => voiceRefEquals(o.ref, voice));
}
