# Grammar

## Syntax

```
PROGRAM         := STATEMENT*

STATEMENT       := NAMED_CHAIN | ROUTE | TRIGGER | NAMED_PATTERN

NAMED_CHAIN     := NAME '=' CHAIN
CHAIN           := NODE ( '->' NODE )*
NODE            := NAME PARAMETERS?
ROUTE           := CHAIN                           // route-only line without assignment
NAME            := IDENT
PARAMETERS      := '{' PARAM (',' PARAM)* '}'
PARAM           := KEY '=' VALUE
KEY             := IDENT
VALUE           := STRING | NUMBER | BOOLEAN
IDENT           := /[a-zA-Z_][a-zA-Z0-9_]*/
STRING          := /'[^']*'|"[^"]*"/
NUMBER          := integer | float
BOOLEAN         := 'true' | 'false'

NAMED_PATTERN   := NAME '=' PATTERN
TRIGGER         := '@' NAME PATTERN
PATTERN         := SEQ ( '++' SEQ )*
SEQ             := '[' ITEM+ ']' DURATION          // base step duration (required)
ITEM            := NOTE MODIFIERS?
NOTE            := '_' | '-' | NUMBER | FREQ | CHORD
CHORD           := '(' NOTE+ ')'
FREQ            := NUMBER 'Hz'
MODIFIERS       := ( ':' DURATION )?
                   ( '@' VELOCITY )?
                   ( '?' PROB )?
                   ( '*' REPEAT )?
DURATION        := fraction like 1/8, 3/16, or float beats (e.g. 0.25)
VELOCITY        := 0..1 or MIDI velocity 0..127
PROB            := 0..1
REPEAT          := integer > 0
```

## Semantics

### Sequences, events, and chaining

- **Base step duration (after ']')** sets the default duration in beats for each ITEM in the sequence.
- **Per-step duration (`:dur`)** overrides the base step duration for that ITEM only.
- **Repetition (`*N`)** duplicates the ITEM N times before event conversion.
- **Chaining (`++`)** concatenates sequences (and/or pattern variables) left-to-right.
- **Wrap ties across loop**: any leading `-` in a sequence contributes carry duration that extends the last sounding event of the previous segment when chained/looped.

### Notes, chords, modifiers

- **NOTE kinds**
  - `_` = rest (creates a silent event of that step's duration)
  - `-` = tie/continuation (extends previous sounding event by that step's duration)
  - number = MIDI note (engine converts to Hz)
  - `NUMBERHz` = literal frequency (e.g., `440Hz`)
  - `( ... )` = chord; all inner NOTE tokens form one simultaneous event

- **Velocity (`@v`)** 
  - Range `0..1` or `0..127` (MIDI). If >1, engine treats as MIDI and maps accordingly.
  - For chords, `@v` applies to the whole chord. For single notes, `@v` applies to that note.

- **Probability (`?p`)** 
  - Range `0..1`. The event is scheduled with probability `p` (default 1).

- **Per-step duration (`:dur`)** 
  - `dur` may be a fraction (e.g., `1/8`) or float beats (e.g., `0.125`).
  - If omitted on the ITEM, the sequence base step duration is used.

- **Repetition (`*N`)** 
  - Expands to N copies of the ITEM with identical modifiers and duration.
  - Example: `60:1/8@0.8*3` yields three 1/8 notes at velocity 0.8.

### Pattern variables and triggers

- `name = <PATTERN>` defines a reusable pattern variable.
- `@target <PATTERN>` or `@target name` schedules a pattern to a target instrument/route.
- When chaining variables and inline sequences, durations and ties are resolved using an event-based model; the engine preserves arbitrary per-event lengths.

### Examples

``` 
lead = [60 62 64- - 67] 1/8
@lead lead ++ [ (60 64 67)@0.7?0.8 _ 72:1/4 ] 1/8

@bass [ 55*2 _ 55:1/2 ] 1/4
@pad  [ (60 64 67)@0.8?0.6  (62 65 69)@0.8 ] 1/2
@fx   [ 440Hz?0.5 _ 880Hz ] 1/8
