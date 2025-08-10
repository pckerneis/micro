class MicroParser {
    constructor() {
        this.instruments = new Map();
        this.patterns = new Map();
    }

    parse(code, audioEngine) {
        this.instruments.clear();
        this.patterns.clear();
        
        const lines = code.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('--'));
        const errors = [];
        
        try {
            // First pass: parse instrument definitions
            for (const line of lines) {
                if (line.includes('=') && !line.startsWith('@')) {
                    this.parseInstrumentDefinition(line, audioEngine, errors);
                }
            }
            
            // Second pass: parse patterns
            for (const line of lines) {
                if (line.startsWith('@')) {
                    this.parsePattern(line, audioEngine, errors);
                }
            }
            
            return { success: errors.length === 0, errors };
        } catch (error) {
            return { success: false, errors: [error.message] };
        }
    }

    parseInstrumentDefinition(line, audioEngine, errors) {
        try {
            const [name, definition] = line.split('=').map(s => s.trim());
            
            if (definition.startsWith('sample(')) {
                // Parse sample instrument
                const urlMatch = definition.match(/sample\(['"]([^'"]+)['"]\)/);
                if (urlMatch) {
                    const instrument = audioEngine.createSample(urlMatch[1]);
                    audioEngine.instruments.set(name, instrument);
                    this.instruments.set(name, { type: 'sample', url: urlMatch[1] });
                }
            } else if (definition.includes('square(') || definition.includes('sine(') || definition.includes('sawtooth(') || definition.includes('triangle(')) {
                // Parse oscillator instrument
                const typeMatch = definition.match(/(square|sine|sawtooth|triangle)/);
                const type = typeMatch ? typeMatch[1] : 'sine';
                
                // Parse options
                const options = this.parseOptions(definition);
                
                // Parse effects chain
                const effects = this.parseEffects(definition);
                
                let instrument = audioEngine.createOscillator(type, options);
                
                // Apply effects
                effects.forEach(effect => {
                    if (effect.type === 'delay') {
                        instrument = instrument.delay(effect.time);
                    }
                });
                
                audioEngine.instruments.set(name, instrument);
                this.instruments.set(name, { type: 'oscillator', waveType: type, options, effects });
            }
        } catch (error) {
            errors.push(`Error parsing instrument "${line}": ${error.message}`);
        }
    }

    parsePattern(line, audioEngine, errors) {
        try {
            // Parse pattern: @instrument [notes] duration
            const match = line.match(/@(\w+)\s+\[([^\]]+)\](?:\s+([^\s]+))?/);
            if (!match) {
                errors.push(`Invalid pattern syntax: ${line}`);
                return;
            }
            
            const [, instrumentName, notesStr, durationStr] = match;
            const duration = this.parseDuration(durationStr || '1');
            const notes = this.parseNotes(notesStr);
            
            if (!audioEngine.instruments.has(instrumentName)) {
                errors.push(`Unknown instrument: ${instrumentName}`);
                return;
            }
            
            audioEngine.addPattern(instrumentName, notes, duration);
            this.patterns.set(instrumentName, { notes, duration });
        } catch (error) {
            errors.push(`Error parsing pattern "${line}": ${error.message}`);
        }
    }

    parseOptions(definition) {
        const options = {};
        const optionsMatch = definition.match(/\(([^)]*)\)/);
        
        if (optionsMatch && optionsMatch[1].trim()) {
            const optionsStr = optionsMatch[1];
            const pairs = optionsStr.split(/,(?![^()]*\))/);
            
            pairs.forEach(pair => {
                const [key, value] = pair.split('=').map(s => s.trim());
                if (key && value !== undefined) {
                    options[key] = parseFloat(value) || value;
                }
            });
        }
        
        return options;
    }

    parseEffects(definition) {
        const effects = [];
        const effectsMatch = definition.match(/->\s*(.+)$/);
        
        if (effectsMatch) {
            const effectsStr = effectsMatch[1];
            const effectCalls = effectsStr.split('->').map(s => s.trim());
            
            effectCalls.forEach(call => {
                if (call.startsWith('delay(')) {
                    const timeMatch = call.match(/delay\(([^)]+)\)/);
                    if (timeMatch) {
                        effects.push({ type: 'delay', time: parseFloat(timeMatch[1]) });
                    }
                }
            });
        }
        
        return effects;
    }

    parseNotes(notesStr) {
        const notes = [];
        let i = 0;
        
        while (i < notesStr.length) {
            const char = notesStr[i];
            
            if (char === ' ') {
                i++;
                continue;
            }
            
            if (char === '_') {
                notes.push('_');
                i++;
            } else if (char === '(') {
                // Parse chord
                const endParen = notesStr.indexOf(')', i);
                if (endParen === -1) throw new Error('Unclosed chord parenthesis');
                
                const chordStr = notesStr.substring(i + 1, endParen);
                const chord = chordStr.split(/\s+/).map(n => parseInt(n)).filter(n => !isNaN(n));
                notes.push(chord);
                i = endParen + 1;
            } else if (/\d/.test(char)) {
                // Parse single note
                let numStr = '';
                while (i < notesStr.length && /\d/.test(notesStr[i])) {
                    numStr += notesStr[i];
                    i++;
                }
                notes.push(parseInt(numStr));
            } else {
                i++;
            }
        }
        
        return notes;
    }

    parseDuration(durationStr) {
        if (durationStr.includes('/')) {
            const [num, den] = durationStr.split('/').map(s => parseInt(s.trim()));
            return num / den;
        }
        return parseFloat(durationStr);
    }
}
