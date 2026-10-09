// Built-in patch library browser. Two views over the same collections:
// PERFORMANCES browses the sets the build script grouped (a performance bank
// plus the voice banks its parts reference), VOICES browses banks voice by
// voice. Content comes from public/library (see
// scripts/build-patch-library.mts); the LOADED LIBRARY pseudo-collection
// mirrors whatever is in the rack's voice memory.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react';
import type { Synth } from '../audio/useSynth';
import { VOICE_BANK_LABELS, type VoiceBankId } from '@texed/dx7-format/voice-library';
import { NUM_PARTS, defaultPartConfig } from '@texed/dx7-format/part-config';
import {
  bankById,
  buildSearchIndex,
  fetchLibraryManifest,
  getBankVoices,
  getSetPerfVoices,
  getVoiceBytes,
  loadPerformanceFromSet,
  loadSet,
  type LibVoiceHit,
  type PerfPartVoice,
} from '../state/library';
import { libraryUi, type LibraryUiState } from '../state/library-ui';
import type {
  LibBank,
  LibCollection,
  LibSet,
  LibraryManifest,
} from '@texed/dx7-format/library-manifest';
import { getVoiceName, isFillerVoiceName, VOICES_PER_BANK } from '@texed/dx7-format/voice';
import { helpProps } from '../state/help';
import { useEscapeClose } from '../hooks';
import { Segmented } from '../ui/Segmented';

const LOADED_ID = '__loaded';
const AUDITION_NOTE = 60;
const SEARCH_LIMIT = 200;
/** Voices per column before the list splits into another one. */
const ROWS_PER_COLUMN = 32;
const MAX_COLUMNS = 4;

interface LibraryBrowserProps {
  synth: Synth;
  showMsg: (msg: string) => void;
  onClose: () => void;
}

/** A row of the middle column: a performance, or a voice of a voices set. */
type SetRow =
  | { kind: 'performance'; name: string }
  | { kind: 'voice'; name: string; bank: LibBank; index: number; filler: boolean };

interface VoiceRow {
  name: string;
  filler: boolean;
  amem: boolean;
}

function columnsFor(count: number): number {
  return Math.max(1, Math.min(MAX_COLUMNS, Math.ceil(count / ROWS_PER_COLUMN)));
}

/** The banks a set wires up, each listed once however many slots it fills. */
function setBanks(collection: LibCollection, set: LibSet): LibBank[] {
  const seen = new Set<string>();
  const out: LibBank[] = [];
  for (const slot of set.slots) {
    if (seen.has(slot.bankId)) continue;
    seen.add(slot.bankId);
    const bank = bankById(collection, slot.bankId);
    if (bank) out.push(bank);
  }
  return out;
}

/** Every voice a set brings in, counting each bank once. */
function setVoiceCount(collection: LibCollection, set: LibSet): number {
  return setBanks(collection, set).reduce((n, b) => n + b.voices.length, 0);
}

