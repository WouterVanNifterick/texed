// Every way the UI can mutate the rack, as one object built once per port.
//
// These used to be 27 useCallbacks reassembled in a useMemo that listed all 27
// twice. The list was ceremony: each one closes over the port (held in a ref)
// and React's setState functions, so none of them can ever change identity.
// Building the object once makes that a fact rather than a promise.

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { MsgType, type SynthCommand, type RackState } from '@texed/synth-protocol/protocol';
import type { SynthPort } from '@texed/synth-protocol/port';
import type { ProgramOption } from '@texed/dx7-format/part-config';
import type { GlobalSettings } from '@texed/dx7-format/global-settings';
import { emitVoiceParam, emitSupplement } from './midi-out';
import type { SynthActions, SynthStatus } from './synth-types';

/** The mirror state the actions write through when updating optimistically. */
export interface MirrorHandles {
  setVoice: Dispatch<SetStateAction<Uint8Array>>;
  setSupplement: Dispatch<SetStateAction<Uint8Array>>;
  setSettings: Dispatch<SetStateAction<GlobalSettings>>;
  /** Mirrors `supplement` so live ACED emission never reads a stale closure. */
  supplement: RefObject<Uint8Array>;
  programOptions: RefObject<ProgramOption[]>;
  // Queues, not single slots: two requests in flight used to drop the first
  // reply. Replies arrive in request order because the worklet is single-threaded.
  bankDumpCbs: RefObject<((data: Uint8Array | null) => void)[]>;
  fullStateCbs: RefObject<((state: RackState) => void)[]>;
  statusSubs: RefObject<Set<(s: SynthStatus) => void>>;
}

/** Copy into a fresh transferable buffer, since the caller keeps its own view. */
function detach(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export function createSynthActions(port: SynthPort, m: MirrorHandles): SynthActions {
  const post = (msg: SynthCommand, transfer?: ArrayBuffer[]) => port.send(msg, transfer);

  return {
    start: () => port.start(),

    noteOn: (note, velocity, channel = 1) =>
      post({ type: MsgType.NoteOn, note, velocity, channel }),
    noteOff: (note, channel = 1) => post({ type: MsgType.NoteOff, note, channel }),
    controlChange: (controller, value, channel) =>
      post({ type: MsgType.Cc, controller, value, channel }),
    pitchBend: (value, channel) => post({ type: MsgType.PitchBend, value, channel }),
    aftertouch: (value, channel) => post({ type: MsgType.Aftertouch, value, channel }),
    panic: () => post({ type: MsgType.Panic }),

    setParam: (offset, value) => {
      m.setVoice((prev) => {
        const next = new Uint8Array(prev);
        next[offset] = value;
        return next;
      });
      post({ type: MsgType.SetParam, offset, value });
      emitVoiceParam(offset, value);
    },

    setSupplementParam: (offset, value) => {
      // Chained through the ref so a rapid burst of edits accumulates instead of
      // each one rebuilding from the same stale snapshot.
      const next = new Uint8Array(m.supplement.current);
      next[offset] = value;
      m.supplement.current = next;
      m.setSupplement(next);
      post({ type: MsgType.SetSupplementParam, offset, value });
      emitSupplement(next);
    },

    setVoice: (voice, opts) => {
      // Only mirror into the editor when the target is the part being edited.
      if (opts?.partIndex === undefined) {
        m.setVoice(voice);
        if (opts?.supplement) m.setSupplement(opts.supplement);
      }
      const data = detach(voice);
      const transfer = [data];
      let supplement: ArrayBuffer | undefined;
      if (opts?.supplement) {
        supplement = detach(opts.supplement);
        transfer.push(supplement);
      }
      post({ type: MsgType.LoadVoice, data, supplement, partIndex: opts?.partIndex }, transfer);
    },

    setVoiceRef: (voice, partIndex) => post({ type: MsgType.SetVoiceRef, voice, partIndex }),

    setProgram: (index) => {
      const opt = m.programOptions.current[index];
      if (opt) post({ type: MsgType.SetVoiceRef, voice: opt.ref });
    },

    loadCart: (data) => post({ type: MsgType.LoadCart, data }, [data]),

    loadBankInto: (bank, voices, supplements) => {
      const vbuf = detach(voices);
      const transfer = [vbuf];
      let sbuf: ArrayBuffer | undefined;
      if (supplements) {
        sbuf = detach(supplements);
        transfer.push(sbuf);
      }
      post({ type: MsgType.LoadBankInto, bank, voices: vbuf, supplements: sbuf }, transfer);
    },

    storeVoice: (dest) => post({ type: MsgType.StoreVoice, dest }),

    // Settings are echoed back by the worklet, but updating the mirror first
    // keeps the control from snapping back for a frame.
    setEngine: (engine) => {
      m.setSettings((s) => ({ ...s, engine }));
      post({ type: MsgType.SetEngine, engine });
    },
    setVolume: (volume) => {
      m.setSettings((s) => ({ ...s, volume }));
      post({ type: MsgType.SetVolume, volume });
    },
    setMasterTune: (cents) => {
      m.setSettings((s) => ({ ...s, masterTuneCents: cents }));
      post({ type: MsgType.SetMasterTune, cents });
    },
    setMicrotuning: (index) => {
      m.setSettings((s) => ({ ...s, microtuning: index }));
      post({ type: MsgType.SetMicrotuning, index });
    },
    setPolyphonyCap: (cap) => {
      m.setSettings((s) => ({ ...s, polyphony: cap }));
      post({ type: MsgType.SetPolyphonyCap, cap });
    },

    selectPart: (index) => post({ type: MsgType.SelectPart, index }),
    setPart: (index, config) => post({ type: MsgType.SetPart, index, config }),
    selectPerformance: (index) => post({ type: MsgType.SelectPerformance, index }),

    loadPerformance: (name, parts, voices) => {
      const payload = voices.map((v) => (v ? new Uint8Array(v) : null));
      const transfer: ArrayBuffer[] = [];
      for (const v of payload) {
        if (v) transfer.push(v.buffer as ArrayBuffer);
      }
      post({ type: MsgType.LoadPerformance, name, parts, voices: payload }, transfer);
    },

    requestBankDump: (bank, cb) => {
      m.bankDumpCbs.current.push(cb);
      post({ type: MsgType.RequestBankDump, bank });
    },
    getFullState: (cb) => {
      m.fullStateCbs.current.push(cb);
      post({ type: MsgType.GetFullState });
    },
    setFullState: (state) => post({ type: MsgType.SetFullState, state }),

    subscribeStatus: (cb) => {
      m.statusSubs.current.add(cb);
      return () => m.statusSubs.current.delete(cb);
    },
  };
}
