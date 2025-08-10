# Micro

Micro is a minimalistic livecoding web environment for music.

Features:
- Web editor (built on CodeMirror)
- Web player (built on Web Audio API)
- Simple language for instruments routing and note sequences
- Run changes in real-time and hear the result

## Audio Routing System

**Default Behavior**: All instruments are connected to the audio output by default.

**Explicit Routing**: When you use the `->` operator to chain effects, the instrument is **disconnected** from the output and only routed through the specified effects chain.

**STEREO Keyword**: Use `-> STEREO` to explicitly reconnect an effects chain back to the audio output.

### Routing Examples

```
pad = square()                    -- Connected to output (default)
filtered = square() -> lowpass(220)  -- NOT connected to output (explicit routing)
audible = square() -> lowpass(220) -> STEREO  -- Connected to output (explicit reconnection)
```

## Available Effects

- **`delay(time)`** - Delay effect with feedback (time in seconds)
- **`lowpass(cutoff)`** - Low-pass filter (cutoff frequency in Hz)
- **`lowpass(cutoff=220)`** - Alternative syntax with explicit parameter name

## Example Program

```
-- this is a comment line
kick=sample('./kick.wav') -- define a audio file player as 'kick'
snare=sample('./snare.wav')
pad=square() -> lowpass(cutoff=220) -> STEREO -- filtered pad connected to output
bass=square(sustain=0 decay=0.2) -- you can provide options such as envelope parameters
lead=sine() -> delay(0.75) -> lowpass(800) -> STEREO -- chained effects with output

@kick [30] 1 -- kick plays note 30 every 1 beat
@pad [(70 77)] 2 -- use parenthesis for chords
@lead [70 77 74 76 72 81] 1/8 -- lead plays a note sequence with a step duration of 1/8
@snare [_ 46] -- "_" means silence