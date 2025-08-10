# Micro

Micro is a minimalistic livecoding web environment for music.

Features:
- Web editor (built on CodeMirror)
- Web player (built on Web Audio API)
- Simple language for instruments routing and note sequences
- Run changes in real-time and hear the result

## Example program

```
-- this is a comment line
kick=sample('./kick.wav') -- define a audio file player as 'kick'
snare=sample('./snare.wav')
pad=square() -- define a square wavetable oscillator with default options
bass=square(sustain=0 decay=0.2) -- you can provide options such as envelope parameters
lead=sine()->delay(0.75) -- you can chain filters with '->'

@kick [30] 1 -- kick plays note 30 every 1 beat
@pad [(70 77)] 2 -- use parenthesis for chords
@lead [70 77 74 76 72 81] 1/8 -- lead plays a note sequence with a step duration of 1/8
@snare [_ 46] -- "_" means silence
```