class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.instruments = new Map();
        this.patterns = new Map();
        this.namedEffects = new Map(); // Named effects storage (renamed for consistency)
        this.effectFactory = null; // Will be initialized with audioContext
        this.isPlaying = false;
        this.startTime = 0;
        this.bpm = 120;
        this.beatDuration = 60 / this.bpm;
        this.scheduledEvents = [];
        this.nextEventTime = 0;
        this.scheduleAheadTime = 25.0; // 25ms ahead
        this.lookahead = 25.0;
        this.timerID = null;
    }

    async init() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);
            this.masterGain.gain.value = 0.7;
            
            // Effect factory will be implemented later
            this.effectFactory = null;
            
            console.log('Audio engine initialized');
            return true;
        } catch (error) {
            console.error('Failed to initialize audio engine:', error);
            return false;
        }
    }

    createSample(url, options = {}) {
        return new SampleInstrument(this.audioContext, this.masterGain, url, options, this);
    }

    createOscillator(type, options = {}) {
        return new OscillatorInstrument(this.audioContext, this.masterGain, type, options, this);
    }

    createNamedEffect(name, effectType, params) {
        const effect = new EffectModule(this.audioContext, effectType, params);
        this.namedEffects.set(name, effect);
        return effect;
    }

    addPattern(name, notes, duration) {
        this.patterns.set(name, { notes, duration, lastTriggeredStep: -1 });
    }

    play() {
        if (this.isPlaying) return;
        
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.isPlaying = true;
        this.startTime = this.audioContext.currentTime;
        this.nextEventTime = 0;
        this.scheduler();
    }

    stop() {
        this.isPlaying = false;
        if (this.timerID) {
            clearTimeout(this.timerID);
            this.timerID = null;
        }
        
        // Reset pattern trigger tracking
        this.patterns.forEach(pattern => {
            pattern.lastTriggeredStep = -1;
        });
    }

    scheduler() {
        while (this.nextEventTime < this.audioContext.currentTime + this.scheduleAheadTime / 1000) {
            this.scheduleNote(this.nextEventTime);
            
            // Calculate next event time based on all pattern step durations
            const nextIncrement = this.calculateNextIncrement();
            this.nextEventTime += nextIncrement;
        }
        
        if (this.isPlaying) {
            this.timerID = setTimeout(() => this.scheduler(), this.lookahead);
        }
    }

    calculateNextIncrement() {
        // Use a high-resolution scheduler that can handle any subdivision
        // This ensures we catch all timing events regardless of step duration
        return this.beatDuration / 96; // 96th note resolution (handles triplets, quintuplets, etc.)
    }

    scheduleNote(time) {
        this.patterns.forEach((pattern, name) => {
            const instrument = this.instruments.get(name);
            if (!instrument) return;

            const stepTime = pattern.duration * this.beatDuration;
            const elapsedTime = time - this.startTime;
            
            // Calculate which step we should be on based on elapsed time
            const totalSteps = Math.floor(elapsedTime / stepTime);
            const currentStepInPattern = totalSteps % pattern.notes.length;
            
            // Calculate the exact time when this step should trigger
            const stepTriggerTime = this.startTime + (totalSteps * stepTime);
            const timeDifference = Math.abs(time - stepTriggerTime);
            
            // Trigger if we're within the schedule ahead window and haven't triggered this step yet
            const isStepTrigger = timeDifference < (this.scheduleAheadTime / 1000);
            
            // Only trigger if this is a new step (prevent duplicate triggers)
            if (isStepTrigger && totalSteps !== pattern.lastTriggeredStep) {
                const note = pattern.notes[currentStepInPattern];
                if (note !== '_' && note !== null) {
                    instrument.play(note, stepTriggerTime);
                }
                pattern.lastTriggeredStep = totalSteps;
            }
        });
    }
}

class EffectModule {
    constructor(audioContext, effectType, params = {}) {
        this.audioContext = audioContext;
        this.effectType = effectType;
        this.params = params;
        this.inputNode = null;
        this.outputNode = null;
        
        this.createEffectNodes();
    }

