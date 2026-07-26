import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RACK_STATE_SCHEMA, type RackState } from '@texed/dx7-format/rack-state';
import { DEFAULT_GLOBAL_SETTINGS } from '@texed/dx7-format/global-settings';
import { clearSession, loadSession, saveSession, SESSION_SCHEMA } from '../persistence';

function rack(): RackState {
  return {
    schema: RACK_STATE_SCHEMA,
    banks: [{ id: 'internalA', data: new Uint8Array([1, 2, 3]) }],
    performances: [],
    performanceIndex: -1,
    performanceName: 'Test',
    parts: [],
    selectedPart: 3,
    global: DEFAULT_GLOBAL_SETTINGS,
    microtunings: [],
    editBuffers: [{ voice: new Uint8Array(156).fill(7), supplement: new Uint8Array(35) }],
  };
}

describe('session persistence', () => {
  beforeEach(async () => {
    await clearSession();
  });

  it('reads back nothing before anything is saved', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('round-trips a rack snapshot including its binary payloads', async () => {
    await saveSession({ schema: SESSION_SCHEMA, savedAt: 1234, rack: rack() });

    const loaded = await loadSession();
    expect(loaded?.savedAt).toBe(1234);
    expect(loaded?.rack.selectedPart).toBe(3);
    expect(loaded?.rack.performanceName).toBe('Test');
    expect(loaded?.rack.banks[0].data).toEqual(new Uint8Array([1, 2, 3]));
    expect(loaded?.rack.editBuffers[0].voice[0]).toBe(7);
  });

  it('drops a record written by an older schema', async () => {
    const stale = { schema: SESSION_SCHEMA - 1, savedAt: 1, rack: rack() };
    await saveSession(stale as unknown as Parameters<typeof saveSession>[0]);

    expect(await loadSession()).toBeNull();
  });

  it('forgets the session on clear', async () => {
    await saveSession({ schema: SESSION_SCHEMA, savedAt: 1, rack: rack() });
    await clearSession();

    expect(await loadSession()).toBeNull();
  });
});
