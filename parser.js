class MicroParser {
    constructor() {
        this.namedRoutingLines = new Map();
        this.patterns = new Map();
    }

    parse(code) {
        this.instruments.clear();
        this.patterns.clear();
        
        const lines = code.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('--'));
        const errors = [];

        let inParamBlock = false;
        
        try {
            const instrumentLines = lines.filter(line => !line.startsWith('@'));

            for (const line of instrumentLines) {
                if (line.includes('=')) {
                    const parts = line.split('=');

                    if (!isValidName(parts[0])) {
                        errors.push('Invalid name');
                        continue;
                    }

                    if (this.namedRoutingLines.has(parts[0])) {
                        errors.push(`Routing line ${parts[0]} is already defined.`);
                        continue;
                    }

                    const routingLineName = parts[0];
                    const routingLine = parseRoutingLine(parts[1], errors);
                    this.namedRoutingLines.set(routingLineName, routingLine);
                }
            }

            // for (const line of lines) {
            //     if (line.includes('->') && !line.startsWith('@')) {
            //         // Check if it's a routing line (not an instrument definition)
            //         const equalIndex = line.indexOf('=');
            //         const arrowIndex = line.indexOf('->');
            //
            //         // It's a routing line if -> comes before = (or no = at all)
            //         if (equalIndex === -1 || arrowIndex < equalIndex) {
            //             console.log('Parsing routing line:', line);
            //             this.parseRoutingLine(line, audioEngine, errors);
            //         }
            //     }
            // }
            
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
        
        for (const line of lines) {
            if (line.includes('=') && !line.startsWith('@') && !line.startsWith('effect ')) {
                if (inMultiLine) {
                    // Complete the previous definition
                    instrumentLines.push(currentDefinition.trim());
                }
                currentDefinition = line;
                inMultiLine = true;
            } else if (inMultiLine && (line.includes('->') || line.trim() === '')) {
                // End of multi-line definition
                instrumentLines.push(currentDefinition.trim());
                currentDefinition = '';
                inMultiLine = false;
            } else if (inMultiLine) {
                // Continue multi-line definition
                currentDefinition += ' ' + line;
            }
        }
        
        // Handle case where file ends with a multi-line definition
        if (inMultiLine && currentDefinition.trim()) {
            instrumentLines.push(currentDefinition.trim());
        }
        
        return instrumentLines;
    }

    parseRoutingLine(line, audioEngine, errors) {
        try {
            // Parse routing line: instrumentName -> effect1 -> effect2
            const parts = line.split('->').map(p => p.trim());
            const instrumentName = parts[0];
            
            // Check if it's an instrument or a named effect
            if (!audioEngine.instruments.has(instrumentName) && !audioEngine.effects.has(instrumentName)) {
                errors.push(`Unknown instrument in routing: ${instrumentName}`);
                return;
            }
            
            // Handle routing from instruments
            if (audioEngine.instruments.has(instrumentName)) {
                const instrument = audioEngine.instruments.get(instrumentName);
                this.processInstrumentRouting(instrument, parts.slice(1), audioEngine, errors);
            }
            
            // Handle routing from named effects (feedback loops)
            if (audioEngine.effects.has(instrumentName)) {
                this.processEffectRouting(instrumentName, parts.slice(1), audioEngine, errors);
                return;
            }
        } catch (error) {
            errors.push(`Error parsing routing line '${line}': ${error.message}`);
        }
    }

    processInstrumentRouting(instrument, effectParts, audioEngine, errors) {
        console.log('Processing instrument routing:', effectParts);
        // Start a new effect chain for parallel routing
        instrument.addEffectChain();
        
        // Parse and add effects to the new chain
        for (let i = 0; i < effectParts.length; i++) {
            const effectStr = effectParts[i];
            console.log('Processing effect:', effectStr);
            const effect = this.parseEffect(effectStr);
            console.log('Parsed effect:', effect);
            if (effect) {
                if (effect.type === 'delay') {
                    instrument.delay(effect.time);
                } else if (effect.type === 'lowpass') {
                    instrument.lowpass(effect.cutoff);
                } else if (effect.type === 'gain') {
                    instrument.gain(effect.level);
                } else if (effect.type === 'stereo') {
                    instrument.stereo();
                } else if (effect.type === 'namedEffect') {
                    instrument.routeToEffect(effect.name);
                }
            } else if (effectStr.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
                // Handle named effect reference
                instrument.routeToEffect(effectStr);
            }
        }
    }

    processEffectRouting(effectName, effectParts, audioEngine, errors) {
        // Handle routing from named effects (for feedback loops)
        const sourceEffect = audioEngine.effects.get(effectName);
        if (!sourceEffect) return;
        
        for (let i = 0; i < effectParts.length; i++) {
            const effectStr = effectParts[i];
            if (audioEngine.effects.has(effectStr)) {
                // Route to another named effect
                sourceEffect.routeTo(effectStr, audioEngine);
            }
        }
    }

    isNamedEffectDefinition(line) {
        // Check if line is a named effect definition: name = effect(...)
        const equalIndex = line.indexOf('=');
        if (equalIndex === -1) return false;
        
        const definition = line.substring(equalIndex + 1).trim();
        
        // Check if the right side is a single effect call
        return definition.match(/^(delay|lowpass|gain)\s*\([^)]*\)$/) !== null;
    }

    parseNamedEffectDefinition(line, audioEngine, errors) {
        try {
            const equalIndex = line.indexOf('=');
            const name = line.substring(0, equalIndex).trim();
            const definition = line.substring(equalIndex + 1).trim();
            
            const effect = this.parseEffect(definition);
            if (effect) {
                // Create the named effect in the audio engine
                audioEngine.createNamedEffect(name, effect.type, effect);
                console.log(`Created named effect: ${name}`);
            } else {
                errors.push(`Failed to parse named effect: ${definition}`);
            }
        } catch (error) {
            errors.push(`Error parsing named effect definition '${line}': ${error.message}`);
        }
    }

    parseEffect(effectStr) {
        // Parse individual effect string like "gain(0.7)" or "delay(0.75)"
        if (effectStr === 'STEREO') {
            return { type: 'stereo' };
        }
        
        const match = effectStr.match(/(\w+)\(([^)]*)\)/);
        if (!match) return null;
        
        const [, effectType, params] = match;
        
        switch (effectType) {
            case 'delay':
                let time = 0.25;
                if (params.includes('time=')) {
                    const timeMatch = params.match(/time=([^,)]+)/);
                    if (timeMatch) {
                        time = parseFloat(timeMatch[1]) || 0.25;
                    }
                } else {
                    time = parseFloat(params) || 0.25;
                }
                return { type: 'delay', time };
                
            case 'lowpass':
                let cutoff = 1000;
                if (params.includes('cutoff=')) {
                    const cutoffMatch = params.match(/cutoff=([^,)]+)/);
                    if (cutoffMatch) {
                        cutoff = parseFloat(cutoffMatch[1]) || 1000;
                    }
                } else {
                    cutoff = parseFloat(params) || 1000;
                }
                return { type: 'lowpass', cutoff };
                
            case 'gain':
                let level = 1.0;
                if (params.includes('level=')) {
                    const levelMatch = params.match(/level=([^,)]+)/);
                    if (levelMatch) {
                        level = parseFloat(levelMatch[1]);
                    }
                } else {
                    level = parseFloat(params);
                }
                return { type: 'gain', level: isFinite(level) ? level : 1.0 };
                
            default:
                return null;
        }
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
                        } else if (effect.type === 'gain') {
                            instrument = instrument.gain(effect.level);
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
                    } else if (effect.type === 'gain') {
                        instrument = instrument.gain(effect.level);
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
                } else if (call.startsWith('gain(')) {
                    const levelMatch = call.match(/gain\(([^)]+)\)/);
                    if (levelMatch) {
                        effects.push({ type: 'gain', level: parseFloat(levelMatch[1]) });
                    }
                } else if (call.trim() === 'STEREO') {
                    effects.push({ type: 'stereo' });
                } else if (call.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
                    // Named effect reference (just a name without parentheses)
                    effects.push({ type: 'namedEffect', name: call.trim() });
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

function isValidName(str) {
    // Name is a string of letters, numbers, and underscores, starting with a letter or underscore
    return /[a-zA-Z_][a-zA-Z0-9_]*/.test(str);
}