    createEffectNodes() {
        if (this.effectType === 'delay') {
            const delay = this.audioContext.createDelay();
            
            const delayTime = isFinite(this.params.time) && this.params.time > 0 ? this.params.time : 0.25;
            delay.delayTime.value = Math.min(delayTime, 1.0);
            
            // Pure delay line - no feedback, no wet gain
            this.inputNode = delay;
            this.outputNode = delay;
            
        } else if (this.effectType === 'lowpass') {
            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            
            const cutoff = isFinite(this.params.cutoff) && this.params.cutoff > 0 ? this.params.cutoff : 1000;
            filter.frequency.value = Math.min(cutoff, this.audioContext.sampleRate / 2);
            filter.Q.value = 1;
            
            this.inputNode = filter;
            this.outputNode = filter;
            
        } else if (this.effectType === 'gain') {
            const gainNode = this.audioContext.createGain();
            const level = isFinite(this.params.level) && this.params.level >= 0 ? this.params.level : 1.0;
            gainNode.gain.value = level;
            
            this.inputNode = gainNode;
            this.outputNode = gainNode;
        }
    }

    // Utility method to create effects consistently
    createEffectInstance(effectType, params) {
        return new EffectModule(this.audioContext, effectType, params);
    }

    // Process a single effect in a chain using unified EffectModule
    processChainEffect(effect, effectNode) {
        const effectModule = new EffectModule(this.audioContext, effect.type, effect);
        effectNode.connect(effectModule.inputNode);
        return effectModule.outputNode;
    }

    connectTo(target) {
        if (target instanceof EffectModule) {
            this.outputNode.connect(target.inputNode);
        } else {
            // Assume it's an audio destination
            this.outputNode.connect(target);
        }
        return this;
    }
    
    routeTo(effectName, audioEngine) {
        if (audioEngine.effects.has(effectName)) {
            const targetEffect = audioEngine.effects.get(effectName);
            this.outputNode.connect(targetEffect.inputNode);
        }
        return this;
    }
}

class SampleInstrument {
    constructor(audioContext, destination, url, options = {}, audioEngine = null) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.url = url;
        this.buffer = null;
        this.effectChains = []; // Array of effect chains for parallel routing
        this.hasExplicitRouting = false;
        this.gain = options.gain !== undefined ? options.gain : 1.0;
        this.audioEngine = audioEngine; // Reference to access named effects
        this.loadSample();
    }

    async loadSample() {
        try {
            // Fetch the audio file from URL
            const response = await fetch(this.url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Get the audio data as ArrayBuffer
            const arrayBuffer = await response.arrayBuffer();
            
            // Decode the audio data
            this.buffer = await this.audioContext.decodeAudioData(arrayBuffer);
            console.log(`Successfully loaded sample: ${this.url}`);
            
        } catch (error) {
            console.warn(`Could not load sample ${this.url}:`, error.message);
            // console.warn('Using synthetic drum sound as fallback');
            // this.buffer = this.createSyntheticDrum();
        }
    }

    createSyntheticDrum() {
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * 0.2; // 200ms
        const buffer = this.audioContext.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const envelope = Math.exp(-t * 30);
            const noise = (Math.random() * 2 - 1) * 0.3;
            const tone = Math.sin(2 * Math.PI * 60 * t) * 0.7;
            data[i] = (noise + tone) * envelope;
        }

        return buffer;
    }

    addEffect(effect) {
        // Add effect to the current chain (or create a new chain)
        if (this.effectChains.length === 0) {
            this.effectChains.push([]);
        }
        const currentChain = this.effectChains[this.effectChains.length - 1];
        currentChain.push(effect);
        this.hasExplicitRouting = true;
        return this;
    }

    addEffectChain() {
        // Start a new parallel effect chain
        this.effectChains.push([]);
        this.hasExplicitRouting = true;
        return this;
    }

    delay(time) {
        return this.addEffect({ type: 'delay', time });
    }

    lowpass(cutoff) {
        return this.addEffect({ type: 'lowpass', cutoff });
    }

    gain(level) {
        return this.addEffect({ type: 'gain', level });
    }

    routeToEffect(effectName) {
        // Add a named effect reference to the current chain
        if (this.effectChains.length === 0) {
            this.effectChains.push([]);
        }
        const currentChain = this.effectChains[this.effectChains.length - 1];
        currentChain.push({ type: 'namedEffect', name: effectName });
        this.hasExplicitRouting = true;
        return this;
    }

    stereo() {
        return this.addEffect({ type: 'stereo' });
    }

    play(note, time) {
        if (!this.buffer) return;

        const source = this.audioContext.createBufferSource();
        source.buffer = this.buffer;
        
        // If no explicit routing, connect directly to output
        if (this.effectChains.length === 0) {
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = this.gain;
            
            source.connect(gainNode);
            gainNode.connect(this.destination);
        } else {
            // Process each parallel effect chain
            this.effectChains.forEach(chain => {
                // Create a separate gain node for this chain to split the signal
                const chainInput = this.audioContext.createGain();
                chainInput.gain.value = 1.0;
                source.connect(chainInput);
                
                let effectNode = chainInput;
                
                // Process effects in this chain
                chain.forEach(effect => {
                    if (effect.type === 'delay') {
                        const delay = this.audioContext.createDelay();
                        const feedback = this.audioContext.createGain();
                        const wetGain = this.audioContext.createGain();
                        
                        const delayTime = isFinite(effect.time) && effect.time > 0 ? effect.time : 0.25;
                        delay.delayTime.value = Math.min(delayTime, 1.0);
                        feedback.gain.value = 0.3;
                        wetGain.gain.value = 0.3;
                        
                        effectNode.connect(delay);
                        delay.connect(feedback);
                        feedback.connect(delay);
                        delay.connect(wetGain);
                        effectNode = wetGain;
                        
                    } else if (effect.type === 'lowpass') {
                        const filter = this.audioContext.createBiquadFilter();
                        filter.type = 'lowpass';
                        
                        const cutoff = isFinite(effect.cutoff) && effect.cutoff > 0 ? effect.cutoff : 1000;
                        filter.frequency.value = Math.min(cutoff, this.audioContext.sampleRate / 2);
                        filter.Q.value = 1;
                        
                        effectNode.connect(filter);
                        effectNode = filter;
                        
                    } else if (effect.type === 'gain') {
                        const effectGain = this.audioContext.createGain();
                        const level = isFinite(effect.level) && effect.level >= 0 ? effect.level : 1.0;
                        effectGain.gain.value = level;
                        
                        effectNode.connect(effectGain);
                        effectNode = effectGain;
                    }
                });
                
                // Connect only the final node in this chain to output
                effectNode.connect(this.destination);
            });
        }

        source.start(time);
        source.stop(time + 2);
    }
}

