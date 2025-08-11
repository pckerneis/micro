/**
 * Simplified Audio Engine
 * 
 * Clean, maintainable audio engine that eliminates code duplication
 * and provides a unified interface for all audio operations.
 */
class SimplifiedAudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.graphBuilder = null;
        this.instruments = new Map();
        this.patterns = new Map();
        this.namedEffects = new Map();
        this.isPlaying = false;
        this.startTime = 0;
        this.bpm = 120;
        this.beatDuration = 60 / this.bpm;
        this.nextEventTime = 0;
        this.scheduleAheadTime = 25.0; // 25ms ahead
        this.lookahead = 25.0;
        this.timerID = null;
    }

    /**
     * Initialize the audio engine
     */
    async init() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);
            this.masterGain.gain.value = 0.7;
            
            // Create the unified audio graph builder with reference to this engine for named effects
            this.graphBuilder = new AudioGraphBuilder(this.audioContext, this.masterGain, this);
            
            return true;
        } catch (error) {
            console.error('Failed to initialize audio engine:', error);
            return false;
        }
    }

    /**
     * Clear all instruments, patterns, and named effects
     */
    clearAll() {
        if (this.instruments && typeof this.instruments.clear === 'function') {
            this.instruments.clear();
        }
        if (this.patterns && typeof this.patterns.clear === 'function') {
            this.patterns.clear();
        }
        if (this.namedEffects && typeof this.namedEffects.clear === 'function') {
            this.namedEffects.clear();
        }
    }

    /**
     * Add an instrument with unified interface
     * @param {string} name - Instrument name
     * @param {string} type - Instrument type ('sample' or oscillator type)
     * @param {Object} parameters - Instrument parameters
     */
    addInstrument(name, type, parameters) {
        let config;
        
        if (type === 'sample') {
            config = {
                type: 'sample',
                url: parameters.url,
                gain: parameters.gain ?? 1.0
            };
        } else {
            // Oscillator instrument
            config = {
                type: 'oscillator',
                oscillatorType: type,
                attack: parameters.attack ?? 0.01,
                decay: parameters.decay ?? 0.3,
                sustain: parameters.sustain ?? 0.3,
                release: parameters.release ?? 0.5
            };
        }

        const instrument = new UnifiedInstrument(
            this.audioContext,
            this.masterGain,
            config,
            this.graphBuilder
        );

        this.instruments.set(name, instrument);
    }

    /**
     * Set effect chains for an instrument
     * @param {string} instrumentName - Name of the instrument
     * @param {Array} effectChain - Array of effect definitions
     */
    setInstrumentEffectChain(instrumentName, effectChain) {
        const instrument = this.instruments.get(instrumentName);
        if (instrument) {
            // Wrap single chain in array for consistency
            instrument.setEffectChains([effectChain]);
        }
    }

    /**
     * Set multiple effect chains for an instrument (for parallel routing)
     * @param {string} instrumentName - Name of the instrument
     * @param {Array<Array>} effectChains - Array of effect chain arrays
     */
    setInstrumentEffectChains(instrumentName, effectChains) {
        const instrument = this.instruments.get(instrumentName);
        if (instrument) {
            instrument.setEffectChains(effectChains);
        }
    }

    /**
     * Create a named effect for reuse
     * @param {string} name - Effect name
     * @param {string} type - Effect type
     * @param {Object} parameters - Effect parameters
     */
    createNamedEffect(name, type, parameters) {
        const effectDef = { type, ...parameters };
        this.namedEffects.set(name, effectDef);
    }

    /**
     * Add a pattern
     * @param {string} name - Pattern name
     * @param {Array} notes - Array of notes
     * @param {number} duration - Step duration
     */
    addPattern(name, notes, duration) {
        this.patterns.set(name, {
            notes,
            duration,
            currentStep: 0,
            lastTriggeredStep: -1
        });
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

    /**
     * Apply a parsed graph from the GraphParser
     * @param {Object} parsedGraph - Parsed graph structure
     */
    applyParsedGraph(parsedGraph) {
        const adapter = new GraphAdapter(this);
        adapter.setCurrentNodes(parsedGraph.nodes);
        return adapter.applyGraph(parsedGraph);
    }
}

// Export for browser usage
if (typeof window !== 'undefined') {
    window.SimplifiedAudioEngine = SimplifiedAudioEngine;
}
