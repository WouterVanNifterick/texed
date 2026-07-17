// Serializable snapshot of the whole SynthRack, used for session persistence.
// Banks travel as their SysEx dump (dumpBankSysex output) so the byte-exact
// round-trip already covered by bank-load tests applies here too.

import type { ParsedPerformance } from './performance';
import type { PartConfig } from './synth-rack';
import type { VoiceBankId } from './voice-library';

export const RACK_STATE_SCHEMA = 1;

export interface RackState {
  schema: typeof RACK_STATE_SCHEMA;
  /** One entry per populated half-bank: concatenated AMEM + VMEM SysEx frames. */
  banks: { id: VoiceBankId; data: Uint8Array }[];
  performances: ParsedPerformance[];
  performanceIndex: number;
  parts: PartConfig[];
  selectedPart: number;
  masterTuneCents: number;
  /** Per-part edit buffers (156-byte voice + 35-byte supplement), applied last
   * on restore so unsaved edits win over the bank slot contents. */
  editBuffers: { voice: Uint8Array; supplement: Uint8Array }[];
}