class OscillatorInstrument {
    constructor(audioContext, destination, type, options = {}, audioEngine = null) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.type = type;
        this.options = {
            attack: options.attack || 0.01,
            decay: options.decay || 0.3,
            sustain: options.sustain || 0.3,
            release: options.release || 0.5,
            ...options
        };
        this.effectChains = []; // Array of effect chains for parallel routing
        this.hasExplicitRouting = false; // Track if instrument has explicit routing
        this.audioEngine = audioEngine; // Reference to access named effects
    }

    addEffect(effect) {
        // Add effect to the current chain (or create a new chain)
        if (this.effectChains.length === 0) {
            this.effectChains.push([]);
        }
        const currentChain = this.effectChains[this.effectChains.length - 1];
        currentChain.push(effect);
        this.hasExplicitRouting = true;
        return this;
    }

    addEffectChain() {
        // Start a new parallel effect chain
        this.effectChains.push([]);
        this.hasExplicitRouting = true;
        return this;
    }

    delay(time) {
        return this.addEffect({ type: 'delay', time });
    }

    lowpass(cutoff) {
        return this.addEffect({ type: 'lowpass', cutoff });
    }

    gain(level) {
        return this.addEffect({ type: 'gain', level });
    }

    routeToEffect(effectName) {
        // Add a named effect reference to the current chain
        if (this.effectChains.length === 0) {
            this.effectChains.push([]);
        }
        const currentChain = this.effectChains[this.effectChains.length - 1];
        currentChain.push({ type: 'namedEffect', name: effectName });
        this.hasExplicitRouting = true;
        return this;
    }

    stereo() {
        return this.addEffect({ type: 'stereo' });
    }

    play(note, time) {
        // Handle chords (arrays of notes)
        if (Array.isArray(note)) {
            note.forEach(n => this.playSingleNote(n, time));
            return;
        }
        
        this.playSingleNote(note, time);
    }
    
    playSingleNote(note, time) {
        // Validate note value
        if (typeof note !== 'number' || !isFinite(note)) {
            console.warn(`Invalid note value: ${note}`);
            return;
        }
        
        const frequency = this.noteToFreq(note);
        
        // Validate frequency
        if (!isFinite(frequency) || frequency <= 0) {
            console.warn(`Invalid frequency: ${frequency} for note: ${note}`);
            return;
        }
        
        const osc = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        osc.type = this.type;
        osc.frequency.value = frequency;
        
        // ADSR envelope with validation
        const { attack, decay, sustain, release } = this.options;
        const now = time || this.audioContext.currentTime;
        
        // Validate envelope values
        const validAttack = isFinite(attack) && attack >= 0 ? attack : 0.01;
        const validDecay = isFinite(decay) && decay >= 0 ? decay : 0.3;
        const validSustain = isFinite(sustain) && sustain >= 0 && sustain <= 1 ? sustain : 0.3;
        const validRelease = isFinite(release) && release >= 0 ? release : 0.5;
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.8, now + validAttack);
        gainNode.gain.linearRampToValueAtTime(validSustain, now + validAttack + validDecay);
        gainNode.gain.linearRampToValueAtTime(0, now + validAttack + validDecay + validRelease);
        
        // Always connect oscillator through ADSR envelope gain node first
        osc.connect(gainNode);
        
        // If no explicit routing, connect directly to output
        if (this.effectChains.length === 0) {
            console.log('No effect chains, connecting directly to output');
            gainNode.connect(this.destination);
        } else {
            console.log(`Processing ${this.effectChains.length} effect chains:`, this.effectChains);
            // Process each parallel effect chain
            this.effectChains.forEach(chain => {
                // Create a separate gain node for this chain to split the signal
                const chainInput = this.audioContext.createGain();
                chainInput.gain.value = 1.0;
                gainNode.connect(chainInput);
                
                let effectNode = chainInput;
                
                // Process effects in this chain
                chain.forEach(effect => {
                    if (effect.type === 'delay') {
                        const delay = this.audioContext.createDelay();
                        const feedback = this.audioContext.createGain();
                        const wetGain = this.audioContext.createGain();
                        
                        const delayTime = isFinite(effect.time) && effect.time > 0 ? effect.time : 0.25;
                        delay.delayTime.value = Math.min(delayTime, 1.0);
                        feedback.gain.value = 0.3;
                        wetGain.gain.value = 0.3;
                        
                        effectNode.connect(delay);
                        delay.connect(feedback);
                        feedback.connect(delay);
                        delay.connect(wetGain);
                        effectNode = wetGain;
                        
                    } else if (effect.type === 'lowpass') {
                        const filter = this.audioContext.createBiquadFilter();
                        filter.type = 'lowpass';
                        
                        const cutoff = isFinite(effect.cutoff) && effect.cutoff > 0 ? effect.cutoff : 1000;
                        filter.frequency.value = Math.min(cutoff, this.audioContext.sampleRate / 2);
                        filter.Q.value = 1;
                        
                        effectNode.connect(filter);
                        effectNode = filter;
                        
                    } else if (effect.type === 'gain') {
                        const effectGain = this.audioContext.createGain();
                        const level = isFinite(effect.level) && effect.level >= 0 ? effect.level : 1.0;
                        effectGain.gain.value = level;
                        
                        effectNode.connect(effectGain);
                        effectNode = effectGain;
                    }
                });
                
                // Connect only the final node in this chain to output
                effectNode.connect(this.destination);
            });
        }
        
        osc.start(now);
        osc.stop(now + validAttack + validDecay + validRelease);
    }

    noteToFreq(note) {
        // This should only handle single notes now
        if (typeof note !== 'number' || !isFinite(note)) {
            return 440; // Default to A4 if invalid
        }
        
        // Clamp note to reasonable MIDI range (0-127)
        const clampedNote = Math.max(0, Math.min(127, note));
        return 440 * Math.pow(2, (clampedNote - 69) / 12);
    }

    // === GRAPH INTEGRATION METHODS ===
    // These methods support the decoupled GraphParser integration

    /**
     * Clear all instruments, patterns, and named effects
     */
    clearAll() {
        this.instruments.clear();
        this.patterns.clear();
        this.namedEffects.clear();
        this.stop(); // Stop any current playback
    }

    /**
     * Add an instrument with the given type and parameters
     */
    addInstrument(name, type, parameters) {
        if (type === 'sample') {
            this.instruments.set(name, new SampleInstrument(
                this.audioContext, 
                this.masterGain,
                parameters.url, 
                parameters,
                this // Pass audioEngine reference for named effects
            ));
        } else {
            // Oscillator instruments
            this.instruments.set(name, new OscillatorInstrument(
                this.audioContext,
                this.masterGain,
                type,
                parameters,
                this // Pass audioEngine reference for named effects
            ));
        }
    }

    /**
     * Set an effect chain for an instrument
     */
    setInstrumentEffectChain(instrumentName, effectChain) {
        const instrument = this.instruments.get(instrumentName);
        if (instrument) {
            instrument.effectChains = [effectChain]; // Wrap in array for multiple chains support
        }
    }

    /**
     * Apply a parsed graph to this audio engine
     * This is the main integration point - decoupled architecture
     */
    applyParsedGraph(parsedGraph) {
        // Import GraphAdapter dynamically to avoid circular dependencies
        if (typeof GraphAdapter === 'undefined') {
            console.error('GraphAdapter not available. Make sure graph-adapter.js is loaded.');
            return {
                success: false,
                errors: ['GraphAdapter not available'],
                nodesCreated: 0,
                connectionsCreated: 0,
                patternsCreated: 0
            };
        }

        const adapter = new GraphAdapter(this);
        adapter.setCurrentNodes(parsedGraph.nodes);
        return adapter.applyGraph(parsedGraph);
    }
}

