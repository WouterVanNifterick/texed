# What Texed changes compared to Dexed

Texed's synthesis engine started as a line-by-line TypeScript port of the
`music-synthesizer-for-android` (msfa) code vendored inside
[Dexed](https://github.com/asb2m10/dexed). This document records everywhere the two have since
diverged, and why.

It exists for two reasons. It is the honest answer to "how is this different from Dexed in a
browser?", and it is the working list for a possible upstream contribution — every item in
[Part A](#part-a--dsp-accuracy-fixes) is a self-contained fix to shared msfa code that would apply
to Dexed essentially unchanged. Both projects are GPL-3, so there is no licence obstacle.

References like `msfa/dx7note.cc:111` point into Dexed's own tree (mirrored locally, gitignored, at
`dexed-juce/`). Our side is `texed-ts/packages/dx7-engine/src/`.

---

## Part A — DSP accuracy fixes

These are places where msfa reconstructed DX7 behaviour by inference and got it wrong. The
evidence is the [Yamaha DX7 v1.8 ROM disassembly](https://github.com/ajxs/yamaha_dx7_rom_disassembly)
and Ken Shirriff's [OPS/EGS die analysis](https://www.righto.com/2021/11/reverse-engineering-yamaha-dx7.html);
see [architecture.md](architecture.md) for the full source list.

One caveat that shapes all of it: **on real hardware the envelope generators live in the EGS chip,
not in firmware.** The ROM only converts patch bytes into EGS register writes. So the disassembly
is authoritative for parameter conversion and silent about chip-internal behaviour. Every fix below
is on the firmware side of that line, which is why they are verifiable rather than tuned by ear.

Items marked **[toggle]** change the sound of existing patches enough that a user might want the
old behaviour; Texed gates those behind an ACCURACY setting (`hardware` by default, `dexed` for
A/B). The rest are unconditional. A port could reasonably make all of them unconditional.

### A1. Keyboard level scaling: the exponential curve is wrong above group 22 **[toggle]**

`msfa/dx7note.cc:111` declares a 33-entry `exp_scale_data`. It tracks the ROM's
`TABLE_KBD_SCALING_CURVE_EXP` up to index 22 and then goes linear (+16 per step) where the hardware
keeps doubling every four groups and saturates at 255:

| group | 23  | 24  | 25  | 26  | 27  | 28  | 29–35                |
| ----- | --- | --- | --- | --- | --- | --- | -------------------- |
| ROM   | 113 | 134 | 160 | 190 | 224 | 255 | 255                  |
| msfa  | 110 | 126 | 142 | 158 | 174 | 190 | _(table ends at 32)_ |

At depth 50, group 28 yields 127 on hardware and 95 in msfa — **24 dB**. Groups 23–28 are 69–84
semitones above the break point, so with a low break point this starts around MIDI 89, inside the
playable range. The common case it spoils is a negative right curve rolling off the top of the
keyboard: msfa leaves the top octaves up to ~20 dB too loud.

Texed replaces `ScaleCurve` (`msfa/dx7note.cc:116`) with the ROM's own arithmetic:

```
D = (660 * depth) >> 8                          // PATCH_ACTIVATE_SCALE_VALUE
s = min(127, (curve[min(group, 35)] * D) >> 8)
```

That single change also picks up three smaller errors: the magic multiplier `329` should be `330`
(the ROM's is `660/2`), the ROM truncates twice rather than once, and the linear curve is a _table_
on hardware — so it carries a genuine ROM anomaly at index 22 (`$B2` = 178, not the 176 the pattern
implies) and saturates at index 32, neither of which a computed `group * depth * 329 >> 12`
reproduces.

Our tables: `env-tables.ts` `kbdScalingCurveExp` / `kbdScalingCurveLin`, applied by `kbdScaleCurve`.

### A2. Velocity is about twice too deep below MIDI velocity 24 **[toggle]**

`msfa/dx7note.cc:81` has a 64-entry `velocity_data` indexed by `velocity >> 1`, with
`ScaleVelocity` computing `((sensitivity * (velocity_data[v>>1] - 239) + 7) >> 3) << 4`
(`:92`). Above velocity ~24 it tracks the hardware within about 2 dB rms. Below that it collapses:
`velocity_data[0]` is 0, an outlier against 70 at index 1. Maximum velocity attenuation at
sensitivity 7 comes out at **83.9 dB** against the hardware's **42.1 dB**.

The ROM chain is two lookups and an add:

```
internalVel = TABLE_MIDI_VEL[midiVelocity >> 2]          // inverted scale, 0 = hardest
velScale    = TABLE_OP_VOLUME_VELOCITY_SCALE[internalVel >> 2]
hi          = ~((kvs << 1) | 0xF0) & 0xFF                // 15,13,11,9,7,5,3,1
attenuation = min(255, ((kvs * 32 * velScale) >> 8) + hi)
```

One `P_EGS_OP_LEVELS` attenuation LSB is 16 of msfa's level units, so the drop-in replacement for
`ScaleVelocity` is `(15 - attenuation) << 4`. It reproduces the msfa result _exactly_ at full
velocity for every sensitivity, so only the soft end moves. Side effect worth knowing: the DX7 has
only **23 distinct velocity levels** across the whole MIDI range (it quantises twice by `>> 2`),
where msfa models 63.

Our version: `env-tables.ts` `velocityAttenuation`, used by `dx7note.ts` `scaleVelocity`.

### A3. Modulation is a saturating sum on hardware, not a maximum

Three places take a maximum where the ROM adds:

| Dexed                                                      | ROM                                                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `msfa/dx7note.cc:229` `pitch_mod = max(pmod_1, pmod_2)`    | `MOD_PITCH_LOAD_TO_EGS` adds the delay-scaled patch depth to the controller total, saturating at 255 |
| `msfa/dx7note.cc:277` `amd_mod = max(amod_1, amod_2)`      | `MOD_AMP_LOAD_TO_EGS`, likewise                                                                      |
| `msfa/controllers.h:70,73` `amp_mod = max(amp_mod, total)` | `MOD_AMP_SUM_MOD_SOURCE` / `MOD_PITCH_SUM_MOD_SOURCE` add all four sources                           |

With LFO pitch-mod depth giving 100 and the mod wheel giving 100, the DX7 produces 200 and Dexed
produces 100. They agree only when one term is zero or already saturated. The same applies to two
controllers routed to the same destination — a mod wheel and a breath controller both assigned to
pitch behave as one in Dexed.

Texed sums and saturates in all three. Folding the depth into an 8-bit factor before the LFO
multiply — as the ROM does — also shrinks the intermediate enough to drop the `BigInt` the
TypeScript port needed; a C++ port still wants the `int64_t` cast, but only for a 39-bit product
rather than a 63-bit one.

### A4. EG bias is added after the LFO term, not maxed against it

`msfa/dx7note.cc:280-281` folds the controller EG bias in as
`amd_mod = max((1<<24) - amod_3, amd_mod)`. The ROM instead clamps the LFO term so the bias cannot
overflow it, and then adds:

```
A = min(255, A + bias) - bias
A = hi(A * lfoTerm)
A = min(255, A + bias)
```

With bias 128 and LFO amp mod 128 the hardware lands near 255 — much darker — where Dexed gives 128. With no EG bias assigned the two are identical, which is why this only shows up on patches
that actually route a controller to EG bias.

### A5. Portamento: wrong constants, wrong curve, wrong granularity **[toggle]**

Three separate problems, all in the same feature.

**The rate constants are not the DX7's.** `msfa/porta.cpp:28,34` uses
`2100.0 * 2^(-0.062*i)` and `1300.0 * 2^(-0.062*i)`. The ROM reuses the _pitch EG rate table_:
`PORTA_COMPUTE_RATE_VALUE` takes `TABLE_PITCH_EG_RATE[99 - time]`. Mapping msfa's 0-127 index onto
the DX7's 0-99 parameter, msfa glides **5–16× too fast**, and its slowest setting (8.96
semitones/second) cannot get near the DX7's 0.55 semitones/second.

**The glide is distance-dependent on hardware.** `PORTA_PROCESS` multiplies the step by one per
remaining 3 semitones — `(|distance| >> 10) + 1` in EGS units — which makes a plain portamento an
exponential ease-in rather than the constant-rate ramp msfa produces. Glissando instead uses a
fixed multiplier of 3, so on hardware **glissando is faster than portamento over short intervals**;
msfa's `1300` versus `2100` has that backwards.

**The glide is per-voice, not per-operator.** `msfa/dx7note.h:95` keeps
`int32_t porta_curpitch_[6]` and glides each operator independently
(`msfa/dx7note.cc:215` copies all six). Because glissando quantises that per-operator value — which
already includes `coarsemul[coarse]`, e.g. 19.019 semitones for ratio 3 — each operator snaps on a
_different phase_ of the semitone grid, so during a glissando the operators sit at ratios up to a
semitone away from the patch. The EGS holds one gliding voice frequency and the OPS adds the
per-operator ratio on top; there is only ever one glide.

Texed keeps a single `portaCur` per voice and offsets every ratio operator by
`portaCur - notePitch`. This one is a **plain bug fix**, not a calibration choice, and is
unconditional.

Two smaller notes on the same code. `logfreq_round2semi` (`msfa/dx7note.cc:39-44`) computes
`rem = (freq - base) % step`, which goes negative below MIDI 0 and flips the rounding direction —
reachable with a 0.5× coarse ratio on a low note. C and JavaScript agree on `%` taking the sign of
the dividend, so the fix — `rem = ((freq - base) % step + step) % step` — applies to both. And
Dexed's step is hard-wired to one semitone; Texed's takes the DX7II `PQNT` parameter, so glissando
can quantise to 2, 3, 4 … semitones.

### A6. LFO and pitch EG run about 2.5% fast **[toggle]**

`HANDLER_OCF` reloads `SYSTEM_TICK_PERIOD = 3140` E-cycles; at the DX7's 1.178312 MHz E clock that
is **375.26 Hz**. The LFO advances once per tick, the pitch EG on alternate ticks.

msfa's constants imply about 384.6 Hz instead:

|          | Dexed                                                  | implied tick             | error |
| -------- | ------------------------------------------------------ | ------------------------ | ----- |
| LFO      | `msfa/lfo.cc:54,56` — `25190424`, ratio `4437500000.0` | 384.6 Hz                 | +2.5% |
| Pitch EG | `msfa/pitchenv.cc:23` — `21.3`                         | 192.3 Hz (half of 384.6) | +2.5% |

The LFO figure is the product of two things: the float rate table is internally consistent with a
372.27 Hz tick, and `lforatio`'s `4437500000.0` (rather than 2³²) then inflates every rate by
3.32%. The two cancel to 384.6 Hz. That the pitch EG lands on exactly half of the same wrong number
is the reason to treat this as one original calibration error rather than two coincidences. Texed
derives all three rate tables (LFO phase, LFO delay, pitch EG) from one `OCF_TICK_HZ` constant in
`engine-accuracy.ts`.

While there, the 100-entry float `lfoSource` table (`msfa/lfo.cc:25`) is replaced by the ROM's
integer formula, which is exact rather than tabulated to 6 decimals:

```
a   = speed == 0 ? 1 : (165 * speed) >> 6
inc = a * (a < 160 ? 11 : 11 + ((a - 160) >> 2))
f   = inc * OCF_TICK_HZ / 65536
```

This reproduces the familiar knee at speed 63/64 exactly, including the `INCA` special case that
stops speed 0 being silent. Dexed's float table already has the knee in it — the table was
evidently derived from measurements of the real thing — so this is a tidy-up rather than a fix; the
per-entry difference is under 0.16%. It is worth doing only as part of A6, because expressing the
rate as `increment × tick` is what lets one clock constant drive the phase, the delay and the pitch
EG together.

### A7. Sample & hold re-samples half a cycle late

`msfa/lfo.cc:96` triggers on `phase_ < delta_`, i.e. the wrap through zero. `LFO_GET_AMPLITUDE`
branches on the **signed overflow flag** after adding the increment to the 16-bit phase, so the
hardware re-samples when the phase crosses `0x8000` — the halfway point.

Same rate, half a cycle out of phase, and it matters at key sync: the ROM parks the phase at
`$7FFF`, so a synced note gets a fresh S&H value on its very first tick. Dexed waits half a cycle.

### A8. LFO key sync retriggers on every note-on

`VOICE_ADD_POLY` slams the global LFO phase to `$7FFF` on _every_ key-down when LFO key sync is on,
even with other keys already held — v1.8 has no "single trigger" mode at all. Texed's default AMEM
supplement now sets the DX7II `LTRG` bit so a plain DX7 voice behaves that way; single-trigger
became something a DX7II patch has to ask for. Audible on chords with vibrato.

### A9. Fixed-frequency mode silently drops negative detune

`msfa/dx7note.cc:76`: `logfreq += detune > 7 ? 13457 * (detune - 7) : 0`.

`PATCH_ACTIVATE_OPERATOR_DETUNE` writes the same 4-bit sign-magnitude register
(`TABLE_DETUNE_VALUE = $F,$E,$D,$C,$B,$A,$9,$0,$1,…,$7`) regardless of `PATCH_OP_MODE`, so there is
no basis for the asymmetry. Texed makes it symmetric.

### A10. The operator level register has a floor the model ignores

`msfa/dx7note.cc:185` ends the output-level assembly with `outlevel = max(0, outlevel)`. The ROM
clamps the EGS register instead: `min(255, …)` then `max(4, …)`
(`CMPA #3 / BHI / LDAA #4`) — a DX7 never runs an operator at absolute full output; there is always
at least 4 LSB ≈ 1.5 dB of attenuation. In msfa's units `outlevel = 4304 - 16 × attenuation`, so
the clamp is `[224, 4240]`. The ROM also clamps the pre-shift level to `[0, 127]`, where msfa only
applies `min(127, …)` and lets negative curves run below zero.

Texed clamps both ends. Effect is small — about 1.1 dB off the very loudest operator — but it is
free and exact.

---

## Part B — what Texed has that Dexed does not

None of this is a correction; it is scope Dexed never took on. Listed because it is most of what
makes the two projects different in use.

**A DX7II / TX802 layer.** Dexed is a DX7 Mark I. Texed parses the DX7II 35-byte AMEM supplement
(`packages/dx7-format/src/amem.ts`) and acts on it: extended AMS 0–7, random pitch fluctuation,
pitch EG velocity sensitivity and range (8VA/2VA/1VA/½VA), pitch EG rate scaling, LFO key trigger,
mono, unison with detune, pitch bend range/step/mode (including the LOW/HIGH/K.ON per-voice bend
gating), portamento step and time, FC1-as-CS1, and six controller mod-range blocks against Dexed's
four sources with one range each. Also ACED single-dump pack/unpack, PCED/PMEM performance parsing
for TX802 and DX7II, and MiniDexed `.ini` performances.

**An 8-part rack.** `synth-rack.ts` runs eight timbres with per-part receive channel, note range,
note shift, detune, volume and pan, a shared polyphony budget, and the TX802 Linked Tone Generator
that chains parts into one instrument. Dexed is single-timbral with 16 voices
(`PluginProcessor.h:72`).

**DX7II micro-tuning.** Reads the `MCRYE`/`MCRYM` blobs — 128 keys at 1/1024 octave
(1.1719 cents), matching the DX7II's own resolution. See Part C for the flip side.

**TX802 EG Forced Damp.** A stolen voice ramps to silence over ~6 ms before its slot is reclaimed
(`env.ts` `forceDamp`), instead of the instantaneous cut that produces the classic DX7 steal click.
With Forced Damp off, the new note continues the stolen envelope, as the TX802 does.

**Envelope visualisation that is actually the envelope.** `env-sim.ts` replays the real envelope
generator arithmetic — the same `env-tables.ts` functions the audio path uses — so the drawn curve
is what you hear, and the curves are drag-editable. Dexed draws a schematic.

**Fractional-note tuning.** `tuning.ts` interpolates between adjacent table entries, which is how
per-part detune and unison spread are implemented without a second tuning table.

**A per-part output filter.** Both engines carry Dexed's resonant ladder and gain ramp
(`plugin-fx.ts`), but Dexed runs one instance across the whole output
(`PluginProcessor.cpp:295`); Texed gives each of the eight parts its own and keeps DC blocking on
the master, so a split or layered performance can filter its parts independently.

---

## Part C — what Dexed has that Texed does not

**Scala and MTS-ESP micro-tuning.** `msfa/tuning.h:26-28` builds tunings from `.scl`/`.kbm` data,
and Dexed integrates MTS-ESP. Texed supports only standard tuning and DX7II micro-tuning tables.
This is the one substantial gap, and `tuning.ts` already has the 128-entry table and fractional-note
interpolation an `.scl` loader would need.

**Plugin hosting.** VST/AU, DAW automation, the cartridge manager UI. Out of scope for a browser
app.

---

## Part D — notes for a backport

Ordered by ratio of audible improvement to risk.

1. **A3 / A4** (modulation sums) and **A9** (fixed-mode detune) are small, local, and
   unambiguous — a few lines each in `dx7note.cc` and `controllers.h`.
2. **A5's per-operator glide** is a real bug with no calibration component: collapse
   `porta_curpitch_[6]` to one value and offset the operators. Worth doing on its own even if the
   rate constants are left alone.
3. **A1 / A2** (level scaling curve, velocity) are table swaps. They change how existing patches
   sound, so upstream would likely want them behind a preference, the way Texed does.
4. **A6** (clock calibration) touches three files and shifts every LFO rate by 2.5%. Lowest
   risk-adjusted payoff, highest chance of an argument about the E-clock figure — the ROM states
   the divisor but not the clock, so 375.26 Hz rests on the published crystal frequency.

Whatever lands, port
[`rom-tables.test.ts`](../texed-ts/packages/dx7-engine/src/__tests__/rom-tables.test.ts) with it.
It asserts the tables against the literal ROM bytes, which is what makes these changes reviewable
without anyone having to re-derive them.

**Still on the table, not yet done in Texed either:** the OPS chip's COM carrier compensation. The
algorithm ROM holds _(carrier count − 1)_ per operator and attenuates carriers by log2(N) before
summing, so the user hears a consistent level as they change algorithm. Neither engine models it,
which leaves algorithm 32 roughly 15.6 dB hotter than algorithm 16 relative to hardware. See the
"Known divergences" section of [architecture.md](architecture.md) for the rest of that list.