function extrasLabel(set: LibSet): string | null {
  const e = set.extras;
  if (!e) return null;
  const parts: string[] = [];
  if (e.microtunings) parts.push(`+MICROTUNE ×${e.microtunings}`);
  if (e.systemSetup) parts.push('+SYSTEM SETUP');
  if (e.fractionalScale) parts.push(`+FRAC SCALE ×${e.fractionalScale}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * A piece of browser state that outlives the component. The setter writes the
 * record straight away rather than from an effect, so a gesture that changes
 * something and closes in one go (double-click to load and close) is still
 * remembered.
 */
function useRemembered<K extends keyof LibraryUiState>(key: K) {
  const [value, setValue] = useState<LibraryUiState[K]>(libraryUi[key]);
  const set = useCallback(
    (next: LibraryUiState[K]) => {
      libraryUi[key] = next;
      setValue(next);
    },
    [key],
  );
  return [value, set] as const;
}

/**
 * Record a pane's offset as it scrolls. Reading it back at unmount would be
 * tidier, but React has already detached the refs by then.
 */
const onPaneScroll = (key: keyof LibraryUiState['scroll']) => (e: UIEvent<HTMLDivElement>) => {
  libraryUi.scroll[key] = e.currentTarget.scrollTop;
};

export function LibraryBrowser({ synth, showMsg, onClose }: LibraryBrowserProps) {
  const [manifest, setManifest] = useState<LibraryManifest | null>(null);
  const [manifestPending, setManifestPending] = useState(true);
  const [tab, setTab] = useRemembered('tab');
  const [search, setSearch] = useRemembered('search');
  const [colId, setColId] = useRemembered('colId');
  const [setIdx, setSetIdx] = useRemembered('setIdx');
  const [rowIdx, setRowIdx] = useRemembered('rowIdx');
  const [bankIdx, setBankIdx] = useRemembered('bankIdx');
  const [voiceIdx, setVoiceIdx] = useRemembered('voiceIdx');
  const [audition, setAudition] = useRemembered('audition');
  const [target, setTarget] = useRemembered('target');
  const [resolved, setResolved] = useState<{ set: LibSet; voices: PerfPartVoice[][] } | null>(null);
  const walkTimer = useRef<number | null>(null);
  const voiceListRef = useRef<HTMLDivElement>(null);
  const banksPaneRef = useRef<HTMLDivElement>(null);
  const setsPaneRef = useRef<HTMLDivElement>(null);
  const rowsPaneRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  useEffect(() => {
    fetchLibraryManifest().then(({ manifest: m, error }) => {
      setManifest(m);
      setManifestPending(false);
      if (error) showMsg(`Built-in library unavailable · ${error}`);
      // Only choose a collection when nothing was remembered.
      if (libraryUi.colId) return;
      setColId(m && m.collections.length > 0 ? m.collections[0].id : LOADED_ID);
    });
  }, [showMsg, setColId]);

  useEscapeClose(onClose);

  // ==== data shaping ====

  const collections = useMemo(() => {
    const cols: { id: string; name: string }[] = [];
    if (synth.programOptions.length > 0) cols.push({ id: LOADED_ID, name: 'LOADED LIBRARY' });
    for (const c of manifest?.collections ?? []) cols.push({ id: c.id, name: c.name });
    return cols;
  }, [manifest, synth.programOptions.length]);

  const activeCollection = manifest?.collections.find((c) => c.id === colId) ?? null;
  const sets = activeCollection?.sets ?? [];
  const activeSet = colId === LOADED_ID ? null : (sets[setIdx] ?? null);

  /** Middle-column rows of the performances view. */
  const setRows = ((): SetRow[] => {
    const performances = (names: string[]): SetRow[] =>
      names.map((name) => ({ kind: 'performance', name: name || 'INIT' }));
    if (colId === LOADED_ID) return performances(synth.performanceNames);
    if (!activeSet || !activeCollection) return [];
    if (activeSet.kind === 'performance') return performances(activeSet.performances ?? []);
    return setBanks(activeCollection, activeSet).flatMap((bank) =>
      bank.voices.map((name, index): SetRow => ({
        kind: 'voice',
        name,
        bank,
        index,
        filler: isFillerVoiceName(name),
      })),
    );
  })();

  /** Voices-view rows of the selected bank (or the whole loaded library). */
  const voiceRows = ((): VoiceRow[] => {
    if (colId === LOADED_ID) {
      return synth.programOptions.map((o) => ({
        name: o.label,
        filler: o.filler === true,
        amem: false,
      }));
    }
    const bank = activeCollection?.banks[bankIdx];
    if (!bank) return [];
    // The bank-level II badge already says "this bank carries supplements", so
    // the per-voice mark only earns its place where the bank is mixed.
    const amem = new Set(bank.amemVoices ?? []);
    const mixed = amem.size > 0 && amem.size < bank.voices.length;
    return bank.voices.map((name, i) => ({
      name,
      filler: isFillerVoiceName(name),
      amem: mixed && amem.has(i),
    }));
  })();

  const searchIndex = useMemo(() => (manifest ? buildSearchIndex(manifest) : []), [manifest]);

  const query = search.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!query) return null;
    const builtIn: LibVoiceHit[] = [];
    for (const hit of searchIndex) {
      if (hit.haystack.includes(query)) {
        builtIn.push(hit);
        if (builtIn.length >= SEARCH_LIMIT) break;
      }
    }
    const loaded = synth.programOptions
      .map((opt, i) => ({ opt, i }))
      .filter(({ opt }) => opt.label.toLowerCase().includes(query))
      .slice(0, SEARCH_LIMIT);
    return { builtIn, loaded };
  }, [query, searchIndex, synth.programOptions]);

  // Part voice names for the selected performance set, resolved on demand and
  // kept with the set they belong to, so a stale answer is never shown.
  useEffect(() => {
    if (!activeCollection || !activeSet || activeSet.kind !== 'performance') return;
    let live = true;
    getSetPerfVoices(activeCollection, activeSet)
      .catch((): PerfPartVoice[][] => [])
      .then((voices) => live && setResolved({ set: activeSet, voices }));
    return () => {
      live = false;
    };
  }, [activeCollection, activeSet]);
  const perfVoices = resolved?.set === activeSet ? resolved.voices : null;

  // ==== actions ====

  const auditionVoice = () => {
    if (!audition) return;
    const cfg = synth.partConfigs[synth.selectedPart];
    const ch = cfg && cfg.rxChannel > 0 ? cfg.rxChannel : 1;
    synth.noteOn(AUDITION_NOTE, 100, ch);
    window.setTimeout(() => synth.noteOff(AUDITION_NOTE, ch), 400);
  };

  const loadBuiltInVoice = (bank: LibBank, index: number) => {
    getVoiceBytes(bank, index)
      .then(({ voice, supplement }) => {
        synth.setVoice(voice, { supplement });
        auditionVoice();
      })
      .catch(() => showMsg(`Could not load ${bank.voices[index] ?? 'voice'}`));
  };

  /** Replace the whole rack with a one-part performance holding this voice. */
  const soloVoice = (bank: LibBank, index: number) => {
    getVoiceBytes(bank, index)
      .then(({ voice, supplement }) => {
        const parts = Array.from({ length: NUM_PARTS }, (_, i) => defaultPartConfig(i === 0));
        const voices = Array.from({ length: NUM_PARTS }, (_, i) => (i === 0 ? voice : null));
        const name = getVoiceName(voice).trim() || bank.voices[index] || 'VOICE';
        synth.loadPerformance(name, parts, voices);
        showMsg(
          supplement
            ? `${name} → part 1 only, parts 2-8 off (DX7II supplement not carried)`
            : `${name} → part 1 only, parts 2-8 off`,
        );
        auditionVoice();
      })
      .catch(() => showMsg(`Could not load ${bank.voices[index] ?? 'voice'}`));
  };

  const activateVoiceRow = (index: number) => {
    setVoiceIdx(index);
    if (colId === LOADED_ID) {
      const opt = synth.programOptions[index];
      if (opt) {
        synth.setVoiceRef(opt.ref);
        auditionVoice();
      }
      return;
    }
    const bank = activeCollection?.banks[bankIdx];
    if (bank) loadBuiltInVoice(bank, index);
  };

  /**
   * Arrow-walk: move selection now, load + audition shortly after settling.
   * Padding slots are stepped over, and running off the end of a built-in bank
   * rolls into the next one so one key walks the whole collection. The LOADED
   * column is already a flat list across every populated half-bank.
   */
  const walk = (delta: number) => {
    let next = voiceIdx + delta;
    while (next >= 0 && next < voiceRows.length && voiceRows[next].filler) {
      next += delta;
    }
    const banks = activeCollection?.banks ?? [];
    let rollBank: LibBank | null = null;
    if (next < 0 || next >= voiceRows.length) {
      if (banks.length < 2) return;
      const nb = (bankIdx + (delta > 0 ? 1 : banks.length - 1)) % banks.length;
      rollBank = banks[nb];
      next = delta > 0 ? 0 : rollBank.voices.length - 1;
      setBankIdx(nb);
    }
    setVoiceIdx(next);
    if (walkTimer.current !== null) window.clearTimeout(walkTimer.current);
    walkTimer.current = window.setTimeout(
      () => (rollBank ? loadBuiltInVoice(rollBank, next) : activateVoiceRow(next)),
      80,
    );
  };

  /**
   * Put the panes back where they were, once. The manifest arrives a render or
   * two after mount, so this waits for a pane long enough to hold its offset -
   * setting scrollTop on an empty list would silently clamp to zero.
   */
  useLayoutEffect(() => {
    if (restored.current) return;
    const panes: [HTMLDivElement | null, number][] = [
      [setsPaneRef.current, libraryUi.scroll.sets],
      [rowsPaneRef.current, libraryUi.scroll.rows],
      [banksPaneRef.current, libraryUi.scroll.banks],
      [voiceListRef.current, libraryUi.scroll.voices],
    ];
    // Only the visible tab's panes are mounted; wait for those to fill, and
    // let the hidden tab's remembered offsets simply go unused.
    const wanted = panes.filter(([el, top]) => el && top > 0);
    if (!wanted.every(([el]) => el!.scrollHeight > el!.clientHeight)) return;
    restored.current = true;
    for (const [el, top] of panes) if (el) el.scrollTop = top;
  });

  useEffect(() => {
    if (!restored.current) return;
    const el = voiceListRef.current?.querySelector('.libbrowser-row.selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [voiceIdx, bankIdx, colId]);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      walk(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      walk(-1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const banks = activeCollection?.banks ?? [];
      if (banks.length > 0) {
        const next = (bankIdx + (e.key === 'ArrowRight' ? 1 : banks.length - 1)) % banks.length;
        setBankIdx(next);
        setVoiceIdx(-1);
      }
    } else if (e.key === 'Enter' && voiceIdx >= 0) {
      e.preventDefault();
      activateVoiceRow(voiceIdx);
    }
  };

  const resolveTarget = (): VoiceBankId => {
    if (target !== 'auto') return target;
    const free = synth.banks.find((b) => !b.populated);
    return free?.id ?? 'cartridgeA';
  };

  const loadBankRange = (bank: LibBank, start: number, dest: VoiceBankId) => {
    getBankVoices(bank, start)
      .then(({ voices, supplements }) => {
        synth.loadBankInto(dest, voices, supplements);
        const label = synth.banks.find((b) => b.id === dest)?.label ?? dest;
        showMsg(
          `Loaded ${bank.name}${bank.voices.length > 32 ? ` ${start + 1}–${start + 32}` : ''} → ${label}`,
        );
      })
      .catch(() => showMsg(`Could not load bank ${bank.name}`));
  };

  /** Load the whole set: its voice banks into their slots, then its file. */
  const onLoadSet = (collection: LibCollection, set: LibSet) => {
    const banks = setBanks(collection, set).length;
    showMsg(
      set.kind === 'performance'
        ? `Loading ${set.name} · ${set.performances?.length ?? 0} performances + ${banks} banks…`
        : `Loading ${set.name} · ${banks} banks…`,
    );
    loadSet(synth, collection, set).catch(() => showMsg(`Could not load ${set.name}`));
  };

  const onSelectPerformance = (collection: LibCollection, set: LibSet, index: number) => {
    showMsg(`Loading "${set.performances?.[index] ?? 'performance'}" · 8 parts + its voice banks…`);
    loadPerformanceFromSet(synth, collection, set, index).catch(() =>
      showMsg('Performance load failed'),
    );
  };

  const activateSetRow = (index: number) => {
    setRowIdx(index);
    const row = setRows[index];
    if (!row) return;
    if (row.kind === 'voice') {
      loadBuiltInVoice(row.bank, row.index);
      return;
    }
    if (colId === LOADED_ID) {
      synth.selectPerformance(index);
      return;
    }
    if (activeCollection && activeSet) onSelectPerformance(activeCollection, activeSet, index);
  };

  // ==== render ====

  const banksOfCollection = activeCollection?.banks ?? [];
  const activeBank = colId === LOADED_ID ? null : banksOfCollection[bankIdx];
  const selectedRow = setRows[rowIdx];
  const selectedVoiceRow = selectedRow?.kind === 'voice' ? selectedRow : null;
  const setExtras = activeSet ? extrasLabel(activeSet) : null;
  const selectedPerfParts =
    selectedRow?.kind === 'performance' && perfVoices ? (perfVoices[rowIdx] ?? null) : null;
  /** For the LOADED collection, the live parts stand in for the active perf. */
  const loadedPerfParts =
    colId === LOADED_ID && rowIdx === synth.performanceIndex
      ? synth.partConfigs.map((cfg, i) => ({
          part: i,
          enabled: cfg.enabled,
          label: cfg.voiceLabel ?? 'INIT VOICE',
        }))
      : null;
  const detailParts = selectedPerfParts ?? loadedPerfParts;

  const renderVoiceRows = (rows: VoiceRow[]) => (
    <div className="libbrowser-multicol" style={{ columnCount: columnsFor(rows.length) }}>
      {rows.map((row, i) => (
        <button
          key={i}
          type="button"
          className={`libbrowser-row${i === voiceIdx ? ' selected' : ''}`}
          onClick={() => activateVoiceRow(i)}
          onDoubleClick={onClose}
        >
          <span className="libbrowser-num">{String(i + 1).padStart(3, '0')}</span> {row.name}
          {row.amem && (
            <span className="libbrowser-mark" title="Carries a DX7II AMEM supplement">
              ⅱ
            </span>
          )}
        </button>
      ))}
    </div>
  );

  return (
    <div className="libbrowser-overlay libbrowser-overlay--region">
      <button
        type="button"
        className="overlay-dismiss"
        aria-label="Close library"
        onClick={onClose}
      />
      <div className="libbrowser" role="dialog" aria-label="Patch library">
        <div className="libbrowser-header">
          <span className="libbrowser-title">LIBRARY</span>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              {
                value: 'performances',
                label: 'PERFORMANCES',
                help: 'Browse the grouped sets: a performance bank and the voice banks it uses.',
              },
              {
                value: 'voices',
                label: 'VOICES',
                help: 'Browse built-in and loaded voices bank by bank; click to load into the current part.',
              },
            ]}
          />
          {tab === 'voices' && (
            <input
              className="libbrowser-search"
              placeholder="Search voices…"
              value={search}
              spellCheck={false}
              onChange={(e) => setSearch(e.target.value)}
              {...helpProps(
                'SEARCH',
                'Filters every built-in and loaded voice by name, bank, and collection.',
              )}
            />
          )}
          <label
            className="libbrowser-audition"
            {...helpProps(
              'AUDITION',
              'Plays a short middle C on the current part whenever a voice is selected.',
            )}
          >
            <input
              type="checkbox"
              checked={audition}
              onChange={(e) => setAudition(e.target.checked)}
            />
            AUDITION
          </label>
          <span className="libbrowser-part">→ PART {synth.selectedPart + 1}</span>
          <button type="button" className="libbrowser-btn" onClick={onClose}>
            CLOSE
          </button>
        </div>

        <div className="libbrowser-body">
          <div className="libbrowser-col libbrowser-col-collections">
            <div className="libbrowser-colhead">COLLECTIONS</div>
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`libbrowser-row${c.id === colId ? ' selected' : ''}`}
                onClick={() => {
                  setColId(c.id);
                  setSetIdx(0);
                  setRowIdx(-1);
                  setBankIdx(0);
                  setVoiceIdx(-1);
                }}
              >
                {c.name}
              </button>
            ))}
            {manifestPending && <p className="libbrowser-empty">Loading library…</p>}
            {!manifestPending && !manifest && (
              <p className="libbrowser-empty">
                Built-in library unavailable - LOAD or drop your own .syx files.
              </p>
            )}
          </div>

          {tab === 'performances' && (
            <div className="libbrowser-columns libbrowser-perf">
              <div
                className="libbrowser-col libbrowser-col-sets"
                ref={setsPaneRef}
                onScroll={onPaneScroll('sets')}
              >
                <div className="libbrowser-colhead">SETS</div>
                {colId === LOADED_ID && (
                  <button type="button" className="libbrowser-row selected">
                    LOADED <span className="libbrowser-count">{synth.performanceNames.length}</span>
                  </button>
                )}
                {sets.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`libbrowser-row${i === setIdx ? ' selected' : ''}`}
                    onClick={() => {
                      setSetIdx(i);
                      setRowIdx(-1);
                    }}
                  >
                    {s.name}{' '}
                    <span className="libbrowser-count">
                      {s.kind === 'performance'
                        ? `${s.performances?.length ?? 0} PERF`
                        : `${activeCollection ? setVoiceCount(activeCollection, s) : 0} VOICES`}
                    </span>
                    {s.unresolvedSlots && (
                      <span
                        className="libbrowser-badge warn"
                        title="References a bank nothing provides"
                      >
                        !
                      </span>
                    )}
                  </button>
                ))}
                {colId !== LOADED_ID && sets.length === 0 && (
                  <p className="libbrowser-empty">Nothing in this collection.</p>
                )}
              </div>

              <div
                className="libbrowser-col libbrowser-col-rows"
                ref={rowsPaneRef}
                onScroll={onPaneScroll('rows')}
              >
                <div className="libbrowser-colhead">
                  {activeSet?.kind === 'voices' ? 'VOICES' : 'PERFORMANCES · 8-PART SETUPS'}
                </div>
                <div
                  className="libbrowser-multicol"
                  style={{
                    columnCount: activeSet?.kind === 'voices' ? columnsFor(setRows.length) : 1,
                  }}
                >
                  {setRows.map((row, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`libbrowser-row${i === rowIdx ? ' selected' : ''}`}
                      onClick={() => activateSetRow(i)}
                      onDoubleClick={onClose}
                    >
                      <span className="libbrowser-num">{String(i + 1).padStart(2, '0')}</span>{' '}
                      {row.name}
                    </button>
                  ))}
                </div>
                {setRows.length === 0 && <p className="libbrowser-empty">Nothing here yet.</p>}
              </div>

              <div className="libbrowser-col libbrowser-col-detail">
                <div className="libbrowser-colhead">DETAIL</div>
                {activeSet && activeCollection && (
                  <div className="libbrowser-detail">
                    <div className="libbrowser-detail-head">VOICE BANKS USED</div>
                    {activeSet.slots.map((slot) => {
                      const bank = bankById(activeCollection, slot.bankId);
                      return (
                        <div key={`${slot.slot}${slot.bankId}`} className="libbrowser-detail-row">
                          <span className="libbrowser-slot">{VOICE_BANK_LABELS[slot.slot]}</span>{' '}
                          {bank?.name ?? slot.bankId}
                          {/* Only a bank bigger than a half-bank needs its range spelled out. */}
                          {bank && bank.voices.length > VOICES_PER_BANK
                            ? ` · ${(slot.start ?? 0) + 1}–${Math.min((slot.start ?? 0) + VOICES_PER_BANK, bank.voices.length)}`
                            : ''}
                          {bank?.hasAmem && (
                            <span
                              className="libbrowser-badge"
                              title="Carries DX7II AMEM supplements"
                            >
                              II
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {activeSet.slots.length === 0 && (
                      <div className="libbrowser-detail-row dim">No voice banks.</div>
                    )}
                    {activeSet.unresolvedSlots?.map((slot) => (
                      <div key={slot} className="libbrowser-detail-row warn">
                        <span className="libbrowser-slot">{VOICE_BANK_LABELS[slot]}</span>{' '}
                        referenced, nothing to fill it
                      </div>
                    ))}
                    {setExtras && <div className="libbrowser-detail-row dim">{setExtras}</div>}
                    {activeSet.unsupported?.map((f) => (
                      <div key={f} className="libbrowser-detail-row dim">
                        {f} · format not supported
                      </div>
                    ))}
                  </div>
                )}
                {detailParts && (
                  <div className="libbrowser-detail">
                    <div className="libbrowser-detail-head">
                      PARTS · {selectedRow?.name ?? synth.performanceName}
                    </div>
                    {detailParts.map((p) => (
                      <div
                        key={p.part}
                        className={`libbrowser-detail-row${p.enabled ? '' : ' dim'}`}
                      >
                        <span className="libbrowser-slot">{p.part + 1}</span> {p.label}
                      </div>
                    ))}
                  </div>
                )}
                {selectedRow?.kind === 'performance' && !detailParts && (
                  <p className="libbrowser-empty">
                    {colId === LOADED_ID
                      ? 'Part voices show for the performance currently loaded.'
                      : 'Resolving part voices…'}
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === 'voices' && searchResults && (
            <div className="libbrowser-results" ref={voiceListRef}>
              {searchResults.loaded.map(({ opt, i }) => (
                <button
                  key={`l${i}`}
                  type="button"
                  className="libbrowser-row"
                  onClick={() => {
                    synth.setVoiceRef(opt.ref);
                    auditionVoice();
                  }}
                  onDoubleClick={onClose}
                >
                  <span className="libbrowser-crumb">LOADED ›</span> {opt.label}
                </button>
              ))}
              {searchResults.builtIn.map((hit, i) => (
                <button
                  key={`b${i}`}
                  type="button"
                  className="libbrowser-row"
                  onClick={() => loadBuiltInVoice(hit.bank, hit.index)}
                  onDoubleClick={onClose}
                >
                  <span className="libbrowser-crumb">
                    {hit.collectionName} › {hit.bank.name} ›
                  </span>{' '}
                  {hit.name}
                </button>
              ))}
              {searchResults.loaded.length === 0 && searchResults.builtIn.length === 0 && (
                <p className="libbrowser-empty">No voices match “{search.trim()}”.</p>
              )}
            </div>
          )}

          {/* The columns form one composite widget: a single tab stop that moves
            its selection with the arrow keys and auditions with Enter, with
            every entry also reachable as a real button. That needs a focusable
            container, which the two rules below would otherwise forbid. */}
          {tab === 'voices' && !searchResults && (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
            <div
              className="libbrowser-columns"
              role="group"
              aria-label="Voice browser"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
              onKeyDown={onListKeyDown}
            >
              <div
                className="libbrowser-col libbrowser-col-banks"
                ref={banksPaneRef}
                onScroll={onPaneScroll('banks')}
              >
                <div className="libbrowser-colhead">
                  {colId === LOADED_ID ? 'VOICE MEMORY' : 'BANKS'}
                </div>
                {colId === LOADED_ID ? (
                  <div className="libbrowser-bankinfo">
                    {synth.banks.map((b) => (
                      <div
                        key={b.id}
                        className={`libbrowser-bankrow${b.populated ? '' : ' empty'}`}
                      >
                        {b.label} {b.populated ? '' : '· empty'}
                      </div>
                    ))}
                  </div>
                ) : (
                  banksOfCollection.map((b, i) => (
                    <button
                      key={b.id}
                      type="button"
                      className={`libbrowser-row${i === bankIdx ? ' selected' : ''}`}
                      onClick={() => {
                        setBankIdx(i);
                        setVoiceIdx(-1);
                      }}
                    >
                      {b.name} <span className="libbrowser-count">{b.voices.length}</span>
                      {b.hasAmem && (
                        <span
                          className="libbrowser-badge"
                          title="Carries DX7II AMEM supplements (fractional scaling, unison, extended controllers)"
                        >
                          II
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>

              <div
                className="libbrowser-col libbrowser-col-voices"
                ref={voiceListRef}
                onScroll={onPaneScroll('voices')}
              >
                <div className="libbrowser-colhead">
                  {activeBank
                    ? `VOICES · ${activeBank.hasAmem ? 'DX7II (VMEM + AMEM)' : 'DX7 (VMEM)'}`
                    : 'VOICES'}
                </div>
                {renderVoiceRows(voiceRows)}
                {voiceRows.length === 0 && <p className="libbrowser-empty">No voices here yet.</p>}
              </div>
            </div>
          )}
        </div>

        <div className="libbrowser-footer">
          {tab === 'voices' && !searchResults && activeBank && (
            <>
              <label
                {...helpProps(
                  'TARGET',
                  'Which half-bank of voice memory LOAD BANK writes into. AUTO picks the first empty one.',
                )}
              >
                TARGET&nbsp;
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value as VoiceBankId | 'auto')}
                >
                  <option value="auto">AUTO</option>
                  {synth.banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                      {b.populated ? ' ●' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {activeBank.voices.length <= 32 ? (
                <button
                  type="button"
                  className="libbrowser-btn"
                  onClick={() => loadBankRange(activeBank, 0, resolveTarget())}
                  {...helpProps(
                    'LOAD BANK',
                    'Copies this 32-voice bank into the target half-bank of voice memory.',
                  )}
                >
                  LOAD BANK → {VOICE_BANK_LABELS[resolveTarget()]}
                </button>
              ) : (
                [0, 1, 2, 3].map((q) =>
                  q * 32 < activeBank.voices.length ? (
                    <button
                      key={q}
                      type="button"
                      className="libbrowser-btn"
                      onClick={() => loadBankRange(activeBank, q * 32, resolveTarget())}
                      {...helpProps(
                        'LOAD RANGE',
                        'Copies these 32 voices into the target half-bank of voice memory.',
                      )}
                    >
                      {q * 32 + 1}–{Math.min((q + 1) * 32, activeBank.voices.length)} →
                    </button>
                  ) : null,
                )
              )}
              <button
                type="button"
                className="libbrowser-btn"
                disabled={voiceIdx < 0}
                onClick={() => activateVoiceRow(voiceIdx)}
                {...helpProps(
                  'LOAD VOICE',
                  "Loads the selected voice into the current part's edit buffer; other parts keep playing.",
                )}
              >
                LOAD VOICE → PART {synth.selectedPart + 1}
              </button>
              <button
                type="button"
                className="libbrowser-btn"
                disabled={voiceIdx < 0}
                onClick={() => soloVoice(activeBank, voiceIdx)}
                {...helpProps(
                  'SOLO VOICE',
                  'Replaces the whole rack with a new performance: this voice on part 1, parts 2-8 off.',
                )}
              >
                SOLO VOICE → NEW PERFORMANCE
              </button>
            </>
          )}
          {tab === 'performances' && activeCollection && activeSet && (
            <>
              {activeSet.kind === 'performance' && (
                <button
                  type="button"
                  className="libbrowser-btn"
                  disabled={rowIdx < 0}
                  onClick={() => onSelectPerformance(activeCollection, activeSet, rowIdx)}
                  {...helpProps(
                    'LOAD PERFORMANCE',
                    'Loads this one performance: all 8 parts plus the voice banks it needs.',
                  )}
                >
                  LOAD PERFORMANCE → 8 PARTS
                </button>
              )}
              <button
                type="button"
                className="libbrowser-btn"
                onClick={() => onLoadSet(activeCollection, activeSet)}
                {...helpProps(
                  'LOAD SET',
                  'Loads every performance in this set plus all of its voice banks, replacing voice memory.',
                )}
              >
                {activeSet.kind === 'performance'
                  ? `LOAD SET → ${activeSet.performances?.length ?? 0} PERFORMANCES + ${setBanks(activeCollection, activeSet).length} BANKS`
                  : `LOAD SET → ${setVoiceCount(activeCollection, activeSet)} VOICES INTO ${activeSet.slots.length} HALF-BANK${activeSet.slots.length === 1 ? '' : 'S'}`}
              </button>
              {selectedVoiceRow && (
                <>
                  <button
                    type="button"
                    className="libbrowser-btn"
                    onClick={() => loadBuiltInVoice(selectedVoiceRow.bank, selectedVoiceRow.index)}
                    {...helpProps(
                      'LOAD VOICE',
                      "Loads the selected voice into the current part's edit buffer.",
                    )}
                  >
                    LOAD VOICE → PART {synth.selectedPart + 1}
                  </button>
                  <button
                    type="button"
                    className="libbrowser-btn"
                    onClick={() => soloVoice(selectedVoiceRow.bank, selectedVoiceRow.index)}
                    {...helpProps(
                      'SOLO VOICE',
                      'Replaces the whole rack with a new performance: this voice on part 1, parts 2-8 off.',
                    )}
                  >
                    SOLO VOICE → NEW PERFORMANCE
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <p className="libbrowser-note">
          {tab === 'performances'
            ? 'Click a performance to load it (8 parts + the voice banks it uses); double-click to load and close. LOAD SET brings in every performance of the set. Both overwrite the half-banks listed under DETAIL.'
            : 'Click a voice to hear it on the current part; double-click to load and close. ↑/↓ walk and audition, ←/→ switch banks, Enter loads. LOAD BANK overwrites one half-bank of voice memory; SOLO VOICE replaces the whole rack.'}
        </p>
      </div>
    </div>
  );
}