// Manually add the graph integration methods to the prototype as a workaround
AudioEngine.prototype.clearAll = function() {
    // Defensive checks to prevent "Cannot read properties of undefined" errors
    if (this.instruments && typeof this.instruments.clear === 'function') {
        this.instruments.clear();
    }
    if (this.patterns && typeof this.patterns.clear === 'function') {
        this.patterns.clear();
    }
    if (this.namedEffects && typeof this.namedEffects.clear === 'function') {
        this.namedEffects.clear();
    }
    // DON'T stop playback - preserve seamless livecoding experience
    // if (typeof this.stop === 'function') {
    //     this.stop(); // Stop any current playback
    // }
};

AudioEngine.prototype.clearAllAndStop = function() {
    // Version that actually stops playback (for explicit stop requests)
    this.clearAll();
    if (typeof this.stop === 'function') {
        this.stop();
    }
};

AudioEngine.prototype.addInstrument = function(name, type, parameters) {
    if (type === 'sample') {
        this.instruments.set(name, new SampleInstrument(
            this.audioContext, 
            this.masterGain,
            parameters.url, 
            parameters,
            this // Pass audioEngine reference for named effects
        ));
    } else {
        // Oscillator instruments
        this.instruments.set(name, new OscillatorInstrument(
            this.audioContext,
            this.masterGain,
            type,
            parameters,
            this // Pass audioEngine reference for named effects
        ));
    }
};

