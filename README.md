# Micro


Micro is a minimalistic audio livecoding environment built on the Web Audio API.

- __Editor__: CodeMirror-based, hot-exec with Ctrl/Cmd+Enter
- __Engine__: GraphParser → AudioGraphBuilder → AudioEngine (scheduler)
- __Language__: Audio nodes routing with `->`, note patterns and more

```
# an instrument and some FX
lead = sine{decay=0.2, sustain=0} -> delay{} -> reverb{} -> OUT

# a pattern
@lead [60 40 50 60 65 48 32 44] 1/2
```

## Quick start

### Run online

Go to https://pckerneis.github.io/micro/ and start livecoding!

### Run locally

1) Serve the folder (modules require HTTP). Example: `npx vite --port 8080`
2) Open http://localhost:8080 and click Play
3) Edit code, press Execute to hear the changes

## Shortcuts

- <kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd> (or <kbd>Ctrl/Cmd</kbd> + <kbd>Enter</kbd>) to execute the code
- <kbd>Ctrl/Cmd</kbd> + <kbd>Space</kbd> to toggle play

## Routing

Declare audio nodes and connect them with `->`.

Use the `OUT` keyword to connect nodes to the output.

```
synth = sine{} -> OUT
```

Syntax basics (curly braces with named parameters):

- Synthesis: `sine{attack=0.01, decay=0.2, sustain=0.7, release=0.3}`
- Effects: `lowpass{frequency=800, Q=1.0}`, `delay{time=0.5, feedback=0.3}`, `gain{level=-6dB}`
- Samples: `sample{url='https://.../sound.mp3', gain=1.0}`
- Connect: `a -> b -> OUT`

Examples:

```
# declare a sine synthesizer
lead = sine{decay=0.1, sustain=0}

# connect to gain and to output
lead -> gain{level=-6dB} -> OUT

# you can declare whole audio node chains
bass = square{attack=0.01, sustain=0} -> lowpass{frequency=200} -> gain{level=-8dB} -> OUT

# parallel routing: repeat the source name on multiple lines
lead -> delay{time=0.75} -> gain{level=-12dB} -> OUT
lead -> gain{level=-6dB} -> OUT
```

### Named routes

You can name a chain and reuse it. When connecting TO a route, it connects to its first node. When connecting FROM a route, it connects from its last node.

```
chain = lowpass{frequency=800} -> delay{time=0.3}
lead = sine{}
lead -> chain -> OUT
# results in "lead -> lowpass -> delay -> OUT" 
```

## Modulating AudioParams (FM/AM/LFO)

You can connect a node's output to another node's AudioParam using index/param syntax:

- Target format: `routeOrName[index].param`
- Common params: `frequency`, `detune`, `gain`, `Q`, `playbackRate`, ...
- If the target is an instrument, the modulation is applied per-note to the underlying source.
 - Indexing is zero-based (e.g., in `a -> b -> c`, `route[0]=a`, `route[1]=b`, `route[2]=c`).

### Example

```
arp = sine{decay=0.2, sustain=0}
fm = sine{frequency=800, level=120}
fm -> arp.frequency
arp -> OUT
@arp [70 72 74 76] 1/2
```

## Pattern Syntax

Patterns schedule notes or gates: `@target [tokens...] stepDuration`.

Tokens:

- __Rest `"_"`__: no event this step
- __Continuation `"-"`__: tie/sustain the previous playable step (wrap-around enabled)
- __MIDI integer__: e.g., `60` (converted to Hz internally)
- __Frequency literal__: e.g., `440Hz`, `432.5Hz` (used as exact frequency)

Duration per token is `stepDuration`. Continuations add steps to the previous note.

Examples:

```
@lead [12 - - _ 440Hz -] 1/8
# 12 holds 3 steps, rest 1 step, 440Hz holds 2 steps (ties wrap across loop).

@bass [36 _ 36 _ 36 _ 34 _] 1/4
```

## Full Examples

### 1) FM arp (LFO to frequency)

```
arp = sine{decay=0.2, sustain=0}
fm = sine{frequency=800, level=120}
fm -> arp.frequency
arp -> OUT
@arp [70 72 74 76] 1/2
```

### 2) AM tremolo

```
amp = gain{level=0.5}
lfo = sine{frequency=4, level=0.5}
lfo -> amp.gain
saw = sawtooth{}
saw -> amp -> gain{level=-12dB} -> OUT
@saw [52 55 59 62] 1/2
```

### 3) Sample drums + bass

```
kick = sample{url='https://cdn.freesound.org/previews/584/584792_11532701-lq.mp3'} -> OUT
snare = sample{url='https://cdn.freesound.org/previews/13/13751_32468-lq.mp3'} -> reverb{mix=0.2} -> OUT
bass = square{sustain=0, decay=0.1} -> lowpass{frequency=180} -> gain{level=-6dB} -> OUT

@kick [60 _ _ _ _ 60 _ _] 1/2
@snare [_ 60] 1
@snare [_ _ _ _ _ _ _ 60?0.2] 1/4
@bass [36 36 36 34] 1/4
```

### 4) Filter sweep

```
chain = sawtooth{} -> lowpass{frequency=1250, Q=10} -> gain{level=-6dB}
lfo = sine{frequency=0.5, level=1200}
lfo -> chain[1].frequency
chain -> reverb{mix=0.4, length=3} -> OUT
@chain [32] 2
```

### 5) Full example

```
# Sample used:
# - https://freesound.org/people/smedloidian/sounds/787348/
# - https://freesound.org/people/GioMilko/sounds/347089/
# - https://freesound.org/people/DigitalUnderglow/sounds/695697/

amp = gain{level=0.3}
lfo = sine{frequency=8, level=0.3}
lfo -> amp.gain
autofilter = lowpass{q=10, frequency=1200}
saw = sawtooth{decay=0.2, sustain=0.5} -> delay {}
saw -> amp -> gain{level=-12dB} -> autofilter -> OUT
sine{frequency=0.2, level=600} -> autofilter[0].frequency

bass = sine{} -> gain{level=-12dB} -> reverb{} -> OUT
sine{frequency=3600, level=500} -> bass.frequency

kick = sample{url='https://cdn.freesound.org/previews/652/652006_11532701-lq.mp3'} -> delay{} -> reverb{} -> OUT
clap = sample{url='https://cdn.freesound.org/previews/695/695697_14904072-lq.mp3'} -> reverb{size=1.5, mix=0.8} -> OUT
seagulls = sample{url='https://cdn.freesound.org/previews/787/787348_5629280-lq.mp3'} -> delay{feedback=0.9} -> reverb{mix=0.8} -> gain{level=3dB} -> OUT

@saw [52 55 59 62] 1/2
@bass [40 36]16
@kick [60]4
@clap [_ _ _ 56?0.5]2
@seagulls [52?0.6 54?0.6 54?0.6]8
```
