# Micro

Micro is a minimalistic audio livecoding environment built on the Web Audio API.

- __Editor__: CodeMirror-based, hot-exec with Ctrl/Cmd+Enter
- __Engine__: GraphParser → AudioGraphBuilder → AudioEngine (scheduler)
- __Language__: Simple routing with `->`, explicit `OUT`, named routes, and patterns

## Quick start

1) Serve the folder (modules require HTTP). Example: `npx vite --port 8080`
2) Open http://localhost:8080 and click Play
3) Edit code, press Execute to hear the changes

## Shortcuts

- <kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd> (or <kbd>Ctrl/Cmd</kbd> + <kbd>Enter</kbd>) to execute the code
- <kbd>Ctrl/Cmd</kbd> + <kbd>Space</kbd> to toggle play

## Routing

Declare audio nodes and connect them with "->".

Use the `OUT` keyword to connect nodes to the output.

```
synth = sine{} -> OUT
```

Syntax basics (curly braces with named parameters):

- Instruments: `sine{attack=0.01, decay=0.2, sustain=0.7, release=0.3}`
- Effects: `lowpass{cutoff=800, Q=1.0}`, `delay{time=0.5, feedback=0.3}`, `gain{level=-6dB}`
- Samples: `sample{url='https://.../sound.mp3', gain=1.0}`
- Connect: `a -> b -> OUT`

Examples:

```
lead = sine{decay=0.1, sustain=0}
lead -> gain{level=-6dB} -> OUT

bass = square{attack=0.01, sustain=0} -> lowpass{cutoff=200} -> gain{level=-8dB} -> OUT

# Parallel routing: repeat the source name on multiple lines
lead -> delay{time=0.75} -> gain{level=-12dB} -> OUT
lead -> gain{level=-6dB} -> OUT
```

### Named routes

You can name a chain and reuse it. When connecting TO a route, it connects to its first node. When connecting FROM a route, it connects from its last node.

```
chain = lowpass{cutoff=800} -> delay{time=0.3}
lead = sine{}
lead -> chain -> OUT
```

## Modulating AudioParams (FM/AM/LFO)

You can connect any node's output to another node's AudioParam using index/param syntax:

- Target format: `routeOrName[index].param`
- Common params: `frequency`, `detune`, `gain`, `Q`, `playbackRate`, ...
- If the target is an instrument, the modulation is applied per-note to the underlying source.
 - Indexing is zero-based (e.g., in `a -> b -> c`, `route[0]=a`, `route[1]=b`, `route[2]=c`).

### Example

```
# FM: modulator -> carrier.frequency
fm = sine{frequency=5, level=200}
lead = sine{decay=0.1, sustain=0}
fm -> lead.frequency
lead -> OUT
@lead [70 72 74 76] 1/2
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

### 1) FM lead (LFO to frequency)

```
lead = sine{decay=0.1, sustain=0}
fm = sine{frequency=5, level=120}
fm -> lead.frequency
lead -> OUT
@lead [70 72 74 76] 1/2
```

### 2) AM tremolo

```
amp = gain{level=0.5}
lfo = sine{frequency=4, level=0.5}
lfo -> amp.gain
saw = sawtooth{}
saw -> amp -> OUT
@saw [52 55 59 62] 1/2
```

### 3) Sample drums + bass

```
kick = sample{url='https://cdn.freesound.org/previews/584/584792_11532701-lq.mp3'} -> OUT
snare = sample{url='https://cdn.freesound.org/previews/13/13751_32468-lq.mp3'} -> OUT
bass = square{sustain=0, decay=0.1} -> lowpass{cutoff=180} -> gain{level=-6dB} -> OUT

@kick [60] 1
@snare [_ 60] 1
@bass [36 36 36 34] 1/4
```

### 4) Filter sweep using route index

```
chain = sine{} -> lowpass{cutoff=800} -> gain{level=-6dB}
lfo = sine{frequency=0.25, level=300}
lfo -> chain[1].frequency  # lowpass.frequency
chain -> OUT
@chain [69] 1
```

## Example Program

```
# comments start with #
kick = sample{url='https://cdn.freesound.org/previews/584/584792_11532701-lq.mp3'} -> OUT
snare = sample{url='https://cdn.freesound.org/previews/13/13751_32468-lq.mp3'} -> OUT

pad = triangle{} -> lowpass{cutoff=2200} -> delay{time=0.35} -> OUT
bass = square{sustain=0, decay=0.12} -> lowpass{cutoff=180} -> gain{level=-6dB} -> OUT
lead = sine{decay=0.1, sustain=0} -> gain{level=-9dB} -> OUT

@kick [60] 1
@snare [_ 60] 1
@pad [60 _ 67 _] 1
@bass [36 36 36 34] 1/4
@lead [68 - - _ 440Hz -] 1/8
```

## Available nodes