AudioEngine.prototype.setInstrumentEffectChain = function(instrumentName, effectChain) {
    const instrument = this.instruments.get(instrumentName);
    if (instrument) {
        console.log(`Setting effect chain for ${instrumentName}:`, effectChain);
        instrument.effectChains = [effectChain]; // Wrap in array for multiple chains support
        console.log(`Instrument ${instrumentName} now has effect chains:`, instrument.effectChains);
    } else {
        console.warn(`Instrument ${instrumentName} not found when setting effect chain`);
    }
};

AudioEngine.prototype.applyParsedGraph = function(parsedGraph) {
    // Import GraphAdapter dynamically to avoid circular dependencies
    if (typeof GraphAdapter === 'undefined') {
        console.error('GraphAdapter not available. Make sure graph-adapter.js is loaded.');
        return {
            success: false,
            errors: ['GraphAdapter not available'],
            nodesCreated: 0,
            connectionsCreated: 0,
            patternsCreated: 0
        };
    }

    const adapter = new GraphAdapter(this);
    adapter.setCurrentNodes(parsedGraph.nodes);
    return adapter.applyGraph(parsedGraph);
};

// Debug: Verify the applyParsedGraph method is loaded
console.log('AudioEngine.prototype.applyParsedGraph exists:', typeof AudioEngine.prototype.applyParsedGraph === 'function');
