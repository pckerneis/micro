class MicroParser {
    constructor() {
        this.instruments = new Map();
        this.patterns = new Map();
    }

    parse(code, audioEngine) {
        this.instruments.clear();
        this.patterns.clear();
        
        // Clear existing patterns from audio engine
        audioEngine.patterns.clear();
        audioEngine.instruments.clear();
        
        const lines = code.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('--'));
        const errors = [];
        
        try {
            // First pass: parse instrument definitions (including multi-line)
            const instrumentLines = this.parseMultiLineDefinitions(lines);
            for (const line of instrumentLines) {
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

    parseMultiLineDefinitions(lines) {
        const instrumentLines = [];
        let currentDefinition = '';
        let inMultiLine = false;
        let parenCount = 0;
        
        for (const line of lines) {
            if (line.includes('=') && !line.startsWith('@') && !inMultiLine) {
                // Start of potential multi-line definition
                currentDefinition = line;
                parenCount = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
                
                if (parenCount > 0) {
                    inMultiLine = true;
                } else {
                    instrumentLines.push(currentDefinition);
                    currentDefinition = '';
                }
            } else if (inMultiLine) {
                // Continue multi-line definition
                currentDefinition += ' ' + line;
                parenCount += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
                
                if (parenCount <= 0) {
                    instrumentLines.push(currentDefinition);
                    currentDefinition = '';
                    inMultiLine = false;
                }
            } else if (!line.includes('=') || line.startsWith('@')) {
                // Pattern or other line, keep as is
                instrumentLines.push(line);
            }
        }
        
        return instrumentLines;
    }

    parseInstrumentDefinition(line, audioEngine, errors) {
        try {
            const equalIndex = line.indexOf('=');
            const name = line.substring(0, equalIndex).trim();
            const definition = line.substring(equalIndex + 1).trim();

            
            if (definition.startsWith('sample(')) {
                // Parse sample instrument with enhanced syntax
                const { url, options } = this.parseSampleDefinition(definition);
                if (url) {
                    // Parse effects chain for sample instruments too
                    const effects = this.parseEffects(definition);
                    
                    let instrument = audioEngine.createSample(url, options);
                    
                    // Apply effects
                    effects.forEach(effect => {
                        if (effect.type === 'delay') {
                            instrument = instrument.delay(effect.time);
                        } else if (effect.type === 'lowpass') {
                            instrument = instrument.lowpass(effect.cutoff);
                        } else if (effect.type === 'stereo') {
                            instrument = instrument.stereo();
                        }
                    });
                    
                    audioEngine.instruments.set(name, instrument);
                    this.instruments.set(name, { type: 'sample', url, options, effects });
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
                    } else if (effect.type === 'lowpass') {
                        instrument = instrument.lowpass(effect.cutoff);
                    } else if (effect.type === 'stereo') {
                        instrument = instrument.stereo();
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

    parseSampleDefinition(definition) {
        // Extract content between sample( and ) before any ->
        const beforeEffects = definition.split('->')[0];
        const sampleMatch = beforeEffects.match(/sample\(([^)]*)\)/);
        
        if (!sampleMatch) {
            return { url: null, options: {} };
        }
        
        const content = sampleMatch[1].trim();
        
        // Handle empty sample()
        if (!content) {
            return { url: null, options: {} };
        }
        
        // Check if it's a simple quoted string (positional syntax)
        const simpleUrlMatch = content.match(/^['"]([^'"]+)['"]$/);
        if (simpleUrlMatch) {
            return { url: simpleUrlMatch[1], options: {} };
        }
        
        // Parse named arguments
        const options = {};
        let url = null;
        
        // Split by commas, but respect quotes
        const args = this.splitArguments(content);
        
        args.forEach(arg => {
            const trimmed = arg.trim();
            if (trimmed.includes('=')) {
                // Named argument
                const [key, value] = trimmed.split('=').map(s => s.trim());
                if (key === 'url') {
                    url = value.replace(/^['"]|['"]$/g, ''); // Remove quotes
                } else if (key === 'gain') {
                    options.gain = parseFloat(value);
                }
            } else {
                // Positional argument (assume it's URL if no url= specified)
                if (!url) {
                    url = trimmed.replace(/^['"]|['"]$/g, ''); // Remove quotes
                }
            }
        });
        
        return { url, options };
    }

    splitArguments(content) {
        const args = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            
            if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
                current += char;
            } else if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
                current += char;
            } else if (char === ',' && !inQuotes) {
                args.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        
        if (current.trim()) {
            args.push(current);
        }
        
        return args;
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
                } else if (call.startsWith('lowpass(')) {
                    const cutoffMatch = call.match(/lowpass\((?:cutoff=)?([^)]+)\)/);
                    if (cutoffMatch) {
                        effects.push({ type: 'lowpass', cutoff: parseFloat(cutoffMatch[1]) });
                    }
                } else if (call.trim() === 'STEREO') {
                    effects.push({ type: 'stereo' });
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
