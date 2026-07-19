// Built-in patch library browser: collections → banks → voices with search,
// instant audition into the current part, bank loading into half-bank slots,
// and a performances tab. Content comes from public/library (see
// scripts/build-patch-library.mts); the LOADED LIBRARY pseudo-collection
// mirrors whatever is in the rack's voice memory.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DexedSynth } from '../audio/useDexedSynth';
import type { VoiceBankId } from '@texed/dx7-format/voice-library';
import {
  buildSearchIndex,
  fetchLibraryManifest,
  getBankVoices,
  getVoiceBytes,
  loadPerformanceSet,
  type LibVoiceHit,
} from '../state/library';
import type { LibBank, LibPerfSet, LibraryManifest } from '../state/library-manifest';
import { helpProps } from '../state/help';
import { Segmented } from './ui';

const LOADED_ID = '__loaded';
const AUDITION_NOTE = 60;
const SEARCH_LIMIT = 200;

interface LibraryBrowserProps {
  synth: DexedSynth;
  showMsg: (msg: string) => void;
  onClose: () => void;
}

export function LibraryBrowser({ synth, showMsg, onClose }: LibraryBrowserProps) {
  const [manifest, setManifest] = useState<LibraryManifest | null>(null);
  const [manifestPending, setManifestPending] = useState(true);
  const [tab, setTab] = useState<'voices' | 'performances'>('voices');
  const [search, setSearch] = useState('');
  const [colId, setColId] = useState<string>(LOADED_ID);
  const [bankIdx, setBankIdx] = useState(0);
  const [voiceIdx, setVoiceIdx] = useState(-1);
  const [audition, setAudition] = useState(true);
  const [target, setTarget] = useState<VoiceBankId | 'auto'>('auto');
  const [perfSetIdx, setPerfSetIdx] = useState(0);
  const [perfVoiceIdx, setPerfVoiceIdx] = useState(-1);
  const walkTimer = useRef<number | null>(null);
  const voiceListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLibraryManifest().then((m) => {
      setManifest(m);
      setManifestPending(false);
      if (m && m.collections.length > 0)
        setColId((cur) => (cur === LOADED_ID ? m.collections[0].id : cur));
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // ==== data shaping ====

  const collections = useMemo(() => {
    const cols: { id: string; name: string }[] = [];
    if (synth.programOptions.length > 0) cols.push({ id: LOADED_ID, name: 'LOADED LIBRARY' });
    for (const c of manifest?.collections ?? []) cols.push({ id: c.id, name: c.name });
    return cols;
  }, [manifest, synth.programOptions.length]);

  const activeCollection = manifest?.collections.find((c) => c.id === colId) ?? null;

  /** Voice rows of the active bank column (built-in bank or loaded programs). */
  const voiceRows: { name: string; sub?: string }[] = useMemo(() => {
    if (colId === LOADED_ID) return synth.programOptions.map((o) => ({ name: o.label }));
    const bank = activeCollection?.banks[bankIdx];
    return bank ? bank.voices.map((name) => ({ name })) : [];
  }, [colId, activeCollection, bankIdx, synth.programOptions]);

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

  // ==== actions ====

  const auditionVoice = useCallback(() => {
    if (!audition) return;
    const cfg = synth.partConfigs[synth.selectedPart];
    const ch = cfg && cfg.rxChannel > 0 ? cfg.rxChannel : 1;
    synth.noteOn(AUDITION_NOTE, 100, ch);
    window.setTimeout(() => synth.noteOff(AUDITION_NOTE, ch), 400);
  }, [audition, synth]);

  const loadBuiltInVoice = useCallback(
    (bank: LibBank, index: number) => {
      getVoiceBytes(bank, index)
        .then(({ voice, supplement }) => {
          synth.setVoice(voice, { supplement });
          auditionVoice();
        })
        .catch(() => showMsg(`Could not load ${bank.voices[index] ?? 'voice'}`));
    },
    [synth, auditionVoice, showMsg],
  );

  const activateVoiceRow = useCallback(
    (index: number) => {
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
    },
    [colId, activeCollection, bankIdx, synth, auditionVoice, loadBuiltInVoice],
  );

  /** Arrow-walk: move selection now, load + audition shortly after settling. */
  const walkTo = useCallback(
    (index: number) => {
      const max = voiceRows.length - 1;
      const next = Math.max(0, Math.min(max, index));
      setVoiceIdx(next);
      if (walkTimer.current !== null) window.clearTimeout(walkTimer.current);
      walkTimer.current = window.setTimeout(() => activateVoiceRow(next), 80);
    },
    [voiceRows.length, activateVoiceRow],
  );

  useEffect(() => {
    const el = voiceListRef.current?.querySelector('.libbrowser-row.selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [voiceIdx, bankIdx, colId]);

  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        walkTo(voiceIdx + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        walkTo(voiceIdx - 1);
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
    },
    [walkTo, voiceIdx, activeCollection, bankIdx, activateVoiceRow],
  );

  const resolveTarget = useCallback((): VoiceBankId => {
    if (target !== 'auto') return target;
    const free = synth.banks.find((b) => !b.populated);
    return free?.id ?? 'cartridgeA';
  }, [target, synth.banks]);

  const loadBankRange = useCallback(
    (bank: LibBank, start: number, dest: VoiceBankId) => {
      getBankVoices(bank, start)
        .then(({ voices, supplements }) => {
          synth.loadBankInto(dest, voices, supplements);
          const label = synth.banks.find((b) => b.id === dest)?.label ?? dest;
          showMsg(
            `Loaded ${bank.name}${bank.voices.length > 32 ? ` ${start + 1}–${start + 32}` : ''} → ${label}`,
          );
        })
        .catch(() => showMsg(`Could not load bank ${bank.name}`));
    },
    [synth, showMsg],
  );

  const loadAll128 = useCallback(
    (bank: LibBank) => {
      const order: VoiceBankId[] = ['internalA', 'internalB', 'cartridgeA', 'cartridgeB'];
      order.forEach((dest, i) => loadBankRange(bank, i * 32, dest));
      showMsg(`Loaded ${bank.name} into all four half-banks`);
    },
    [loadBankRange, showMsg],
  );

  const onSelectPerformance = useCallback(
    (set: LibPerfSet, index: number, collectionName: string) => {
      showMsg(
        set.requiresBankFiles.length > 0
          ? `Loading ${collectionName} banks + "${set.names[index]}" (replaces bank slots)…`
          : `Loading "${set.names[index]}"…`,
      );
      loadPerformanceSet(synth, set, index).catch(() => showMsg('Performance load failed'));
    },
    [synth, showMsg],
  );

  // ==== render ====

  const banksOfCollection = activeCollection?.banks ?? [];
  const activeBank = colId === LOADED_ID ? null : banksOfCollection[bankIdx];
  const perfCollections = (manifest?.collections ?? []).filter((c) => c.performanceSets.length > 0);
  const perfSets = perfCollections.flatMap((c) =>
    c.performanceSets.map((set) => ({ collection: c.name, set })),
  );

  return (
    <div className="libbrowser-overlay" onClick={onClose}>
      <div className="libbrowser" onClick={(e) => e.stopPropagation()}>
        <div className="libbrowser-header">
          <span className="libbrowser-title">LIBRARY</span>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              {
                value: 'voices',
                label: 'VOICES',
                help: 'Browse built-in and loaded voices; click to load into the current part.',
              },
              {
                value: 'performances',
                label: 'PERFORMANCES',
                help: 'Browse loaded and built-in multi-part performances.',
              },
            ]}
          />
          {tab === 'voices' && (
            <>
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
            </>
          )}
          <span className="libbrowser-part">→ PART {synth.selectedPart + 1}</span>
          <button type="button" className="libbrowser-btn" onClick={onClose}>
            CLOSE
          </button>
        </div>

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

        {tab === 'voices' && !searchResults && (
          <div className="libbrowser-columns" tabIndex={0} onKeyDown={onListKeyDown}>
            <div className="libbrowser-col libbrowser-col-collections">
              <div className="libbrowser-colhead">COLLECTIONS</div>
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`libbrowser-row${c.id === colId ? ' selected' : ''}`}
                  onClick={() => {
                    setColId(c.id);
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

            <div className="libbrowser-col libbrowser-col-banks">
              <div className="libbrowser-colhead">
                {colId === LOADED_ID ? 'VOICE MEMORY' : 'BANKS'}
              </div>
              {colId === LOADED_ID ? (
                <div className="libbrowser-bankinfo">
                  {synth.banks.map((b) => (
                    <div key={b.id} className={`libbrowser-bankrow${b.populated ? '' : ' empty'}`}>
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

            <div className="libbrowser-col libbrowser-col-voices" ref={voiceListRef}>
              <div className="libbrowser-colhead">
                {activeBank
                  ? `VOICES · ${activeBank.hasAmem ? 'DX7II (VMEM + AMEM)' : 'DX7 (VMEM)'}`
                  : 'VOICES'}
              </div>
              {voiceRows.map((row, i) => (
                <button
                  key={i}
                  type="button"
                  className={`libbrowser-row${i === voiceIdx ? ' selected' : ''}`}
                  onClick={() => activateVoiceRow(i)}
                  onDoubleClick={onClose}
                >
                  <span className="libbrowser-num">{String(i + 1).padStart(3, '0')}</span>{' '}
                  {row.name}
                </button>
              ))}
              {voiceRows.length === 0 && <p className="libbrowser-empty">No voices here yet.</p>}
            </div>
          </div>
        )}

        {tab === 'voices' && !searchResults && activeBank && (
          <div className="libbrowser-footer">
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
                LOAD BANK →
              </button>
            ) : (
              <>
                {[0, 1, 2, 3].map((q) =>
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
                )}
                <button
                  type="button"
                  className="libbrowser-btn"
                  onClick={() => loadAll128(activeBank)}
                  {...helpProps(
                    'LOAD ALL',
                    'Fills all four half-banks (INT 1–64 + CRT 1–64) with this 128-voice bank.',
                  )}
                >
                  LOAD ALL 128
                </button>
              </>
            )}
          </div>
        )}

        {tab === 'performances' && (
          <div className="libbrowser-columns libbrowser-perf">
            <div className="libbrowser-col libbrowser-col-banks">
              <div className="libbrowser-colhead">PERFORMANCE SETS</div>
              {synth.performanceNames.length > 0 && (
                <button
                  type="button"
                  className={`libbrowser-row${perfSetIdx === -1 ? ' selected' : ''}`}
                  onClick={() => {
                    setPerfSetIdx(-1);
                    setPerfVoiceIdx(-1);
                  }}
                >
                  LOADED <span className="libbrowser-count">{synth.performanceNames.length}</span>
                </button>
              )}
              {perfSets.map(({ collection, set }, i) => (
                <button
                  key={set.id}
                  type="button"
                  className={`libbrowser-row${i === perfSetIdx ? ' selected' : ''}`}
                  onClick={() => {
                    setPerfSetIdx(i);
                    setPerfVoiceIdx(-1);
                  }}
                >
                  <span className="libbrowser-crumb">{collection} ›</span> {set.name}{' '}
                  <span className="libbrowser-count">{set.names.length}</span>
                </button>
              ))}
              {perfSets.length === 0 && synth.performanceNames.length === 0 && (
                <p className="libbrowser-empty">No performances available.</p>
              )}
            </div>
            <div className="libbrowser-col libbrowser-col-voices">
              <div className="libbrowser-colhead">PERFORMANCES · 8-PART SETUPS</div>
              {perfSetIdx === -1
                ? synth.performanceNames.map((name, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`libbrowser-row${i === synth.performanceIndex ? ' selected' : ''}`}
                      onClick={() => synth.selectPerformance(i)}
                      onDoubleClick={onClose}
                    >
                      <span className="libbrowser-num">{String(i + 1).padStart(2, '0')}</span>{' '}
                      {name || 'INIT'}
                    </button>
                  ))
                : perfSets[perfSetIdx] &&
                  perfSets[perfSetIdx].set.names.map((name, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`libbrowser-row${i === perfVoiceIdx ? ' selected' : ''}`}
                      onClick={() => {
                        setPerfVoiceIdx(i);
                        onSelectPerformance(
                          perfSets[perfSetIdx].set,
                          i,
                          perfSets[perfSetIdx].collection,
                        );
                      }}
                      onDoubleClick={onClose}
                    >
                      <span className="libbrowser-num">{String(i + 1).padStart(2, '0')}</span>{' '}
                      {name || 'INIT'}
                    </button>
                  ))}
            </div>
          </div>
        )}

        <p className="libbrowser-note">
          {tab === 'voices'
            ? 'Click a voice to hear it on the current part; double-click to load and close. ↑/↓ walk and audition, ←/→ switch banks, Enter loads. Loading a bank overwrites that half-bank of voice memory.'
            : 'Click a performance to load it; double-click to load and close. Selecting a built-in performance loads the banks it needs (overwriting voice memory) and configures all 8 parts.'}
        </p>
      </div>
    </div>
  );
}
