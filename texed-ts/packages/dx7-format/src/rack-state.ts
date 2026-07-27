// Serializable snapshot of the whole SynthRack, used for session persistence.
// Banks travel as their SysEx dump (dumpBankSysex output) so the byte-exact
// round-trip already covered by bank-load tests applies here too.

import type { ParsedPerformance } from './performance';
import type { PartConfig } from './part-config';
import type { VoiceBankId } from './voice-library';
import type { GlobalSettings } from './global-settings';

// 3 added the per-part filter and reverb send, plus the global compressor
// switch and reverb block. Older snapshots restore with those at their
// defaults, which is silence from the reverb and no filtering.
export const RACK_STATE_SCHEMA = 3;

export interface RackState {
  schema: typeof RACK_STATE_SCHEMA;
  /** One entry per populated half-bank: concatenated AMEM + VMEM SysEx frames. */
  banks: { id: VoiceBankId; data: Uint8Array }[];
  performances: ParsedPerformance[];
  /** Selected library performance, or -1 when the loaded performance came from a
   * file (see `performanceName`). */
  performanceIndex: number;
  /** Display name of the currently loaded performance (edit-buffer identity). */
  performanceName: string;
  parts: PartConfig[];
  selectedPart: number;
  /** Global system-setup settings (engine, volume, polyphony, master tune). */
  global: GlobalSettings;
  /** Loaded micro-tuning tables as raw 256-byte MCRYM/MCRYE payloads; the active
   * one is selected by `global.microtuning`. */
  microtunings: Uint8Array[];
  /** Per-part edit buffers (156-byte voice + 35-byte supplement), applied last
   * on restore so unsaved edits win over the bank slot contents. */
  editBuffers: { voice: Uint8Array; supplement: Uint8Array }[];
}
