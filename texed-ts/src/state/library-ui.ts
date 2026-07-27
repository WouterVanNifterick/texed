// Where the library browser was when it was last closed. The browser is
// unmounted on close, so this outlives it: a plain module-level record, in the
// same spirit as the small stores in env-axis.ts and help.ts. Nothing outside
// the browser reads it, so there is nothing to subscribe to.

import type { VoiceBankId } from '@texed/dx7-format/voice-library';

export interface LibraryUiState {
  tab: 'performances' | 'voices';
  search: string;
  /** Collection id, or LOADED_ID for the rack's own contents. */
  colId: string;
  /** Index into the active collection's sets (performances tab). */
  setIdx: number;
  /** Row within the selected set: a performance, or a voice for a voices set. */
  rowIdx: number;
  /** Index into the active collection's banks (voices tab). */
  bankIdx: number;
  voiceIdx: number;
  audition: boolean;
  /** Destination half-bank for LOAD BANK; 'auto' picks the first empty one. */
  target: VoiceBankId | 'auto';
  scroll: { sets: number; rows: number; banks: number; voices: number };
}

export const libraryUi: LibraryUiState = {
  tab: 'performances',
  search: '',
  colId: '',
  setIdx: 0,
  rowIdx: -1,
  bankIdx: 0,
  voiceIdx: -1,
  audition: true,
  target: 'auto',
  scroll: { sets: 0, rows: 0, banks: 0, voices: 0 },
};
