# Micro

Micro is a minimalistic livecoding web environment for music.

Features:
- Web editor (built on CodeMirror)
- Web player (built on Web Audio API)
- Simple language for instruments routing and note sequences
- Run changes in real-time and hear the result

## Audio Routing System

**Default Behavior**: All instruments are connected to the audio output by default.

**Effects Routing**: When you use the `->` operator to chain effects, only the **source** node is disconnected from output. The **final effect** in the chain remains connected to output.

**MASTER Keyword**: Available for explicit reconnection if needed, but typically not required.

### Routing Examples

```
pad = square()                    -- Source connected to output (default)
filtered = square() -> lowpass(220)  -- Source bypassed, lowpass filter connected to output
chained = square() -> delay(0.25) -> lowpass(220)  -- Source bypassed, lowpass filter connected to output
```

## Instrument Types

### Sample Instruments
- **`sample('url')`** - Load audio sample from URL
- **`sample(url='url', gain=1.5)`** - Named arguments with gain control
- **Multi-line syntax** supported for complex definitions

### Oscillator Instruments
- **`square()`, `sine()`, `sawtooth()`, `triangle()`** - Waveform oscillators
- **ADSR envelope** parameters: `attack`, `decay`, `sustain`, `release`

## Effects and Routing

Micro supports effects chains using the `->` operator and parallel routing:

```javascript
// Basic effects
kick = sample('kick.wav') -> delay(0.5)
lead = sine() -> lowpass(cutoff=800) -> delay(0.25)

//## Parallel Routing and Gain Control

You can create multiple effect chains per instrument for complex routing:

```
lead = square()
lead -> delay(0.75) -> gain(0.2)
lead -> gain(0.7)
```

This creates two parallel paths: one with delay and low gain, another with just higher gain. Only the last effect in each chain connects to the output.

## Named Effects and Modular Routing

Create reusable effect modules that can be shared between instruments:

```
-- Define named effects
effect myDelay = delay(time=0.5)
effect myFilter = lowpass(cutoff=800)

-- Use named effects in routing
lead = square()
lead -> myDelay -> myFilter

bass = sine()
bass -> myFilter -> gain(0.8)
```

Named effects enable:
- **Reusable effect modules**: Define once, use multiple times
- **Modular routing**: Build complex effect graphs
- **Feedback connections**: Route effects back to themselves or other effects
- **Consistent processing**: Same effect settings across multiple instruments

### Available Effects

- **delay(time)**: Echo effect with feedback (time in seconds)
- **lowpass(cutoff)**: Low-pass filter (cutoff frequency in Hz)
- **gain(level)**: Volume control (level as multiplier, e.g., 0.5 = 50%)

### Routing Behavior

- **Without routing**: Instrument connects directly to output
- **Single chain**: `instrument -> effect1 -> effect2`
- **Parallel routing**: Multiple lines with same instrument name create parallel chains
- **MASTER keyword**: Explicitly connects to output (usually not needed)

## Sample Syntax Examples

```
-- Simple URL syntax
kick = sample('https://cdn.freesound.org/previews/584/584792_11532701-lq.mp3')

-- Named arguments with gain
snare = sample(url='https://cdn.freesound.org/previews/13/13751_32468-lq.mp3', gain=1.5)

-- Multi-line definition
kick = sample(
  url='https://cdn.freesound.org/previews/584/584792_11532701-lq.mp3'
  gain=1.5
)
```

## Example Program

```
-- this is a comment line
kick = sample(
  url='https://cdn.freesound.org/previews/584/584792_11532701-lq.mp3'
  gain=1.2
)
snare = sample('https://cdn.freesound.org/previews/13/13751_32468-lq.mp3')
pad = square() -> lowpass(cutoff=220) -- filtered pad (lowpass connected to output)
bass = square(sustain=0 decay=0.2) -- you can provide options such as envelope parameters
lead = sine() -> delay(0.75) -> lowpass(800) -- chained effects (lowpass connected to output)

@kick [30] 1 -- kick plays note 30 every 1 beat
@pad [(70 77)] 2 -- use parenthesis for chords
@lead [70 77 74 76 72 81] 1/8 -- lead plays a note sequence with a step duration of 1/8
@snare [_ 46] -- "_" means silence